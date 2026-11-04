import test from "node:test";
import assert from "node:assert/strict";
import {
  assignScenario,
  getScenario,
  LAST_LIGHT,
  SCENARIOS,
  validateScenario,
} from "../src/scenarios.ts";
import { projectSharedEvidence } from "../src/projections.ts";
import { GameRoom } from "../src/worker.ts";
import { AI_PERSONALITIES, chooseAiShares, chooseAiTimeline, chooseAiVote } from "../src/ai.ts";

test("registered scenarios have ordered truths and evidence coverage", () => {
  for (const scenario of Object.values(SCENARIOS)) validateScenario(scenario);
  assert.deepEqual(
    LAST_LIGHT.timeline.map((event) => event.id),
    ["m1", "m2", "m3", "m4"],
  );
  assert.equal(getScenario("midnight", 1), LAST_LIGHT);
  assert.throws(() => getScenario("midnight", 2), /Unsupported scenario version/);
});

test("scenario validation rejects unsupported events and duplicate IDs", () => {
  const missingSupport = structuredClone(LAST_LIGHT);
  missingSupport.clues.find((clue) => clue.id === "c2").supports = ["m3"];
  assert.throws(() => validateScenario(missingSupport), /needs at least two supporting clues/);

  const duplicateEvent = structuredClone(LAST_LIGHT);
  duplicateEvent.timeline[1].id = duplicateEvent.timeline[0].id;
  assert.throws(() => validateScenario(duplicateEvent), /unique, non-empty timeline event IDs/);

  const duplicateLook = structuredClone(LAST_LIGHT);
  duplicateLook.roomViews[1].look = duplicateLook.roomViews[0].look;
  assert.throws(() => validateScenario(duplicateLook), /unique, non-empty room view styles/);

  const invalidPosition = structuredClone(LAST_LIGHT);
  invalidPosition.objects[0].x = Number.NaN;
  assert.throws(() => validateScenario(invalidPosition), /invalid room object/);
});

test("4–8 participant assignments deal every clue once and keep room views distinct", () => {
  for (let count = 4; count <= 8; count++) {
    const players = Array.from({ length: count }, (_, index) => `p${index}`);
    const assignment = assignScenario(LAST_LIGHT, players, `assignment-seed-${count}`);
    const dealtClues = Object.values(assignment.clueIdsByPlayer).flat();
    const roomViews = Object.values(assignment.roomViewByPlayer).map((view) => view.id);
    const distorters = Object.values(assignment.roles).filter((role) => role === "distorter");
    const expectedAnomalies = Math.min(count, Math.max(2, Math.round(count / 3)));

    assert.equal(dealtClues.length, LAST_LIGHT.clues.length);
    assert.deepEqual([...dealtClues].sort(), LAST_LIGHT.clues.map((clue) => clue.id).sort());
    assert.ok(
      Math.max(...Object.values(assignment.clueIdsByPlayer).map((clues) => clues.length)) -
        Math.min(...Object.values(assignment.clueIdsByPlayer).map((clues) => clues.length)) <=
        1,
    );
    assert.equal(new Set(roomViews).size, count);
    assert.ok(
      Object.values(assignment.timelineItemsByPlayer).every(
        (items) =>
          items.length === LAST_LIGHT.timeline.length &&
          new Set(items).size === LAST_LIGHT.timeline.length,
      ),
    );
    assert.equal(distorters.length, 1);
    assert.equal(
      Object.values(assignment.anomalyIdByPlayer).filter(Boolean).length,
      expectedAnomalies,
    );
  }
});

