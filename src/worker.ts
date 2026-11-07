import {
  assignScenario,
  DEFAULT_SCENARIO_ID,
  getScenario,
  SCENARIOS,
  validateScenario,
} from "./scenarios.ts";
import type { Role, RoomObject } from "./scenarios.ts";
import { projectSharedEvidence } from "./projections.ts";
import type { SharedEvidence } from "./projections.ts";

interface Env {
  ROOMS: DurableObjectNamespace;
  ASSETS: Fetcher;
}
type Phase = "lobby" | "investigation" | "discussion" | "timeline" | "voting" | "reveal";
type ParticipantKind = "human" | "ai";
interface Player {
  id: string;
  name: string;
  kind: ParticipantKind;
  token: string | null;
  role: Role | null;
  ready: boolean;
  clueIds: string[];
  inspectedClueIds: string[];
  visitedHotspotIds: string[];
  timelineItemIds: string[];
  anomaly: string | null;
  connected: boolean;
  roomView: { id: string; look: string; title: string; text: string } | null;
}
interface Event {
  id: string;
  type: string;
  at: number;
  data: Record<string, unknown>;
}
interface Room {
  code: string;
  phase: Phase;
  players: Player[];
  created: number;
  deadline: number | null;
  version: number;
  scenario: string;
  scenarioVersion: number;
  seed: string;
  votes: Record<string, string>;
  timelines: Record<string, string[]>;
  shared: SharedEvidence[];
  chat: { id: string; playerId: string; name: string; text: string; at: number }[];
  distortUsed: boolean;
  events: Event[];
}

const DURATIONS: Record<string, number> = {
  investigation: 240,
  discussion: 120,
  timeline: 90,
  voting: 60,
};
const ROOM_TTL = 24 * 60 * 60 * 1000;
const SOCKET_TICKET_TTL = 60_000;
const MAX_ACTION_BYTES = 8192;
const id = () => crypto.randomUUID();
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
function safeName(s: unknown) {
  if (typeof s !== "string") return "";
  return s
    .trim()
    .replace(/[<>\u0000-\u001f]/g, "")
    .slice(0, 20);
}
async function requestJson(
  request: Request,
  maxBytes: number,
): Promise<Record<string, unknown> | null> {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > maxBytes) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
    );
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
const scenarioFor = (room: Pick<Room, "scenario" | "scenarioVersion">) =>
  getScenario(room.scenario, room.scenarioVersion);
const roomCode = () =>
  Array.from(
    crypto.getRandomValues(new Uint32Array(6)),
    (n) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[n % 32],
  ).join("");

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      if (url.pathname !== "/api/create" && url.pathname !== "/api/join")
        return json({ error: "Not found." }, 404);
      if (request.method !== "POST") return json({ error: "POST required" }, 405);
      const body = await requestJson(request, 4096);
      if (!body) return json({ error: "Invalid request body." }, 400);
      if (url.pathname === "/api/create" || url.pathname === "/api/join") {
        const name = safeName(body.name);
        if (name.length < 2)
          return json({ error: "Choose a name with at least 2 characters." }, 400);
        let code = String(body.code || "")
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "");
        if (url.pathname === "/api/create") code = roomCode();
        if (code.length !== 6) return json({ error: "Enter a six-character room code." }, 400);
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const r = await stub.fetch(
          "https://room/internal/" + (url.pathname.endsWith("create") ? "create" : "join"),
          { method: "POST", body: JSON.stringify({ name, code }) },
        );
        return new Response(r.body, r);
      }
    }
    if (url.pathname.startsWith("/socket/")) {
      const code = url.pathname.split("/")[2] || "";
      if (!/^[A-Z0-9]{6}$/.test(code)) return json({ error: "Invalid room code." }, 400);
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};

