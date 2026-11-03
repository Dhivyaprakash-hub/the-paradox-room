import test from "node:test";
import assert from "node:assert/strict";
import { assignScenario, getScenario, LAST_LIGHT, SCENARIOS, validateScenario } from "../src/scenarios.ts";
import { projectSharedEvidence } from "../src/projections.ts";
import { GameRoom } from "../src/worker.ts";

test("registered scenarios have ordered truths and evidence coverage", () => {
  for (const scenario of Object.values(SCENARIOS)) validateScenario(scenario);
  assert.deepEqual(LAST_LIGHT.timeline.map(event => event.id), ["m1", "m2", "m3", "m4"]);
  assert.equal(getScenario("midnight", 1), LAST_LIGHT);
  assert.throws(() => getScenario("midnight", 2), /Unsupported scenario version/);
});

test("scenario validation rejects unsupported events and duplicate IDs", () => {
  const missingSupport = structuredClone(LAST_LIGHT);
  missingSupport.clues.find(clue => clue.id === "c2").supports = ["m3"];
  assert.throws(() => validateScenario(missingSupport), /needs at least two supporting clues/);

  const duplicateEvent = structuredClone(LAST_LIGHT);
  duplicateEvent.timeline[1].id = duplicateEvent.timeline[0].id;
  assert.throws(() => validateScenario(duplicateEvent), /unique, non-empty timeline event IDs/);
});

test("4–8 participant assignments deal every clue once and keep room views distinct", () => {
  for (let count = 4; count <= 8; count++) {
    const players = Array.from({ length: count }, (_, index) => `p${index}`);
    const assignment = assignScenario(LAST_LIGHT, players, `assignment-seed-${count}`);
    const dealtClues = Object.values(assignment.clueIdsByPlayer).flat();
    const roomViews = Object.values(assignment.roomViewByPlayer).map(view => view.id);
    const distorters = Object.values(assignment.roles).filter(role => role === "distorter");
    const expectedAnomalies = Math.min(count, Math.max(2, Math.round(count / 3)));

    assert.equal(dealtClues.length, LAST_LIGHT.clues.length);
    assert.deepEqual([...dealtClues].sort(), LAST_LIGHT.clues.map(clue => clue.id).sort());
    assert.ok(Math.max(...Object.values(assignment.clueIdsByPlayer).map(clues => clues.length)) - Math.min(...Object.values(assignment.clueIdsByPlayer).map(clues => clues.length)) <= 1);
    assert.equal(new Set(roomViews).size, count);
    assert.equal(distorters.length, 1);
    assert.equal(Object.values(assignment.anomalyIdByPlayer).filter(Boolean).length, expectedAnomalies);
  }
});

test("a room seed reproduces role, evidence, view, and anomaly assignments", () => {
  const players = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"];
  assert.deepEqual(assignScenario(LAST_LIGHT, players, "stable-seed"), assignScenario(LAST_LIGHT, players, "stable-seed"));
  assert.throws(() => assignScenario(LAST_LIGHT, players.slice(0, 3), "seed"), /between four and eight/);
  assert.throws(() => assignScenario(LAST_LIGHT, [...players, "p9"], "seed"), /between four and eight/);
});

test("Distorter assignment is balanced across many deterministic room seeds", () => {
  const counts = [0, 0, 0, 0];
  for (let run = 0; run < 2000; run++) {
    const players = ["p0", "p1", "p2", "p3"];
    const assignment = assignScenario(LAST_LIGHT, players, `distribution-${run}`);
    const distorter = Object.entries(assignment.roles).find(([, role]) => role === "distorter")[0];
    counts[players.indexOf(distorter)]++;
  }
  for (const count of counts) assert.ok(count > 440 && count < 560, `unexpected role frequency: ${counts.join(", ")}`);
});

test("shared evidence hides authoritative times until the reveal without mutating state", () => {
  const stored = [{ id: "shared-1", owner: "p1", ownerName: "Witness", clueId: "c1", title: "Key", text: "A trace", time: "00:11", kind: "physical", room: "Foyer", displayTime: "00:12", distorted: true }];
  const duringRound = projectSharedEvidence(stored, false);
  assert.equal("time" in duringRound[0], false);
  assert.equal(duringRound[0].displayTime, "00:12");
  assert.equal(projectSharedEvidence(stored, true)[0].time, "00:11");
  assert.equal(stored[0].time, "00:11");
});

