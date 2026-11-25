const $ = (s, r = document) => r.querySelector(s),
  $$ = (s, r = document) => [...r.querySelectorAll(s)];
const app = {
  room: null,
  token: null,
  playerId: null,
  ws: null,
  connecting: false,
  reconnectTimer: null,
  reconnectAttempt: 0,
  state: null,
  modal: null,
  selectedVote: null,
  timelineDraft: null,
  currentZone: null,
  phaseTick: null,
};
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
function toast(s) {
  const t = $("#toast");
  t.textContent = s;
  t.classList.add("show");
  clearTimeout(app.toastTimer);
  app.toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
}
function modal(content) {
  const m = $("#modal");
  m.innerHTML = content;
  m.classList.remove("hidden");
  app.modal = m;
  setTimeout(() => $("input", m)?.focus(), 50);
}
function closeModal() {
  app.modal?.classList.add("hidden");
}
function showHome() {
  $("#home").classList.remove("hidden");
  $("#game").classList.add("hidden");
  app.room = null;
  app.state = null;
  app.connecting = false;
  clearTimeout(app.reconnectTimer);
  app.ws?.close();
  app.ws = null;
  clearInterval(app.phaseTick);
  history.replaceState({}, "", "/");
}
function nameDialog(join = false, mode = "private") {
  modal(
    `<div class="modal-card"><div class="eyebrow"><i></i> ${join ? "ENTER THE ROOM" : mode === "solo" ? "SOLO PRACTICE / 01" : "OPEN THE ROOM"}</div><h2>${join ? "A room is waiting." : mode === "solo" ? "Meet your other witnesses." : "Name your witness."}</h2><p>${join ? "Enter the six-character code shared by your host." : mode === "solo" ? "Three AI witnesses will join you, each with their own role, room view and private evidence. No account or AI service is needed." : "Choose a name the other witnesses will recognize."} No account is needed.</p>${join ? '<label class="label">ROOM CODE</label><input class="input" id="room-code" maxlength="6" placeholder="E.G. K7M2QX" autocomplete="off">' : ""}<label class="label">YOUR NAME</label><input class="input" id="player-name" maxlength="20" placeholder="A name to remember" autocomplete="nickname"><div class="modal-actions"><button class="link-button" id="cancel">Cancel</button><button class="primary" id="continue">${join ? "Join room" : mode === "solo" ? "Start solo practice" : "Create room"} <span>↗</span></button></div></div>`,
  );
  $("#cancel").onclick = closeModal;
  $("#continue").onclick = async () => {
    const name = $("#player-name").value.trim();
    const code = $("#room-code")?.value.trim();
    if (name.length < 2) {
      toast("Choose a name with at least two characters.");
      return;
    }
    closeModal();
    try {
      const r = await fetch(`/api/${join ? "join" : "create"}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, code, ...(mode === "solo" && !join ? { mode: "solo" } : {}) }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error || "Could not open room.");
      enter(d);
    } catch (e) {
      toast(e.message);
    }
  };
  $("#player-name").onkeydown = (e) => {
    if (e.key === "Enter") $("#continue").click();
  };
  $("#room-code")?.addEventListener(
    "input",
    (e) => (e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "")),
  );
}
function enter(d) {
  app.room = d.code;
  app.token = d.token;
  app.playerId = d.playerId;
  sessionStorage.setItem(`paradox:${d.code}`, JSON.stringify(d));
  history.replaceState({}, "", `/?room=${d.code}`);
  $("#home").classList.add("hidden");
  $("#game").classList.remove("hidden");
  connect();
}
async function connect() {
  if (!app.room || !app.token || app.connecting) return;
  app.connecting = true;
  try {
    const ticketResponse = await fetch(`/socket/${app.room}/ticket`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: app.token }),
    });
    const ticketData = await ticketResponse.json();
    if (!ticketResponse.ok) throw Error(ticketData.error || "Could not reconnect to the room.");
    if (!app.room) return;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(
      `${proto}//${location.host}/socket/${app.room}/connect?ticket=${encodeURIComponent(ticketData.ticket)}`,
    );
    app.ws = socket;
    socket.onopen = () => {
      if (app.ws !== socket) return;
      app.connecting = false;
      app.reconnectAttempt = 0;
    };
    socket.onmessage = (e) => {
      if (app.ws !== socket) return;
      try {
        const m = JSON.parse(e.data);
        if (m.type === "state") {
          app.state = m.data;
          render();
        } else if (m.type === "error") toast(m.data?.error || "Connection issue");
      } catch {
        toast("Received an invalid room update.");
      }
    };
    socket.onclose = () => {
      if (app.ws !== socket) return;
      app.ws = null;
      app.connecting = false;
      if (app.room) {
        const delay = Math.min(1000 * 2 ** app.reconnectAttempt, 15000);
        app.reconnectAttempt++;
        app.reconnectTimer = setTimeout(connect, delay);
      }
    };
    socket.onerror = () => {
      socket.close();
    };
  } catch (error) {
    app.connecting = false;
    toast(error.message || "Room connection failed.");
    if (app.room) {
      const delay = Math.min(1000 * 2 ** app.reconnectAttempt, 15000);
      app.reconnectAttempt++;
      app.reconnectTimer = setTimeout(connect, delay);
    }
  }
}
async function action(type, data = {}) {
  if (!app.token) return;
  try {
    const r = await fetch(`/socket/${app.room}/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: app.token, action: { type, ...data } }),
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.error);
    if (type === "share") toast("Evidence shared with the room.");
    if (type === "inspect")
      toast(
        d.foundCount
          ? `Trace recovered: ${d.found.join(", ")}`
          : `${d.object} holds no private trace in your version.`,
      );
    if (type === "vote") toast("Your vote is sealed.");
  } catch (e) {
    toast(e.message);
  }
}
function send(type, data = {}) {
  app.ws?.readyState === 1 &&
    app.ws.send(JSON.stringify({ type: "action", action: { type, ...data } }));
}
function openRules() {
  modal(
    `<div class="modal-card"><div class="eyebrow"><i></i> FIELD GUIDE / 01</div><h2>How to read the room.</h2><div class="rules"><div class="rule"><b>01</b><span><strong>Every witness sees a different slice.</strong> Your room has its own visual anomaly and private traces. Click glowing objects or use the room index to search; share a trace only after you find it.</span></div><div class="rule"><b>02</b><span><strong>The room can lie, too.</strong> Environmental anomalies are randomly assigned and are separate from the Distorter. Contradiction by itself proves nothing.</span></div><div class="rule"><b>03</b><span><strong>Build the sequence together.</strong> Pool physical traces, sensor records and memories. Some clues corroborate; some are ambiguous.</span></div><div class="rule"><b>04</b><span><strong>One player is the Distorter.</strong> They have one chance to shift a shared timestamp by one minute. Other clues remain untouched.</span></div><div class="rule"><b>05</b><span><strong>No one is removed.</strong> Arrange the four events, then secretly vote. Everyone sees the complete truth and score at the end.</span></div><div class="rule"><b>06</b><span><strong>Scoring.</strong> Witnesses earn a point for the correct timeline and one for identifying the Distorter. The Distorter wins if the group misses either.</span></div><div class="rule"><b>07</b><span><strong>Alone? Choose Practice solo.</strong> Three rule-driven AI witnesses fill the other seats. They have their own roles, room versions and clues. They use no outside AI service.</span></div></div><div class="modal-actions"><span class="hint">SCENARIO 01 · THE LAST LIGHT</span><button class="primary" id="rules-close">Understood</button></div></div>`,
  );
  $("#rules-close").onclick = closeModal;
}
document.addEventListener("click", (e) => {
  if (e.target.matches("[data-open=rules]")) openRules();
  if (e.target === $("#modal")) closeModal();
});
$("#create").onclick = () => nameDialog(false);
$("#solo").onclick = () => nameDialog(false, "solo");
$$("[data-open=join]").forEach((x) => (x.onclick = () => nameDialog(true)));
function render() {
  const s = app.state;
  if (!s) return;
  const root = $("#game");
  const oldInput = $("#chat-input", root);
  const draft = oldInput?.value || "";
  const keepChatFocus = document.activeElement === oldInput;
  const cursor = oldInput?.selectionStart ?? draft.length;
  const currentTimeline = $$(".timeline-row", root)
    .map((row) => ({ event: row.dataset.event, rank: $("select", row).value }))
    .filter((item) => item.rank);
  if (s.phase === "timeline" && currentTimeline.length) app.timelineDraft = currentTimeline;
  if (s.phase !== "timeline") app.timelineDraft = null;
  root.innerHTML = `<header class="gamebar"><div class="game-brand"><strong>P<span style="color:var(--blue)">·</span>R</strong><span>THE PARADOX ROOM</span></div><div style="display:flex;gap:8px;align-items:center">${s.mode === "solo" ? '<span class="mode-tag">SOLO PRACTICE</span>' : ""}<span class="phase-tag">${esc(s.phase.toUpperCase())}</span><button class="room-tag" id="copy-code">ROOM ${esc(s.code)} ⧉</button></div></header><div class="gamehead"><div><div class="eyebrow"><i></i> ${esc(s.scenario.location.toUpperCase())}</div><h1>${esc(s.scenario.title)}<span style="color:var(--violet)">.</span></h1><p>${phaseCopy(s.phase)}</p></div><button class="text-button" id="rules-inline">FIELD GUIDE ↗</button></div>${s.phase === "reveal" ? revealHtml(s) : `<div class="game-layout"><div class="main-column">${s.phase === "lobby" ? lobbyHtml(s) : roundHtml(s)}</div><aside class="side-panel">${sideHtml(s)}</aside></div>`}`;
  if (s.phase === "investigation" && app.currentZone) focusRoomZone(app.currentZone);
  const chatInput = $("#chat-input", root);
  if (chatInput) {
    chatInput.value = draft;
    if (keepChatFocus) {
      chatInput.focus();
      chatInput.setSelectionRange(cursor, cursor);
    }
  }
  $("#copy-code").onclick = async () => {
    await navigator.clipboard?.writeText(s.code);
    toast(`Room code ${s.code} copied.`);
  };
  $("#rules-inline").onclick = openRules;
  root.onclick = (e) => {
    const b = e.target.closest("[data-action]");
    if (!b) return;
    const { action: a, ...d } = b.dataset;
    if (a === "move") {
      app.currentZone = d.zone;
      focusRoomZone(d.zone);
    }
    if (a === "ready") action("ready", { ready: b.dataset.ready !== "true" });
    if (a === "start") action("start");
    if (a === "add-ai") action("add-ai");
    if (a === "remove-ai") action("remove-ai", { playerId: d.player });
    if (a === "advance") action("advance");
    if (a === "share") action("share", { clueId: d.clue });
    if (a === "inspect") {
      if (d.zone) {
        app.currentZone = d.zone;
        focusRoomZone(d.zone);
      }
      action("inspect", { objectId: d.object });
    }
    if (a === "distort") action("distort", { sharedId: d.shared, direction: d.direction });
    if (a === "vote") {
      app.selectedVote = d.target;
      $$(".vote-option", root).forEach((x) =>
        x.classList.toggle("selected", x.dataset.target === d.target),
      );
      $("#cast-vote")?.classList.remove("hidden");
    }
    if (a === "cast") action("vote", { targetId: app.selectedVote });
    if (a === "submit-timeline") {
      const rows = $$(".timeline-row", root);
      const ranked = rows
        .map((row) => ({ event: row.dataset.event, rank: Number($("select", row).value) }))
        .sort((x, y) => x.rank - y.rank);
      if (new Set(ranked.map((x) => x.rank)).size < rows.length) {
        toast("Each event needs a different position.");
        return;
      }
      action("timeline", { order: ranked.map((x) => x.event) });
    }
    if (a === "leave") {
      sessionStorage.removeItem(`paradox:${app.room}`);
      showHome();
    }
  };
  root.onchange = (e) => {
    if (e.target.matches(".timeline-row select")) {
      const used = $$(".timeline-row select", root).map((x) => x.value);
      $$(".timeline-row select", root).forEach((sel) =>
        [...sel.options].forEach(
          (o) => (o.disabled = o.value !== sel.value && used.includes(o.value)),
        ),
      );
    }
  };
  root.onsubmit = (e) => {
    if (e.target.id !== "chat-form") return;
    e.preventDefault();
    const input = $("#chat-input", root);
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    action("message", { text });
  };
  startTimer(s.deadline);
}
function phaseCopy(p) {
  return {
    lobby: "Gather four to eight witnesses. Add AI companions to play solo or fill open seats.",
    investigation:
      "Explore your room, inspect objects and compare your private traces. Every witness sees a different version.",
    discussion: "Compare memories. The room's false echoes are not the Distorter's work.",
    timeline: "Place the events in the order they truly happened.",
    voting: "Choose who collaborated with the room. Your ballot stays hidden.",
    reveal: "The room releases the memory it kept from you.",
  }[p];
}
function lobbyHtml(s) {
  const host = s.players[0]?.isYou,
    allReady = s.players.length >= 4 && s.players.every((p) => p.ready);
  return `<section class="panel"><div class="panel-title"><span>WITNESSES IN THE ROOM</span><small>${s.players.length} / 8 · ${esc(s.mode === "solo" ? "SOLO PRACTICE" : "PRIVATE ROOM")}</small></div><div class="players">${s.players
    .map((p) => {
      const status =
        p.kind === "ai"
          ? p.activity || "AI READY"
          : p.connected
            ? p.ready
              ? "READY"
              : "IN THE ROOM"
            : "RECONNECTING";
      return `<div class="player ${p.kind === "ai" ? "ai-player" : ""}"><div class="player-name"><span>${esc(p.name)}${p.kind === "ai" ? `<small class="ai-identity">AI · ${esc(p.personality)}</small>` : ""}</span>${p.isYou ? '<span class="self-tag">YOU</span>' : ""}</div><div class="status ${p.ready ? "ready" : ""} ${p.kind === "ai" || p.connected ? "" : "offline"}"><i></i>${esc(status)}</div>${host && p.kind === "ai" ? `<button class="link-button remove-ai" data-action="remove-ai" data-player="${esc(p.id)}">REMOVE</button>` : ""}</div>`;
    })
    .join(
      "",
    )}</div><div class="lobby-controls"><div class="hint">${s.players.length < 4 ? `Waiting for ${4 - s.players.length} more witness${4 - s.players.length === 1 ? "" : "es"}. Add AI companions or share the room code with friends.` : allReady ? "Everyone is ready. The host can open the door." : "Four witnesses are here. Mark ready when you want the investigation to begin."}</div><div class="lobby-buttons">${s.players.find((p) => p.isYou)?.ready ? `<button class="secondary btn-small" data-action="ready" data-ready="true">CANCEL READY</button>` : `<button class="primary btn-small" data-action="ready" data-ready="false">I'M READY</button>`}${host && s.players.length < 8 ? `<button class="secondary btn-small" data-action="add-ai">ADD AI WITNESS +</button>` : ""}${host ? `<button class="secondary btn-small" data-action="start" ${s.players.length < 4 || !allReady ? "disabled" : ""}>BEGIN ↗</button>` : ""}</div></div></section><section class="panel"><div class="panel-title"><span>BEFORE THE DOOR OPENS</span><small>FIELD NOTES</small></div><div class="rules"><div class="rule"><b>01</b><span>The room changes for every witness. Click glowing objects or use the room index to search, then choose which discoveries to share.</span></div><div class="rule"><b>02</b><span>Some witnesses remember an impossible room anomaly. The room itself can create false information.</span></div><div class="rule"><b>03</b><span>One witness is secretly the Distorter. No one is eliminated; everyone stays in the investigation.</span></div><div class="rule"><b>04</b><span>AI witnesses have their own room, role, and evidence. Their profiles shape how they share and reason.</span></div></div></section>`;
}
function roundHtml(s) {
  const you = s.you;
  let content = "";
  if (["investigation", "discussion"].includes(s.phase)) {
    content += explorationHtml(s);
    content += `<section class="panel"><div class="panel-title"><span>SHARED EVIDENCE</span><small>${s.shared.length} TRACE${s.shared.length === 1 ? "" : "S"} IN THE ROOM</small></div><div class="shared-list">${s.shared.length ? s.shared.map((x) => `<article class="shared-card"><div class="shared-head"><span>${esc(x.ownerName)} · ${esc(x.kind.toUpperCase())}</span><span class="${x.distorted ? "broken" : ""}">${esc(x.displayTime)}${x.distorted ? " / SHIFTED" : ""}</span></div><h4>${esc(x.title)}</h4><p>${esc(x.text)}</p><div class="shared-meta"><span>${esc(x.room)}</span>${x.distorted ? '<span class="broken">SIGNAL INTEGRITY LOST</span>' : ""}</div>${you.ability && !you.ability.used ? `<div style="display:flex;gap:7px"><button class="share-btn" data-action="distort" data-shared="${esc(x.id)}" data-direction="earlier">SHIFT −1 MIN</button><button class="share-btn" data-action="distort" data-shared="${esc(x.id)}" data-direction="later">SHIFT +1 MIN</button></div>` : ""}</article>`).join("") : `<div class="empty">No evidence has been shared. A clue becomes shared when its holder chooses to reveal it.</div>`}</div></section>`;
  }
  if (s.phase === "timeline") {
    const milestones = s.timeline.milestones.map((text, i) => ({ text, id: s.timeline.items[i] }));
    const eventCount = milestones.length;
    content += `<section class="panel"><div class="panel-title"><span>RECONSTRUCT THE SEQUENCE</span><small>${s.timeline.submitted ? "SEQUENCE SEALED · EDIT TO REVISE" : "YOUR SUBMISSION IS PRIVATE"}</small></div><p class="hint" style="margin:0 0 14px">Assign each event a position. Use evidence to decide which traces corroborate the sequence. You can revise until the phase ends.</p><div class="timeline-list">${milestones
      .map((m, i) => {
        const draftRank = app.timelineDraft?.find((item) => item.event === m.id)?.rank;
        const rank = draftRank ? Number(draftRank) - 1 : s.timeline.order?.indexOf(m.id);
        return `<div class="timeline-row" data-event="${esc(m.id)}"><select aria-label="Position for event ${i + 1}">${!s.timeline.order && !app.timelineDraft?.length ? '<option value="" selected disabled>CHOOSE ORDER</option>' : ""}${Array.from(
          { length: eventCount },
          (_, index) => index + 1,
        )
          .map(
            (n) =>
              `<option value="${n}" ${rank === n - 1 ? "selected" : ""}>${String(n).padStart(2, "0")} / ORDER</option>`,
          )
          .join(
            "",
          )}</select><p>${esc(m.text)}</p><span class="chip">EVENT ${String(i + 1).padStart(2, "0")}</span></div>`;
      })
      .join(
        "",
      )}</div><div style="margin-top:14px"><button class="primary btn-small" data-action="submit-timeline">${s.timeline.submitted ? "UPDATE SEQUENCE ↗" : "SEAL MY SEQUENCE ↗"}</button></div></section><section class="panel"><div class="panel-title"><span>SHARED EVIDENCE</span><small>${s.shared.length} TRACES</small></div><div class="shared-list">${s.shared.length ? s.shared.map((x) => `<article class="shared-card"><div class="shared-head"><span>${esc(x.ownerName)} · ${esc(x.kind.toUpperCase())}</span><span class="${x.distorted ? "broken" : ""}">${esc(x.displayTime)}${x.distorted ? " / SHIFTED" : ""}</span></div><h4>${esc(x.title)}</h4><p>${esc(x.text)}</p></article>`).join("") : '<div class="empty">The room is still quiet.</div>'}</div></section>`;
  }
  if (s.phase === "voting") {
    content += `<section class="panel"><div class="panel-title"><span>SECRET BALLOT</span><small>ONE VOTE · NO ABSTENTIONS</small></div><p class="hint" style="margin:0 0 14px">Choose the player you believe is the Distorter. Your selection is private and cannot be changed after sealing.</p><div class="vote-grid">${s.players
      .filter((p) => !p.isYou)
      .map(
        (p) =>
          `<button class="vote-option" data-action="vote" data-target="${esc(p.id)}" ${s.you.voted ? "disabled" : ""}>${esc(p.name)}<small>WITNESS ${String(s.players.indexOf(p) + 1).padStart(2, "0")}</small></button>`,
      )
      .join(
        "",
      )}</div><button class="primary btn-small hidden" id="cast-vote" data-action="cast" style="margin-top:14px">SEAL MY VOTE ↗</button><div class="hint" style="margin-top:12px">${s.voteCount} of ${s.players.length} votes sealed.${s.you.voted ? " Your ballot is locked." : ""}</div></section><section class="panel"><div class="panel-title"><span>SHARED EVIDENCE</span><small>LAST REVIEW</small></div><div class="shared-list">${s.shared.map((x) => `<article class="shared-card"><div class="shared-head"><span>${esc(x.ownerName)}</span><span class="${x.distorted ? "broken" : ""}">${esc(x.displayTime)}${x.distorted ? " / SHIFTED" : ""}</span></div><h4>${esc(x.title)}</h4><p>${esc(x.text)}</p></article>`).join("") || '<div class="empty">No shared traces.</div>'}</div></section>`;
  }
  if (["investigation", "discussion"].includes(s.phase)) {
    content += `<section class="panel"><div class="panel-title"><span>LIVE DISCUSSION</span><small>${s.chat.length} MESSAGES · VISIBLE TO THE ROOM</small></div><div class="chat-log" id="chat-log">${
      s.chat.length
        ? s.chat
            .slice(-50)
            .map((m) => {
              const sender = s.players.find((player) => player.id === m.playerId);
              return `<div class="chat-line"><div><b>${esc(m.name)}${sender?.kind === "ai" ? `<small class="ai-chat-tag">AI · ${esc(sender.personality)}</small>` : ""}</b><span>${new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div><p>${esc(m.text)}</p></div>`;
            })
            .join("")
        : '<div class="empty">The channel is open. Share a theory, ask what others saw, or compare your traces.</div>'
    }</div><form id="chat-form" class="chat-form"><input class="input" id="chat-input" maxlength="280" autocomplete="off" placeholder="Share an observation with the witnesses…" aria-label="Message for the room"><button class="primary btn-small" type="submit">SEND ↗</button></form></section>`;
  }
  return content;
}
function explorationHtml(s) {
  const you = s.you,
    room = you.room || {},
    objects = room.objects || [];
  const zones = [...new Set(objects.map((o) => o.zone))];
  if (!app.currentZone || !zones.includes(app.currentZone)) app.currentZone = zones[0];
  return `<section class="exploration ${esc(room.look || "")}" aria-label="Your explorable version of the observatory"><div class="explore-top"><div><div class="clue-top"><span>YOUR ROOM / PRIVATE VIEW</span><span>${you.evidenceFoundCount || 0} / ${you.evidenceTotal || 0} TRACES FOUND</span></div><h3>${esc(room.title || "The observatory")}</h3><p>${esc(room.text || "")}</p></div><span class="room-state"><i></i> ${esc(room.look || "ROOM")}</span></div><p class="search-hint">Choose a room area, look for glowing objects, and inspect them. Each witness has a different version of this place.</p><nav class="zone-nav" aria-label="Move between room areas">${zones.map((zone) => `<button class="zone-tab ${zone === app.currentZone ? "active" : ""}" data-action="move" data-zone="${esc(zone)}">${esc(zone)}<span>${objects.filter((o) => o.zone === zone).length} objects</span></button>`).join("")}</nav><div class="room-canvas"><div class="room-scene"><img src="/room.svg" alt="A dark observatory with a star dome, archive desk, power panel and north stairwell"><div class="room-vignette"></div><div class="room-variant" aria-hidden="true"></div>${you.anomaly ? '<div class="anomaly-aura" aria-hidden="true"></div>' : ""}${objects.map((o, i) => `<button class="hotspot ${o.visited ? "visited" : ""}" style="left:${o.x}%;top:${o.y}%" data-action="inspect" data-object="${esc(o.id)}" data-zone="${esc(o.zone)}" aria-label="Inspect ${esc(o.label)} in ${esc(o.zone)}" title="${esc(o.description)}"><span>${String(i + 1).padStart(2, "0")}</span><b>${esc(o.label)}</b></button>`).join("")}</div><div class="scene-caption"><span>ORPHEUM OBSERVATORY</span><span>YOUR WITNESS VIEW / ${esc(room.id || "—").toUpperCase()}</span></div></div><div class="object-index"><div class="panel-title"><span>OBJECTS IN YOUR VERSION</span><small>INSPECTED OBJECTS STAY MARKED</small></div><div class="object-buttons">${objects.map((o) => `<button class="object-button ${o.visited ? "visited" : ""}" data-action="inspect" data-object="${esc(o.id)}" data-zone="${esc(o.zone)}" ${o.visited ? "disabled" : ""}><span>${esc(o.zone)}</span><b>${esc(o.label)}</b><i>${o.visited ? "SEARCHED" : "INSPECT ↗"}</i></button>`).join("")}</div></div></section><section class="panel"><div class="panel-title"><span>YOUR EVIDENCE JOURNAL</span><small>${you.clues.length} FOUND / ${you.evidenceTotal || 0} ASSIGNED</small></div>${you.clues.length ? `<div class="clue-grid">${you.clues.map((c) => clueCard(c, true)).join("")}</div>` : '<div class="empty">No trace recovered yet. Tap a glowing object to search it. When a clue appears here, use its Share button if the group should see it.</div>'}${you.anomaly ? `<article class="clue anomaly"><div class="clue-top"><span>UNSTABLE MEMORY · PRIVATE</span><span>!</span></div><h4>${esc(you.anomaly.title)}</h4><p>${esc(you.anomaly.text)}</p><div class="clue-foot"><span>ENVIRONMENTAL ANOMALY</span><span class="chip">INDEPENDENT OF THE DISTORTER</span></div></article>` : ""}</section>`;
}
function focusRoomZone(zone) {
  const canvas = $(".room-canvas"),
    scene = $(".room-scene", canvas);
  if (!canvas || !scene) return;
  const hotspots = $$(".hotspot", scene).filter((button) => button.dataset.zone === zone);
  if (!hotspots.length) return;
  const bounds = canvas.getBoundingClientRect();
  const scale = matchMedia("(max-width: 700px)").matches ? 1.22 : 1.42;
  const centerX = hotspots.reduce((sum, item) => sum + item.offsetLeft, 0) / hotspots.length;
  const centerY = hotspots.reduce((sum, item) => sum + item.offsetTop, 0) / hotspots.length;
  const dx = bounds.width / 2 - centerX * scale;
  const dy = bounds.height / 2 - centerY * scale;
  scene.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
  $$(".zone-tab").forEach((button) =>
    button.classList.toggle("active", button.dataset.zone === zone),
  );
}
function clueCard(c, share) {
  const shared = app.state.shared.some((x) => x.owner === app.playerId && x.clueId === c.id);
  return `<article class="clue"><div class="clue-top"><span>${esc(c.kind.toUpperCase())} TRACE</span><span>${esc(c.time)}</span></div><h4>${esc(c.title)}</h4><p>${esc(c.text)}</p><div class="clue-foot"><span>${esc(c.room.toUpperCase())}</span><span class="chip">PRIVATE</span></div>${share ? `<button class="share-btn" data-action="share" data-clue="${esc(c.id)}" ${shared ? "disabled" : ""}>${shared ? "SHARED WITH ROOM" : "SHARE THIS TRACE ↗"}</button>` : ""}</article>`;
}
function sideHtml(s) {
  const self = s.players.find((p) => p.isYou);
  const ready = self?.ready;
  const guide =
    s.phase === "lobby"
      ? {
          title: "Get the room ready",
          text:
            s.mode === "solo"
              ? "You already have three AI witnesses. Mark yourself ready, then begin when the button becomes available."
              : "Invite friends with the room code or add AI seats. Everyone marks ready before the host begins.",
          step: ready
            ? self?.id === s.players[0]?.id
              ? "You are ready · choose Begin when everyone is ready"
              : "You are ready · wait for the host to begin"
            : "Step 1 · Mark yourself ready",
        }
      : s.phase === "investigation"
        ? {
            title: "Search, then share",
            text: "Move between the room areas. Tap a glowing marker to inspect it. Found evidence goes into Your Evidence Journal; choose Share on a clue to show it to everyone.",
            step: `${s.you.clues.length} private clue${s.you.clues.length === 1 ? "" : "s"} found · ${s.shared.length} shared with the group`,
          }
        : s.phase === "discussion"
          ? {
              title: "Compare what you found",
              text: "Read the shared traces, then use the discussion box to explain what you saw or ask another witness. Conflicting memories alone do not prove anyone is the Distorter.",
              step: "Next · Agree on an event order, then open the timeline",
            }
          : s.phase === "timeline"
            ? {
                title: "Rebuild the sequence",
                text: "For each event, choose where it belongs: first, second, third, or fourth. Seal your order when it feels right; you can revise before time runs out.",
                step: `${s.timeline?.submitted ? "Your order is sealed · you can update it" : "Choose a position for every event"}`,
              }
            : {
                title: "Cast a private vote",
                text: "Choose who you think collaborated with the room, then seal your vote. No one is removed; the answer and real timeline appear after the reveal.",
                step: s.you.voted
                  ? "Your vote is sealed · waiting for the reveal"
                  : "Choose a witness, then seal your vote",
              };
  return `<div class="timer-wrap"><span>UNTIL ROOM SHIFTS</span><div class="timer" id="timer">—:—</div></div><div class="next-step"><div class="next-step-label">START HERE · ${s.phase === "lobby" ? "LOBBY" : s.phase.toUpperCase()}</div><h3>${guide.title}</h3><p>${guide.text}</p><div class="next-step-action">${guide.step}</div><div class="round-path"><span class="${["lobby", "investigation"].includes(s.phase) ? "current" : ""}">SEARCH</span><i>→</i><span class="${s.phase === "discussion" ? "current" : ""}">SHARE</span><i>→</i><span class="${s.phase === "timeline" ? "current" : ""}">ORDER</span><i>→</i><span class="${s.phase === "voting" ? "current" : ""}">VOTE</span><i>→</i><span>REVEAL</span></div></div>${s.phase === "lobby" ? `<div class="event">GUEST SESSION · NO ACCOUNT REQUIRED<br>${s.mode === "solo" ? "AI participants run on the game server. No outside AI service is used." : "Room code: share it with friends, or add AI seats."}</div>` : `<div class="event"><b>${s.shared.length}</b> shared trace${s.shared.length === 1 ? "" : "s"} · <b>${s.phase === "voting" ? s.voteCount : s.players.filter((x) => x.ready).length}/${s.players.length}</b> ${s.phase === "voting" ? "votes sealed" : "ready"}</div>`}${s.you.ability ? `<div class="ability"><div class="label">DISTORTER / ONE USE ${s.you.ability.used ? "· SPENT" : "· READY"}</div><p>${esc(s.you.ability.text)}</p>${s.you.ability.used ? '<span class="chip">USED</span>' : ""}</div>` : ""}${s.phase === "investigation" || s.phase === "discussion" ? `<div style="margin-top:14px"><button class="secondary btn-small" data-action="advance">${s.phase === "investigation" ? "MOVE TO DISCUSSION" : "OPEN TIMELINE"} ↗</button></div>` : ""}${s.phase === "timeline" ? `<div style="margin-top:14px"><button class="secondary btn-small" data-action="advance">OPEN SECRET VOTE ↗</button></div>` : ""}${s.phase === "voting" ? `<div style="margin-top:14px"><button class="secondary btn-small" data-action="advance">CLOSE BALLOTS ↗</button></div>` : ""}<div style="margin-top:14px"><button class="link-button" data-action="leave">Leave room</button></div>`;
}
function startTimer(deadline) {
  clearInterval(app.phaseTick);
  const tick = () => {
    const el = $("#timer");
    if (!el) return;
    if (!deadline) {
      el.textContent = "—:—";
      return;
    }
    const sec = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    el.textContent = `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
    el.style.color = sec < 30 ? "var(--red)" : "var(--blue)";
  };
  tick();
  app.phaseTick = setInterval(tick, 500);
}
function revealHtml(s) {
  const result = s.result || {};
  const target = Object.entries(result.votes || {}).reduce(
    (a, [v, t]) => ((a[t] = (a[t] || 0) + 1), a),
    {},
  );
  const max = Math.max(0, ...Object.values(target));
  const winners = Object.keys(target).filter((k) => target[k] === max);
  const distortId = s.players.find((p) => p.name === result.distorter)?.id;
  const caught = winners.length === 1 && winners[0] === distortId;
  const correct = result.correctTimelineIds || [];
  const eventCount = (result.correctTimeline || []).length;
  const scores = s.players.map((p) => {
    const timeline = result.timelines?.[p.id] || [];
    const timelineCorrect = timeline.join() == correct.join();
    const voteCorrect = result.votes?.[p.id] === distortId;
    return {
      ...p,
      timelineCorrect,
      voteCorrect,
      score: (timelineCorrect ? 1 : 0) + (voteCorrect ? 1 : 0),
    };
  });
  const witnessCount = s.players.length - 1;
  const timelineSolved =
    scores.filter((p) => p.id !== distortId && p.timelineCorrect).length >=
    Math.ceil(witnessCount / 2);
  const witnessWin = caught && timelineSolved;
  return `<div class="result-banner"><div class="eyebrow"><i></i> REVELATION / ${witnessWin ? "THE WITNESSES PREVAIL" : "THE ROOM HOLDS ITS SECRET"}</div><h2>${witnessWin ? "The room's story has been broken." : "The room keeps the last word."}</h2><p>The Distorter was <strong>${esc(result.distorter)}</strong>. ${caught ? "The group identified the collaborator." : "The vote did not identify the collaborator."} ${scores.filter((p) => p.id !== distortId && p.timelineCorrect).length} of ${witnessCount} witnesses reconstructed the full sequence.</p></div><div class="game-layout"><div class="main-column"><section class="panel"><div class="panel-title"><span>THE VERIFIED TIMELINE</span><small>SCENARIO RECORD / ${String(eventCount).padStart(2, "0")} EVENTS</small></div>${(
    result.correctTimeline || []
  )
    .map((x) => {
      const [t, text] = x.split("|");
      return `<div class="truth-row"><b>${esc(t)}</b>${esc(text)}</div>`;
    })
    .join(
      "",
    )}</section><section class="panel"><div class="panel-title"><span>WITNESS SCORE</span><small>2 POINTS AVAILABLE</small></div><div class="players">${scores.map((p) => `<div class="player"><div class="player-name"><span>${esc(p.name)}</span><b style="color:var(--blue);font:12px var(--mono)">${p.score}/2</b></div><div class="status ${p.timelineCorrect ? "ready" : ""}"><i></i>${p.timelineCorrect ? "TIMELINE CORRECT" : "TIMELINE MISSED"}</div><div class="status ${p.voteCorrect ? "ready" : ""}"><i></i>${p.voteCorrect ? "DISTORTER FOUND" : "VOTE MISSED"}</div></div>`).join("")}</div></section><section class="panel"><div class="panel-title"><span>THE DISTORTED EVIDENCE</span><small>ROOM TRACE AUDIT</small></div><div class="shared-list">${s.shared.map((x) => `<article class="shared-card"><div class="shared-head"><span>${esc(x.ownerName)} · ${esc(x.title)}</span><span class="${x.distorted ? "broken" : ""}">${esc(x.distorted ? `${x.displayTime} → ${x.time} ORIGINAL` : x.time)}</span></div><p>${esc(x.text)}</p></article>`).join("") || '<div class="empty">No traces were shared.</div>'}</div></section></div><aside class="side-panel"><div class="timer-wrap"><span>CASE STATUS</span><div class="timer" style="font-size:16px">CLOSED</div></div><h3>${witnessWin ? "CASE SOLVED" : "CASE OPEN"}</h3><p>Compare the canonical sequence to the evidence the room showed each witness. Environmental anomalies were independent of the Distorter.</p><div style="margin-top:18px"><button class="primary btn-small" data-action="leave">RETURN TO LOBBY ↗</button></div></aside></div>`;
}
const qp = new URLSearchParams(location.search),
  code = qp.get("room");
window.addEventListener("resize", () => {
  if (app.currentZone && app.state?.phase === "investigation")
    requestAnimationFrame(() => focusRoomZone(app.currentZone));
});
if (code) {
  const d = JSON.parse(sessionStorage.getItem(`paradox:${code}`) || "null");
  if (d) enter(d);
  else nameDialog(true);
}