test("timeline cards are independently shuffled and never expose the answer order", () => {
  const players = ["p1", "p2", "p3", "p4"];
  const assignment = assignScenario(LAST_LIGHT, players, "timeline-presentation");
  const correct = LAST_LIGHT.timeline.map((event) => event.id);
  assert.ok(
    players.some(
      (playerId) => assignment.timelineItemsByPlayer[playerId].join() !== correct.join(),
    ),
  );
  assert.deepEqual(
    assignment.timelineItemsByPlayer,
    assignScenario(LAST_LIGHT, players, "timeline-presentation").timelineItemsByPlayer,
  );

  const roster = players.map((playerId, index) => ({
    id: playerId,
    name: playerId,
    kind: "human",
    token: playerId,
    role: index === 0 ? "distorter" : "witness",
    ready: true,
    clueIds: [],
    inspectedClueIds: [],
    visitedHotspotIds: [],
    timelineItemIds: assignment.timelineItemsByPlayer[playerId],
    anomaly: null,
    connected: true,
    roomView: null,
  }));
  const room = {
    code: "TEST42",
    phase: "timeline",
    players: roster,
    created: 0,
    deadline: null,
    version: 1,
    scenario: "midnight",
    scenarioVersion: 1,
    seed: "timeline-presentation",
    votes: {},
    timelines: {},
    shared: [],
    chat: [],
    distortUsed: false,
    events: [],
  };
  const snapshot = new GameRoom({}, {}).publicView(room, roster[0]);
  assert.deepEqual(snapshot.timeline.items, assignment.timelineItemsByPlayer.p1);
  assert.notDeepEqual(snapshot.timeline.items, correct);
  assert.deepEqual(
    snapshot.timeline.milestones,
    snapshot.timeline.items.map(
      (item) => LAST_LIGHT.timeline.find((event) => event.id === item).text,
    ),
  );
});

test("a room seed reproduces role, evidence, view, and anomaly assignments", () => {
  const players = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"];
  assert.deepEqual(
    assignScenario(LAST_LIGHT, players, "stable-seed"),
    assignScenario(LAST_LIGHT, players, "stable-seed"),
  );
  assert.throws(
    () => assignScenario(LAST_LIGHT, players.slice(0, 3), "seed"),
    /between four and eight/,
  );
  assert.throws(
    () => assignScenario(LAST_LIGHT, [...players, "p9"], "seed"),
    /between four and eight/,
  );
});

test("Distorter assignment is balanced across many deterministic room seeds", () => {
  const counts = [0, 0, 0, 0];
  for (let run = 0; run < 2000; run++) {
    const players = ["p0", "p1", "p2", "p3"];
    const assignment = assignScenario(LAST_LIGHT, players, `distribution-${run}`);
    const distorter = Object.entries(assignment.roles).find(([, role]) => role === "distorter")[0];
    counts[players.indexOf(distorter)]++;
  }
  for (const count of counts)
    assert.ok(count > 440 && count < 560, `unexpected role frequency: ${counts.join(", ")}`);
});

test("shared evidence hides authoritative times until the reveal without mutating state", () => {
  const stored = [
    {
      id: "shared-1",
      owner: "p1",
      ownerName: "Witness",
      clueId: "c1",
      title: "Key",
      text: "A trace",
      time: "00:11",
      kind: "physical",
      room: "Foyer",
      displayTime: "00:12",
      distorted: true,
    },
  ];
  const duringRound = projectSharedEvidence(stored, false);
  assert.equal("time" in duringRound[0], false);
  assert.equal(duringRound[0].displayTime, "00:12");
  assert.equal(projectSharedEvidence(stored, true)[0].time, "00:11");
  assert.equal(stored[0].time, "00:11");
});