test("the live private snapshot exposes only the requesting player's role and clues", () => {
  const game = new GameRoom({}, {});
  const players = [
    { id: "p1", name: "One", kind: "human", token: "one", role: "distorter", ready: true, clueIds: ["c1"], anomaly: null, connected: true, roomView: null },
    { id: "p2", name: "Two", kind: "human", token: "two", role: "witness", ready: true, clueIds: ["c2"], anomaly: null, connected: true, roomView: null },
    { id: "p3", name: "Three", kind: "human", token: "three", role: "witness", ready: true, clueIds: ["c3"], anomaly: null, connected: true, roomView: null },
    { id: "p4", name: "Four", kind: "human", token: "four", role: "witness", ready: true, clueIds: ["c4"], anomaly: null, connected: true, roomView: null },
  ];
  const room = {
    code: "TEST42", phase: "investigation", players, created: 0, deadline: null, version: 1,
    scenario: "midnight", scenarioVersion: 1, seed: "test", votes: {}, timelines: {},
    shared: [{ id: "shared-1", owner: "p2", ownerName: "Two", clueId: "c2", title: "Motor", text: "Trace", time: "00:14", kind: "sensor", room: "Dome", displayTime: "00:15", distorted: true }],
    chat: [], distortUsed: false, events: [],
  };
  const distorterView = game.publicView(room, players[0]);
  const witnessView = game.publicView(room, players[1]);

  assert.equal(distorterView.you.role, undefined);
  assert.equal(witnessView.you.role, undefined);
  assert.equal(distorterView.you.ability.id, "temporal-smear");
  assert.equal(witnessView.you.ability, null);
  assert.deepEqual(distorterView.you.clues.map(clue => clue.id), ["c1"]);
  assert.deepEqual(witnessView.you.clues.map(clue => clue.id), ["c2"]);
  assert.equal("supports" in distorterView.you.clues[0], false);
  assert.equal("supports" in witnessView.you.clues[0], false);
  assert.ok(distorterView.players.every(player => !("role" in player)));
  assert.equal("time" in distorterView.shared[0], false);
  assert.equal(distorterView.result, undefined);
});

test("rooms saved by the previous version receive a non-disruptive scenario/participant migration", async () => {
  const legacyRoom = {
    code: "OLD123", phase: "lobby", players: [{ id: "p1", name: "Host", token: "legacy-token", role: null, ready: false, clueIds: [], anomaly: null, connected: false, roomView: null }],
    created: 0, deadline: null, version: 1, scenario: "midnight", seed: "legacy-seed", votes: {}, timelines: {}, shared: [], chat: [], distortUsed: false, events: [],
  };
  let saved;
  const state = { storage: { get: async () => structuredClone(legacyRoom), put: async (_key, value) => { saved = value; } } };
  const migrated = await new GameRoom(state, {}).load();

  assert.equal(migrated.scenarioVersion, 1);
  assert.equal(migrated.players[0].kind, "human");
  assert.equal(migrated.players[0].token, "legacy-token");
  assert.equal(saved.scenarioVersion, 1);
});

test("the server rejects unsupported Distorter directions without changing evidence", async () => {
  const room = {
    code: "TEST42", phase: "discussion", players: [{ id: "p1", name: "Distorter", kind: "human", token: "secret", role: "distorter", ready: true, clueIds: [], anomaly: null, connected: true, roomView: null }],
    created: 0, deadline: null, version: 1, scenario: "midnight", scenarioVersion: 1, seed: "seed", votes: {}, timelines: {},
    shared: [{ id: "shared-1", owner: "p2", ownerName: "Witness", clueId: "c2", title: "Motor", text: "Trace", time: "00:14", kind: "sensor", room: "Dome", displayTime: "00:14" }],
    chat: [], distortUsed: false, events: [],
  };
  const game = new GameRoom({ storage: { get: async () => room } }, {});
  const response = await game.action("secret", { type: "distort", sharedId: "shared-1", direction: "sideways" });

  assert.equal(response.status, 400);
  assert.equal(room.shared[0].displayTime, "00:14");
  assert.equal(room.distortUsed, false);
});