export class GameRoom {
  state: DurableObjectState;
  env: Env;
  room: Room | null = null;
  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    if (state.storage?.sql?.exec && state.blockConcurrencyWhile) {
      state.blockConcurrencyWhile(async () => {
        state.storage.sql.exec(
          "CREATE TABLE IF NOT EXISTS socket_tickets (ticket TEXT PRIMARY KEY, player_id TEXT NOT NULL, expires_at INTEGER NOT NULL)",
        );
      });
    }
  }
  async load() {
    if (!this.room) {
      this.room = (await this.state.storage.get<Room>("room")) || null;
      if (this.room) {
        let migrated = false;
        if (!Number.isInteger(this.room.scenarioVersion)) {
          const prior = SCENARIOS[this.room.scenario];
          if (!prior) throw new Error(`Cannot migrate unknown scenario ${this.room.scenario}.`);
          this.room.scenarioVersion = prior.version;
          migrated = true;
        }
        for (const player of this.room.players) {
          if (!player.kind) {
            player.kind = "human";
            migrated = true;
          }
          if (player.token === undefined) {
            player.token = null;
            migrated = true;
          }
          if (!player.inspectedClueIds) {
            player.inspectedClueIds = [];
            migrated = true;
          }
          if (!player.visitedHotspotIds) {
            player.visitedHotspotIds = [];
            migrated = true;
          }
          if (!player.timelineItemIds) {
            player.timelineItemIds = [];
            if (this.room.phase !== "lobby" && this.room.players.length >= 4) {
              const sc = scenarioFor(this.room);
              const assignments = assignScenario(
                sc,
                this.room.players.map((x) => x.id),
                this.room.seed,
              );
              player.timelineItemIds = assignments.timelineItemsByPlayer[player.id] || [];
            }
            migrated = true;
          }
        }
        if (migrated) await this.save();
      }
    }
    return this.room;
  }
  async save() {
    if (this.room) await this.state.storage.put("room", this.room);
  }
  publicView(r: Room, p: Player) {
    const sc = scenarioFor(r);
    const inspected = p.inspectedClueIds || [];
    const visited = p.visitedHotspotIds || [];
    const clues = p.clueIds
      .filter((clueId) => inspected.includes(clueId))
      .map((clueId) => {
        const { supports, hotspotId, ...clue } = sc.clues.find((item) => item.id === clueId)!;
        return clue;
      });
    const room = p.roomView
      ? {
          ...p.roomView,
          objects: sc.objects.map((object: RoomObject) => ({
            ...object,
            visited: visited.includes(object.id),
          })),
        }
      : null;
    const timelineItemIds = p.timelineItemIds?.length
      ? p.timelineItemIds
      : sc.timeline.map((event) => event.id);
    const timelineById = new Map(sc.timeline.map((event) => [event.id, event]));
    return {
      code: r.code,
      phase: r.phase,
      players: r.players.map((x) => ({
        id: x.id,
        name: x.name,
        kind: x.kind,
        ready: x.ready,
        connected: x.connected,
        isYou: x.id === p.id,
      })),
      deadline: r.deadline,
      version: r.version,
      voteCount: Object.keys(r.votes).length,
      scenario: { title: sc.title, location: sc.location },
      shared: projectSharedEvidence(r.shared, r.phase === "reveal"),
      chat: r.chat,
      events: r.events.slice(-30),
      you: {
        id: p.id,
        name: p.name,
        voted: !!r.votes[p.id],
        role: r.phase === "reveal" ? p.role : undefined,
        room,
        clues,
        evidenceFoundCount: clues.length,
        evidenceTotal: p.clueIds.length,
        anomaly: p.anomaly
          ? sc.anomalies.find((anomaly) => anomaly.id === p.anomaly) || null
          : null,
        ability: p.role === "distorter" ? { ...sc.distorterAbility, used: r.distortUsed } : null,
      },
      timeline:
        r.phase === "timeline"
          ? {
              milestones: timelineItemIds.map((eventId) => timelineById.get(eventId)!.text),
              items: timelineItemIds,
              submitted: !!r.timelines[p.id],
              order: r.timelines[p.id] || null,
            }
          : undefined,
      result:
        r.phase === "reveal"
          ? {
              votes: r.votes,
              timelines: r.timelines,
              distorter: r.players.find((x) => x.role === "distorter")?.name,
              correctTimeline: sc.timeline.map((event) => `${event.time}|${event.text}`),
              correctTimelineIds: sc.timeline.map((event) => event.id),
            }
          : undefined,
    };
  }
  send(ws: WebSocket, type: string, data: unknown) {
    ws.send(JSON.stringify({ type, data }));
  }
  broadcast() {
    if (!this.room) return;
    for (const ws of this.state.getWebSockets()) {
      const p = this.room.players.find((x) => x.id === (ws.deserializeAttachment() as string));
      if (p) this.send(ws, "state", this.publicView(this.room, p));
    }
  }
  async fetch(req: Request): Promise<Response> {
    const u = new URL(req.url);
    if (u.pathname.startsWith("/internal/")) {
      const b = await requestJson(req, 4096);
      if (!b) return json({ error: "Invalid request body." }, 400);
      return u.pathname.endsWith("create")
        ? this.create(safeName(b.name), String(b.code || ""))
        : this.join(safeName(b.name));
    }
    const r = await this.load();
    if (!r) return json({ error: "Room not found." }, 404);
    if (u.pathname.endsWith("/status")) return json({ phase: r.phase, players: r.players.length });
    if (u.pathname.endsWith("/ticket") && req.method === "POST") {
      const b = await requestJson(req, 4096);
      if (!b) return json({ error: "Invalid request body." }, 400);
      return this.issueSocketTicket(String(b.token || ""));
    }
    if (u.pathname.endsWith("/action") && req.method === "POST") {
      const b = await requestJson(req, MAX_ACTION_BYTES);
      if (!b) return json({ error: "Invalid request body." }, 400);
      return this.action(String(b.token || ""), b.action || {});
    }
    if (u.pathname.endsWith("/connect") && req.headers.get("Upgrade") === "websocket") {
      const origin = req.headers.get("Origin");
      if (origin && origin !== u.origin)
        return json({ error: "Cross-origin connection refused." }, 403);
      const ticket = u.searchParams.get("ticket") || "";
      if (!ticket || !this.state.storage.sql?.exec)
        return json({ error: "Connection ticket required." }, 401);
      const consumed = this.state.storage.sql
        .exec<{ player_id: string }>(
          "DELETE FROM socket_tickets WHERE ticket = ? AND expires_at > ? RETURNING player_id",
          ticket,
          Date.now(),
        )
        .toArray();
      const p = r.players.find((x) => x.kind === "human" && x.id === consumed[0]?.player_id);
      if (!p) return json({ error: "Connection ticket expired. Reconnect." }, 401);
      const pair = new WebSocketPair();
      const client = pair[0],
        server = pair[1];
      server.serializeAttachment(p.id);
      this.state.acceptWebSocket(server);
      p.connected = true;
      await this.save();
      this.broadcast();
      this.send(server, "state", this.publicView(r, p));
      return new Response(null, { status: 101, webSocket: client });
    }
    return json({ error: "Not found" }, 404);
  }
  issueSocketTicket(token: string): Response {
    const r = this.room;
    const p = r?.players.find((x) => x.kind === "human" && x.token === token);
    if (!r || !p) return json({ error: "Invalid guest session." }, 401);
    const ticket = crypto.randomUUID() + crypto.randomUUID();
    const expiresAt = Date.now() + SOCKET_TICKET_TTL;
    const sql = this.state.storage.sql;
    if (!sql?.exec) return json({ error: "Secure connection setup is unavailable." }, 503);
    sql.exec("DELETE FROM socket_tickets WHERE expires_at <= ?", Date.now());
    sql.exec(
      "INSERT INTO socket_tickets (ticket, player_id, expires_at) VALUES (?, ?, ?)",
      ticket,
      p.id,
      expiresAt,
    );
    return json({ ticket, expiresAt });
  }
  async create(name: string, code: string): Promise<Response> {
    if (await this.load()) return json({ error: "Room code collision. Try again." }, 409);
    const token = crypto.randomUUID() + crypto.randomUUID();
    const p: Player = {
      id: id(),
      name,
      kind: "human",
      token,
      role: null,
      ready: false,
      clueIds: [],
      inspectedClueIds: [],
      visitedHotspotIds: [],
      timelineItemIds: [],
      anomaly: null,
      connected: false,
      roomView: null,
    };
    this.room = {
      code,
      phase: "lobby",
      players: [p],
      created: Date.now(),
      deadline: null,
      version: 1,
      scenario: DEFAULT_SCENARIO_ID,
      scenarioVersion: SCENARIOS[DEFAULT_SCENARIO_ID].version,
      seed: id(),
      votes: {},
      timelines: {},
      shared: [],
      chat: [],
      distortUsed: false,
      events: [],
    };
    await this.state.storage.setAlarm(Date.now() + ROOM_TTL);
    await this.save();
    return json({ code: this.room.code, token, playerId: p.id });
  }
  async join(name: string): Promise<Response> {
    const r = await this.load();
    if (!r) return json({ error: "Room not found. Check the code." }, 404);
    if (r.phase !== "lobby") return json({ error: "This game has already started." }, 409);
    if (r.players.length >= 8) return json({ error: "This room is full." }, 409);
    if (r.players.some((p) => p.name.toLowerCase() === name.toLowerCase()))
      return json({ error: "That name is already in this room." }, 409);
    const p: Player = {
      id: id(),
      name,
      kind: "human",
      token: crypto.randomUUID() + crypto.randomUUID(),
      role: null,
      ready: false,
      clueIds: [],
      inspectedClueIds: [],
      visitedHotspotIds: [],
      timelineItemIds: [],
      anomaly: null,
      connected: false,
      roomView: null,
    };
    r.players.push(p);
    r.version++;
    await this.save();
    this.broadcast();
    return json({ code: r.code, token: p.token, playerId: p.id });
  }
  async action(token: string, a: any): Promise<Response> {
    const r = await this.load();
    const p = r?.players.find((x) => x.kind === "human" && x.token === token);
    if (!r || !p) return json({ error: "Session expired. Rejoin the room." }, 401);
    const fail = (message: string) => json({ error: message }, 400);
    if (a.type === "ready") {
      if (r.phase !== "lobby") return fail("The lobby is closed.");
      p.ready = !!a.ready;
    } else if (a.type === "start") {
      if (p.id !== r.players[0].id) return fail("Only the room host can start the game.");
      if (r.phase !== "lobby") return fail("Game already started.");
      if (r.players.length < 4) return fail("At least four players are needed.");
      if (!r.players.every((x) => x.ready)) return fail("Everyone must be ready first.");
      await this.start(r);
    } else if (a.type === "inspect") {
      if (!["investigation", "discussion"].includes(r.phase))
        return fail("The room can only be searched during the investigation.");
      const object = scenarioFor(r).objects.find((x) => x.id === a.objectId);
      if (!object) return fail("That object is not part of this room.");
      p.visitedHotspotIds ??= [];
      p.inspectedClueIds ??= [];
      if (p.visitedHotspotIds.includes(object.id))
        return fail("You have already searched this object.");
      p.visitedHotspotIds.push(object.id);
      const found = scenarioFor(r).clues.filter(
        (clue) =>
          clue.hotspotId === object.id &&
          p.clueIds.includes(clue.id) &&
          !p.inspectedClueIds.includes(clue.id),
      );
      p.inspectedClueIds.push(...found.map((clue) => clue.id));
      this.event(r, "room_inspected", { by: p.name, object: object.label });
      r.version++;
      await this.save();
      this.broadcast();
      return json({
        ok: true,
        found: found.map((clue) => clue.title),
        foundCount: found.length,
        object: object.label,
      });
    } else if (a.type === "share") {
      if (!["investigation", "discussion"].includes(r.phase))
        return fail("Evidence cannot be shared now.");
      const c = scenarioFor(r).clues.find((x) => x.id === a.clueId && p.clueIds.includes(x.id));
      if (!c) return fail("You do not hold that evidence.");
      if (!p.inspectedClueIds?.includes(c.id))
        return fail("Search the room and find this trace before sharing it.");
      if (r.shared.some((x) => x.owner === p.id && x.clueId === c.id))
        return fail("You already shared this evidence.");
      r.shared.push({
        id: id(),
        owner: p.id,
        ownerName: p.name,
        clueId: c.id,
        title: c.title,
        text: c.text,
        time: c.time,
        kind: c.kind,
        room: c.room,
        displayTime: c.time,
      });
      this.event(r, "evidence_shared", { by: p.name, title: c.title });
    } else if (a.type === "message") {
      if (!["investigation", "discussion"].includes(r.phase))
        return fail("Discussion is closed for this phase.");
      const text = String(a.text || "")
        .replace(/[\u0000-\u001f]/g, " ")
        .trim()
        .slice(0, 280);
      if (text.length < 1) return fail("Write a message first.");
      const previous = [...r.chat].reverse().find((x) => x.playerId === p.id);
      if (previous && Date.now() - previous.at < 900)
        return fail("Give the room a moment before sending another message.");
      r.chat.push({ id: id(), playerId: p.id, name: p.name, text, at: Date.now() });
      r.chat = r.chat.slice(-100);
    } else if (a.type === "distort") {
      if (p.role !== "distorter" || r.distortUsed) return fail("Your ability is unavailable.");
      if (!["investigation", "discussion"].includes(r.phase))
        return fail("Your ability is no longer available.");
      if (a.direction !== "earlier" && a.direction !== "later")
        return fail("Choose whether to shift the timestamp earlier or later.");
      const item = r.shared.find((x) => x.id === a.sharedId);
      if (!item) return fail("Choose a shared clue.");
      const ability = scenarioFor(r).distorterAbility;
      const [hh, mm] = String(item.displayTime).split(":").map(Number);
      const delta = (a.direction === "earlier" ? -1 : 1) * ability.shiftMinutes;
      const total = (hh * 60 + mm + delta + 1440) % 1440;
      item.displayTime = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
      item.distorted = true;
      r.distortUsed = true;
      this.event(r, "signal", { text: "A shared record has shifted. The archive seal is broken." });
    } else if (a.type === "advance") {
      if (p.id !== r.players[0].id) return fail("Only the room host can move the phase.");
      if (r.phase === "investigation") await this.setPhase(r, "discussion");
      else if (r.phase === "discussion") await this.setPhase(r, "timeline");
      else if (r.phase === "timeline") await this.setPhase(r, "voting");
      else if (r.phase === "voting") {
        if (Object.keys(r.votes).length !== r.players.length)
          return fail("Wait until everyone has voted, or let the timer close the ballots.");
        await this.reveal(r);
      } else return fail("No phase to advance.");
    } else if (a.type === "timeline") {
      if (r.phase !== "timeline") return fail("Timeline is not open.");
      const order = Array.isArray(a.order) ? a.order.map(String) : [];
      const valid = scenarioFor(r)
        .timeline.map((event) => event.id)
        .sort();
      if (order.length !== valid.length || [...order].sort().join() != valid.join())
        return fail("Place each event exactly once.");
      r.timelines[p.id] = order;
    } else if (a.type === "vote") {
      if (r.phase !== "voting") return fail("Voting is closed.");
      if (r.votes[p.id]) return fail("Your vote is already sealed.");
      if (!r.players.some((x) => x.id === a.targetId) || a.targetId === p.id)
        return fail("Choose another player.");
      r.votes[p.id] = a.targetId;
      if (Object.keys(r.votes).length === r.players.length) await this.reveal(r);
    } else return fail("Unknown action.");
    r.version++;
    await this.save();
    this.broadcast();
    return json({ ok: true });
  }
  async start(r: Room) {
    const sc = scenarioFor(r);
    validateScenario(sc);
    const assignments = assignScenario(
      sc,
      r.players.map((player) => player.id),
      r.seed,
    );
    for (const player of r.players) {
      player.role = assignments.roles[player.id];
      player.clueIds = assignments.clueIdsByPlayer[player.id];
      player.inspectedClueIds = [];
      player.visitedHotspotIds = [];
      player.timelineItemIds = assignments.timelineItemsByPlayer[player.id];
      player.roomView = assignments.roomViewByPlayer[player.id];
      player.anomaly = assignments.anomalyIdByPlayer[player.id];
    }
    await this.setPhase(r, "investigation");
    this.event(r, "start", { scenario: sc.title });
  }
  async setPhase(r: Room, phase: Phase) {
    r.phase = phase;
    r.deadline = Date.now() + (DURATIONS[phase] || 0) * 1000;
    if (r.deadline) await this.state.storage.setAlarm(r.deadline);
    this.event(r, "phase", { phase });
  }
  async reveal(r: Room) {
    r.phase = "reveal";
    r.deadline = null;
    await this.state.storage.setAlarm(Date.now() + ROOM_TTL);
    this.event(r, "reveal", { text: "The room remembers." });
  }
  event(r: Room, type: string, data: Record<string, unknown>) {
    r.events.push({ id: id(), type, at: Date.now(), data });
    r.events = r.events.slice(-100);
  }
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (
      typeof message !== "string" ||
      message.length > MAX_ACTION_BYTES ||
      new TextEncoder().encode(message).byteLength > MAX_ACTION_BYTES
    )
      return;
    let a: unknown;
    try {
      a = JSON.parse(message);
    } catch {
      return;
    }
    if (!a || typeof a !== "object" || Array.isArray(a) || !("type" in a)) return;
    if (a.type === "ping") {
      this.send(ws, "pong", { at: Date.now() });
      return;
    }
    if (a.type === "action" && "action" in a) {
      const playerId = ws.deserializeAttachment() as string;
      const r = await this.load();
      const p = r?.players.find((x) => x.id === playerId);
      if (p?.token) await this.action(p.token, a.action || {});
    }
  }
  async webSocketClose(ws: WebSocket) {
    const r = await this.load();
    const playerId = ws.deserializeAttachment() as string;
    const p = r?.players.find((x) => x.id === playerId);
    if (p) {
      p.connected = this.state
        .getWebSockets()
        .some((socket) => socket.deserializeAttachment() === playerId);
      await this.save();
      this.broadcast();
    }
  }
  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws);
  }
  async alarm() {
    const r = await this.load();
    if (!r) return;
    if (r.phase === "reveal" || r.phase === "lobby") {
      await this.state.storage.delete("room");
      this.room = null;
      for (const ws of this.state.getWebSockets()) ws.close(1000, "Room expired");
      return;
    }
    if (!r.deadline || Date.now() < r.deadline) return;
    if (r.phase === "investigation") await this.setPhase(r, "discussion");
    else if (r.phase === "discussion") await this.setPhase(r, "timeline");
    else if (r.phase === "timeline") await this.setPhase(r, "voting");
    else if (r.phase === "voting") await this.reveal(r);
    r.version++;
    await this.save();
    this.broadcast();
  }
}