test("the live private snapshot exposes only the requesting player's role and clues", () => {
  const game = new GameRoom({}, {});
  const players = [
    {
      id: "p1",
      name: "One",
      kind: "human",
      token: "one",
      role: "distorter",
      ready: true,
      clueIds: ["c1"],
      inspectedClueIds: ["c1"],
      visitedHotspotIds: ["key-hook"],
      anomaly: null,
      connected: true,
      roomView: null,
    },
    {
      id: "p2",
      name: "Two",
      kind: "human",
      token: "two",
      role: "witness",
      ready: true,
      clueIds: ["c2"],
      inspectedClueIds: ["c2"],
      visitedHotspotIds: ["shutter-console"],
      anomaly: null,
      connected: true,
      roomView: null,
    },
    {
      id: "p3",
      name: "Three",
      kind: "human",
      token: "three",
      role: "witness",
      ready: true,
      clueIds: ["c3"],
      inspectedClueIds: [],
      visitedHotspotIds: [],
      anomaly: null,
      connected: true,
      roomView: null,
    },
    {
      id: "p4",
      name: "Four",
      kind: "human",
      token: "four",
      role: "witness",
      ready: true,
      clueIds: ["c4"],
      inspectedClueIds: [],
      visitedHotspotIds: [],
      anomaly: null,
      connected: true,
      roomView: null,
    },
  ];
  const room = {
    code: "TEST42",
    phase: "investigation",
    players,
    created: 0,
    deadline: null,
    version: 1,
    scenario: "midnight",
    scenarioVersion: 1,
    seed: "test",
    votes: {},
    timelines: {},
    shared: [
      {
        id: "shared-1",
        owner: "p2",
        ownerName: "Two",
        clueId: "c2",
        title: "Motor",
        text: "Trace",
        time: "00:14",
        kind: "sensor",
        room: "Dome",
        displayTime: "00:15",
        distorted: true,
      },
    ],
    chat: [],
    distortUsed: false,
    events: [],
  };
  const distorterView = game.publicView(room, players[0]);
  const witnessView = game.publicView(room, players[1]);

  assert.equal(distorterView.you.role, undefined);
  assert.equal(witnessView.you.role, undefined);
  assert.equal(distorterView.you.ability.id, "temporal-smear");
  assert.equal(witnessView.you.ability, null);
  assert.deepEqual(
    distorterView.you.clues.map((clue) => clue.id),
    ["c1"],
  );
  assert.deepEqual(
    witnessView.you.clues.map((clue) => clue.id),
    ["c2"],
  );
  assert.equal("supports" in distorterView.you.clues[0], false);
  assert.equal("supports" in witnessView.you.clues[0], false);
  assert.ok(distorterView.players.every((player) => !("role" in player)));
  assert.equal("time" in distorterView.shared[0], false);
  assert.equal(distorterView.result, undefined);
  assert.deepEqual(
    game.publicView(room, players[2]).you.clues,
    [],
    "assigned traces stay private until inspected",
  );
});

test("scenario clues point at valid inspectable room objects", () => {
  const objectIds = new Set(LAST_LIGHT.objects.map((object) => object.id));
  assert.ok(LAST_LIGHT.clues.every((clue) => objectIds.has(clue.hotspotId)));
  const invalid = structuredClone(LAST_LIGHT);
  invalid.clues[0].hotspotId = "missing-object";
  assert.throws(() => validateScenario(invalid), /incomplete clue data/);
});

test("server inspection reveals only assigned traces and blocks sharing before discovery", async () => {
  const p = {
    id: "p1",
    name: "Witness",
    kind: "human",
    token: "secret",
    role: "witness",
    ready: true,
    clueIds: ["c1", "c2"],
    inspectedClueIds: [],
    visitedHotspotIds: [],
    anomaly: null,
    connected: true,
    roomView: { id: "fogglass", look: "fogglass", title: "Cold glass", text: "A different room." },
  };
  const room = {
    code: "TEST42",
    phase: "investigation",
    players: [p],
    created: 0,
    deadline: null,
    version: 1,
    scenario: "midnight",
    scenarioVersion: 1,
    seed: "seed",
    votes: {},
    timelines: {},
    shared: [],
    chat: [],
    distortUsed: false,
    events: [],
  };
  const storage = { get: async () => room, put: async () => {} };
  const game = new GameRoom({ storage, getWebSockets: () => [] }, {});
  assert.deepEqual(game.publicView(room, p).you.clues, []);
  assert.equal((await game.action("secret", { type: "share", clueId: "c1" })).status, 400);
  const found = await game.action("secret", { type: "inspect", objectId: "key-hook" });
  const foundData = await found.json();
  assert.equal(found.status, 200);
  assert.deepEqual(foundData.found, ["Condensation on the key"]);
  assert.deepEqual(
    game.publicView(room, p).you.clues.map((clue) => clue.id),
    ["c1"],
  );
  assert.equal("supports" in game.publicView(room, p).you.clues[0], false);
  assert.equal("hotspotId" in game.publicView(room, p).you.clues[0], false);
  assert.equal(
    (await game.action("secret", { type: "inspect", objectId: "key-hook" })).status,
    400,
  );
  assert.equal(
    (await game.action("secret", { type: "inspect", objectId: "not-an-object" })).status,
    400,
  );
});

test("rooms saved by the previous version receive a non-disruptive scenario/participant migration", async () => {
  const legacyRoom = {
    code: "OLD123",
    phase: "lobby",
    players: [
      {
        id: "p1",
        name: "Host",
        token: "legacy-token",
        role: null,
        ready: false,
        clueIds: [],
        anomaly: null,
        connected: false,
        roomView: null,
      },
    ],
    created: 0,
    deadline: null,
    version: 1,
    scenario: "midnight",
    seed: "legacy-seed",
    votes: {},
    timelines: {},
    shared: [],
    chat: [],
    distortUsed: false,
    events: [],
  };
  let saved;
  const state = {
    storage: {
      get: async () => structuredClone(legacyRoom),
      put: async (_key, value) => {
        saved = value;
      },
    },
  };
  const migrated = await new GameRoom(state, {}).load();

  assert.equal(migrated.scenarioVersion, 1);
  assert.equal(migrated.players[0].kind, "human");
  assert.equal(migrated.players[0].token, "legacy-token");
  assert.deepEqual(migrated.players[0].timelineItemIds, []);
  assert.equal(saved.scenarioVersion, 1);
});

test("the server rejects unsupported Distorter directions without changing evidence", async () => {
  const room = {
    code: "TEST42",
    phase: "discussion",
    players: [
      {
        id: "p1",
        name: "Distorter",
        kind: "human",
        token: "secret",
        role: "distorter",
        ready: true,
        clueIds: [],
        inspectedClueIds: [],
        visitedHotspotIds: [],
        anomaly: null,
        connected: true,
        roomView: null,
      },
    ],
    created: 0,
    deadline: null,
    version: 1,
    scenario: "midnight",
    scenarioVersion: 1,
    seed: "seed",
    votes: {},
    timelines: {},
    shared: [
      {
        id: "shared-1",
        owner: "p2",
        ownerName: "Witness",
        clueId: "c2",
        title: "Motor",
        text: "Trace",
        time: "00:14",
        kind: "sensor",
        room: "Dome",
        displayTime: "00:14",
      },
    ],
    chat: [],
    distortUsed: false,
    events: [],
  };
  const game = new GameRoom({ storage: { get: async () => room, put: async () => {} } }, {});
  const response = await game.action("secret", {
    type: "distort",
    sharedId: "shared-1",
    direction: "sideways",
  });

  assert.equal(response.status, 400);
  assert.equal(room.shared[0].displayTime, "00:14");
  assert.equal(room.distortUsed, false);
});

test("eight AI personalities have distinct profiles and share only clues they were assigned", () => {
  assert.equal(AI_PERSONALITIES.length, 8);
  assert.equal(new Set(AI_PERSONALITIES.map((profile) => profile.id)).size, 8);
  assert.equal(new Set(AI_PERSONALITIES.map((profile) => profile.name)).size, 8);
  const clues = LAST_LIGHT.clues.slice(0, 3);
  for (const profile of AI_PERSONALITIES) {
    const selected = chooseAiShares(profile.id, clues, [], "investigation", "fixed-seed");
    assert.ok(selected.length >= 1);
    assert.ok(selected.every((clueId) => clues.some((clue) => clue.id === clueId)));
  }
  assert.deepEqual(
    chooseAiShares(
      "quiet-witness",
      clues,
      clues.map((clue) => clue.id),
      "discussion",
      "fixed-seed",
    ),
    [],
    "an AI cannot share a clue it already revealed",
  );
});

test("AI timeline guesses are stable, complete, and accept only observed event cards and evidence", () => {
  const events = LAST_LIGHT.timeline.map(({ id, text }) => ({ id, text }));
  const evidence = LAST_LIGHT.clues
    .slice(0, 4)
    .map(({ title, text, time }) => ({ title, text, time }));
  const first = chooseAiTimeline("archivist", events, evidence, "solo-test");
  assert.deepEqual(chooseAiTimeline("archivist", events, evidence, "solo-test"), first);
  assert.deepEqual([...first].sort(), LAST_LIGHT.timeline.map((event) => event.id).sort());
});

test("AI votes use public chat and never select themselves", () => {
  const players = [
    { id: "human", name: "Witness", kind: "human" },
    { id: "bot-a", name: "Mara Voss", kind: "ai" },
    { id: "bot-b", name: "Ivo Chen", kind: "ai" },
    { id: "bot-c", name: "Nia Vale", kind: "ai" },
  ];
  const vote = chooseAiVote(
    "archivist",
    players,
    [{ playerId: "human", text: "I suspect Ivo Chen may be the Distorter." }],
    "bot-a",
    "solo-vote",
  );
  assert.ok(players.some((player) => player.id === vote && player.id !== "bot-a"));
});

test("solo room creates three ready AI witnesses and preserves private information boundaries", async () => {
  let saved;
  const state = {
    storage: {
      get: async () => null,
      put: async (_key, value) => {
        saved = structuredClone(value);
      },
      setAlarm: async () => {},
    },
    getWebSockets: () => [],
  };
  const game = new GameRoom(state, {});
  const created = await game.create("Solo Host", "SOLO42", "solo");
  const session = await created.json();
  let room = await game.load();

  assert.equal(room.mode, "solo");
  assert.equal(room.players.length, 4);
  assert.equal(room.players.filter((player) => player.kind === "ai").length, 3);
  assert.equal(
    new Set(room.players.filter((player) => player.kind === "ai").map((player) => player.profileId))
      .size,
    3,
  );
  assert.ok(room.players.filter((player) => player.kind === "ai").every((player) => player.ready));
  assert.ok(
    room.players.filter((player) => player.kind === "ai").every((player) => player.token === null),
  );

  await game.action(session.token, { type: "ready", ready: true });
  await game.action(session.token, { type: "start" });
  room = await game.load();
  assert.equal(room.phase, "investigation");
  assert.equal(room.players.filter((player) => player.role === "distorter").length, 1);
  assert.equal(
    room.aiTasks.some((task) => task.type === "investigate"),
    true,
  );

  const before = game.publicView(room, room.players[0]);
  assert.equal(before.you.role, undefined);
  assert.ok(before.players.every((player) => !Object.hasOwn(player, "role")));
  await game.runAiInvestigation(room);
  const after = game.publicView(room, room.players[0]);
  const sharedIds = after.shared.map((clue) => clue.clueId);
  const privateAiClues = room.players
    .filter((player) => player.kind === "ai")
    .flatMap((player) => player.clueIds.filter((clueId) => !sharedIds.includes(clueId)));
  assert.ok(
    privateAiClues.every((clueId) => !after.you.clues.some((clue) => clue.id === clueId)),
    "an AI's unshared clue must stay out of the human's private journal",
  );
  assert.ok(after.players.every((player) => !Object.hasOwn(player, "clueIds")));
  assert.equal(saved.mode, "solo");
});

test("a host can fill a mixed room with AI while a non-host cannot alter the lobby", async () => {
  const state = {
    storage: { get: async () => null, put: async () => {}, setAlarm: async () => {} },
    getWebSockets: () => [],
  };
  const game = new GameRoom(state, {});
  const created = await game.create("Host", "MIXED1");
  const host = await created.json();
  const joined = await game.join("Guest");
  const guest = await joined.json();
  assert.equal((await game.action(guest.token, { type: "add-ai" })).status, 400);
  await game.action(host.token, { type: "add-ai" });
  const room = await game.load();
  assert.equal(room.players.length, 3);
  assert.equal(room.players[2].kind, "ai");
  assert.equal(room.players[2].ready, true);
});
