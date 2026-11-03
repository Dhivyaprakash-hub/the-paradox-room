export type Role = "witness" | "distorter";

export interface ScenarioEvent {
  id: string;
  time: string;
  text: string;
}

export interface Clue {
  id: string;
  title: string;
  text: string;
  time: string;
  kind: "physical" | "sensor" | "memory";
  room: string;
  supports: string[];
  hotspotId: string;
}

export interface RoomObject {
  id: string;
  label: string;
  zone: string;
  description: string;
  x: number;
  y: number;
}

export interface RoomView {
  id: string;
  look: string;
  title: string;
  text: string;
}

export interface EnvironmentalAnomaly {
  id: string;
  title: string;
  text: string;
}

export interface DistorterAbility {
  id: string;
  label: string;
  text: string;
  effect: "shift_shared_timestamp";
  uses: number;
  shiftMinutes: number;
}

export interface ScenarioDefinition {
  id: string;
  version: number;
  title: string;
  location: string;
  objects: RoomObject[];
  timeline: ScenarioEvent[];
  clues: Clue[];
  roomViews: RoomView[];
  anomalies: EnvironmentalAnomaly[];
  distorterAbility: DistorterAbility;
}

const ROOM_VIEWS: RoomView[] = [
  {
    id: "prism",
    look: "prism",
    title: "Split prism",
    text: "The dome's slit fractures the same star into three faint lights. One of them moves when you do.",
  },
  {
    id: "fogglass",
    look: "fogglass",
    title: "Cold glass",
    text: "A milky film clouds the east window. Behind it, the stars look submerged beneath black water.",
  },
  {
    id: "redlamp",
    look: "redlamp",
    title: "Red filament",
    text: "The archive lamp burns red in your version of the room. Its shadow points toward a wall with no switch.",
  },
  {
    id: "doubleshadow",
    look: "doubleshadow",
    title: "Double shadow",
    text: "Your shadow falls twice: once toward the dome, and once toward a door that is not there.",
  },
  {
    id: "keymirror",
    look: "keymirror",
    title: "Mirrored hook",
    text: "The brass key hook appears in the foyer mirror, but the reflection is empty even when the real hook is not.",
  },
  {
    id: "clockface",
    look: "clockface",
    title: "Clock without hands",
    text: "The dome clock's hands have vanished. A thin circle of fresh scratches marks where they used to point.",
  },
  {
    id: "starwell",
    look: "starwell",
    title: "The star well",
    text: "A cold shaft of starlight reaches the floor beneath the dome. The opening is sealed from the outside.",
  },
  {
    id: "copperseam",
    look: "copperseam",
    title: "Copper seam",
    text: "A copper line runs through the floor and stops at the archive wall. The metal is warm under your palm.",
  },
];

export const LAST_LIGHT: ScenarioDefinition = {
  id: "midnight",
  version: 1,
  title: "The Last Light",
  location: "The Orpheum Observatory",
  objects: [
    {
      id: "key-hook",
      label: "Brass key hook",
      zone: "Foyer",
      description: "A row of old iron hooks hangs beside the entrance.",
      x: 13,
      y: 52,
    },
    {
      id: "coat",
      label: "Visitor's coat",
      zone: "Foyer",
      description: "A dark coat hangs from a wooden peg, dusted with fine brass powder.",
      x: 20,
      y: 69,
    },
    {
      id: "dome-window",
      label: "Dome slit",
      zone: "Dome",
      description: "A narrow window cuts through the observatory dome.",
      x: 33,
      y: 29,
    },
    {
      id: "shutter-console",
      label: "Shutter console",
      zone: "Dome",
      description: "A brass control box is wired to the western telescope shutter.",
      x: 43,
      y: 57,
    },
    {
      id: "dome-clock",
      label: "Dome clock",
      zone: "Dome",
      description: "A heavy clock is fixed above the archway.",
      x: 52,
      y: 23,
    },
    {
      id: "logbook",
      label: "Open logbook",
      zone: "Archive",
      description: "A ledger lies open on the archive desk.",
      x: 63,
      y: 67,
    },
    {
      id: "archive-lamp",
      label: "Archive lamp",
      zone: "Archive",
      description: "A green-shaded lamp throws a narrow pool of light over the desk.",
      x: 74,
      y: 55,
    },
    {
      id: "lamp-switch",
      label: "Lamp switch",
      zone: "Archive",
      description: "A ceramic switch plate is mounted beside the archive arch.",
      x: 79,
      y: 38,
    },
    {
      id: "power-panel",
      label: "Power panel",
      zone: "Service hall",
      description: "A locked service panel hums behind a narrow iron grille.",
      x: 89,
      y: 31,
    },
    {
      id: "stair-recorder",
      label: "Acoustic recorder",
      zone: "North stair",
      description: "A small recorder is bolted to the stair rail.",
      x: 89,
      y: 72,
    },
    {
      id: "stair-vent",
      label: "North stair vent",
      zone: "North stair",
      description: "Cold air slips through a narrow vent above the stairwell.",
      x: 96,
      y: 52,
    },
  ],
  timeline: [
    { id: "m1", time: "00:11", text: "Mara entered the archive with the brass key." },
    { id: "m2", time: "00:14", text: "The west telescope shutter was opened." },
    { id: "m3", time: "00:18", text: "The archive lamp lost power." },
    { id: "m4", time: "00:21", text: "The brass key was returned to the foyer desk." },
  ],
  clues: [
    {
      id: "c1",
      title: "Condensation on the key",
      text: "A clean crescent in the dust shows the brass key was lifted from its hook, then returned with its teeth facing east.",
      time: "00:11",
      kind: "physical",
      room: "Foyer",
      supports: ["m1", "m4"],
      hotspotId: "key-hook",
    },
    {
      id: "c2",
      title: "Shutter motor log",
      text: "The west shutter motor drew current for eleven seconds. Its manual override was untouched.",
      time: "00:14",
      kind: "sensor",
      room: "Dome",
      supports: ["m2"],
      hotspotId: "shutter-console",
    },
    {
      id: "c3",
      title: "Warm filament",
      text: "The archive lamp filament is warm, but its glass is intact. The trace cannot distinguish a switch from a circuit interruption.",
      time: "00:18",
      kind: "physical",
      room: "Archive",
      supports: ["m3"],
      hotspotId: "archive-lamp",
    },
    {
      id: "c4",
      title: "A page torn cleanly",
      text: "A page was removed from the logbook. The torn fibers show the book was closed before the lamp went dark.",
      time: "00:17",
      kind: "physical",
      room: "Archive",
      supports: ["m3"],
      hotspotId: "logbook",
    },
    {
      id: "c5",
      title: "North stair echo",
      text: "The acoustic recorder caught two descending footsteps at 00:22. The second step was heavier.",
      time: "00:22",
      kind: "sensor",
      room: "North stair",
      supports: ["m4"],
      hotspotId: "stair-recorder",
    },
    {
      id: "c6",
      title: "Mara's sleeve",
      text: "Fine brass dust clings to Mara's right cuff. She says she never entered the foyer.",
      time: "00:12",
      kind: "physical",
      room: "Foyer",
      supports: ["m1"],
      hotspotId: "coat",
    },
    {
      id: "c7",
      title: "Cloud cover memory",
      text: "You remember the dome slit showing a clear sky just before the lamp failed.",
      time: "00:16",
      kind: "memory",
      room: "Dome",
      supports: ["m3"],
      hotspotId: "dome-window",
    },
    {
      id: "c8",
      title: "The empty hook",
      text: "The brass key hook swung gently when you entered. The rest of the key board was still.",
      time: "00:10",
      kind: "memory",
      room: "Foyer",
      supports: ["m1"],
      hotspotId: "key-hook",
    },
    {
      id: "c9",
      title: "Switch plate",
      text: "A smear of lampblack sits below the archive switch. It could be soot from the lamp—or a gloved thumb.",
      time: "00:19",
      kind: "physical",
      room: "Archive",
      supports: ["m3"],
      hotspotId: "lamp-switch",
    },
    {
      id: "c10",
      title: "A second-hand stopped",
      text: "The dome clock stopped at 00:14. Its battery is fresh; the hands were pushed back into place.",
      time: "00:15",
      kind: "physical",
      room: "Dome",
      supports: ["m2"],
      hotspotId: "dome-clock",
    },
    {
      id: "c11",
      title: "Foyer draft",
      text: "A cold draft crossed the foyer from the north stair after the lamp went dark.",
      time: "00:20",
      kind: "memory",
      room: "Foyer",
      supports: ["m4"],
      hotspotId: "stair-vent",
    },
    {
      id: "c12",
      title: "Power panel",
      text: "The archive circuit was opened manually. The panel records no overload and no other room lost power.",
      time: "00:18",
      kind: "sensor",
      room: "Service hall",
      supports: ["m3"],
      hotspotId: "power-panel",
    },
  ],
  roomViews: ROOM_VIEWS,
  anomalies: [
    {
      id: "room-blink",
      title: "THE ROOM BLINKED",
      text: "For one impossible second, you saw the archive lamp glowing blue. It may be an environmental echo: the room sometimes fabricates memories, independent of any player.",
    },
  ],
  distorterAbility: {
    id: "temporal-smear",
    label: "Temporal smear",
    text: "Your one use can shift a shared clue's displayed timestamp by one minute. The original record remains recoverable at the reveal. Choose your moment.",
    effect: "shift_shared_timestamp",
    uses: 1,
    shiftMinutes: 1,
  },
};

export const SCENARIOS: Record<string, ScenarioDefinition> = { [LAST_LIGHT.id]: LAST_LIGHT };
export const DEFAULT_SCENARIO_ID = LAST_LIGHT.id;
export const SCENARIO_VERSIONS: Record<string, Record<number, ScenarioDefinition>> = {
  [LAST_LIGHT.id]: { [LAST_LIGHT.version]: LAST_LIGHT },
};

export function getScenario(id: string, version: number): ScenarioDefinition {
  const scenario = SCENARIO_VERSIONS[id]?.[version];
  if (!scenario) throw new Error(`Unsupported scenario version: ${id}@${version}.`);
  return scenario;
}

export interface ScenarioAssignment {
  roles: Record<string, Role>;
  clueIdsByPlayer: Record<string, string[]>;
  roomViewByPlayer: Record<string, RoomView>;
  anomalyIdByPlayer: Record<string, string | null>;
  timelineItemsByPlayer: Record<string, string[]>;
}

function minutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const mins = Number(match[2]);
  return hours < 24 && mins < 60 ? hours * 60 + mins : null;
}

function assertUnique(values: string[], label: string): void {
  if (values.some((value) => !value) || new Set(values).size !== values.length) {
    throw new Error(`Scenario data must have unique, non-empty ${label}.`);
  }
}

export function validateScenario(scenario: ScenarioDefinition): void {
  if (
    !scenario.id ||
    !Number.isInteger(scenario.version) ||
    scenario.version < 1 ||
    !scenario.title ||
    !scenario.location
  ) {
    throw new Error("Scenario identity, version, title, and location are required.");
  }
  assertUnique(
    scenario.objects.map((object) => object.id),
    "room object IDs",
  );
  if (
    scenario.objects.some(
      (object) =>
        !object.label.trim() ||
        !object.zone.trim() ||
        !object.description.trim() ||
        !Number.isFinite(object.x) ||
        !Number.isFinite(object.y) ||
        object.x < 0 ||
        object.x > 100 ||
        object.y < 0 ||
        object.y > 100,
    )
  ) {
    throw new Error(`Scenario ${scenario.id} has an invalid room object.`);
  }
  const objectIds = new Set(scenario.objects.map((object) => object.id));
  if (scenario.timeline.length < 2)
    throw new Error(`Scenario ${scenario.id} needs at least two timeline events.`);
  assertUnique(
    scenario.timeline.map((event) => event.id),
    "timeline event IDs",
  );
  const eventIds = new Set(scenario.timeline.map((event) => event.id));
  let previousTime = -1;
  for (const event of scenario.timeline) {
    const time = minutes(event.time);
    if (time === null || time <= previousTime || !event.text.trim()) {
      throw new Error(`Scenario ${scenario.id} has an invalid or unordered timeline event.`);
    }
    previousTime = time;
  }

  if (scenario.clues.length < 8)
    throw new Error(`Scenario ${scenario.id} needs enough clues to cover eight players.`);
  assertUnique(
    scenario.clues.map((clue) => clue.id),
    "clue IDs",
  );
  const supportCounts = new Map(scenario.timeline.map((event) => [event.id, 0]));
  for (const clue of scenario.clues) {
    if (
      !clue.title.trim() ||
      !clue.text.trim() ||
      !clue.room.trim() ||
      minutes(clue.time) === null ||
      clue.supports.length === 0 ||
      !objectIds.has(clue.hotspotId)
    ) {
      throw new Error(`Scenario ${scenario.id} has incomplete clue data.`);
    }
    assertUnique(clue.supports, `support links on clue ${clue.id}`);
    for (const eventId of clue.supports) {
      if (!eventIds.has(eventId))
        throw new Error(`Clue ${clue.id} references unknown event ${eventId}.`);
      supportCounts.set(eventId, supportCounts.get(eventId)! + 1);
    }
  }
  for (const [eventId, count] of supportCounts) {
    if (count < 2)
      throw new Error(`Timeline event ${eventId} needs at least two supporting clues.`);
  }

  if (scenario.roomViews.length < 8)
    throw new Error(`Scenario ${scenario.id} needs eight distinct room views.`);
  assertUnique(
    scenario.roomViews.map((view) => view.id),
    "room view IDs",
  );
  assertUnique(
    scenario.roomViews.map((view) => view.look),
    "room view styles",
  );
  if (scenario.roomViews.some((view) => !view.look || !view.title.trim() || !view.text.trim())) {
    throw new Error(`Scenario ${scenario.id} has an incomplete room view.`);
  }
  if (scenario.anomalies.length < 1)
    throw new Error(`Scenario ${scenario.id} needs an environmental anomaly.`);
  assertUnique(
    scenario.anomalies.map((anomaly) => anomaly.id),
    "anomaly IDs",
  );
  if (scenario.anomalies.some((anomaly) => !anomaly.title.trim() || !anomaly.text.trim())) {
    throw new Error(`Scenario ${scenario.id} has incomplete anomaly data.`);
  }
  if (
    scenario.distorterAbility.effect !== "shift_shared_timestamp" ||
    scenario.distorterAbility.uses < 1 ||
    scenario.distorterAbility.shiftMinutes < 1
  ) {
    throw new Error(`Scenario ${scenario.id} has an unsupported Distorter ability.`);
  }
}

function createSeededRandom(seed: string): () => number {
  let state = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    state ^= seed.charCodeAt(i);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(values: T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

export function assignScenario(
  scenario: ScenarioDefinition,
  playerIds: string[],
  seed: string,
): ScenarioAssignment {
  validateScenario(scenario);
  if (playerIds.length < 4 || playerIds.length > 8)
    throw new Error("A scenario needs between four and eight participants.");
  assertUnique(playerIds, "participant IDs");
  if (!seed) throw new Error("A deterministic assignment seed is required.");

  const roleRandom = createSeededRandom(`${seed}:roles`);
  const roles: Record<string, Role> = {};
  shuffle(playerIds, roleRandom).forEach((playerId, index) => {
    roles[playerId] = index === 0 ? "distorter" : "witness";
  });

  const clueIdsByPlayer: Record<string, string[]> = Object.fromEntries(
    playerIds.map((playerId) => [playerId, []]),
  );
  shuffle(scenario.clues, createSeededRandom(`${seed}:clues`)).forEach((clue, index) =>
    clueIdsByPlayer[playerIds[index % playerIds.length]].push(clue.id),
  );

  const roomViewByPlayer: Record<string, RoomView> = {};
  shuffle(scenario.roomViews, createSeededRandom(`${seed}:views`))
    .slice(0, playerIds.length)
    .forEach((view, index) => {
      roomViewByPlayer[playerIds[index]] = view;
    });

  const anomalyIdByPlayer: Record<string, string | null> = Object.fromEntries(
    playerIds.map((playerId) => [playerId, null]),
  );
  const anomalyCount = Math.min(playerIds.length, Math.max(2, Math.round(playerIds.length / 3)));
  const anomalyRandom = createSeededRandom(`${seed}:anomalies`);
  shuffle(playerIds, anomalyRandom)
    .slice(0, anomalyCount)
    .forEach((playerId) => {
      anomalyIdByPlayer[playerId] =
        scenario.anomalies[Math.floor(anomalyRandom() * scenario.anomalies.length)].id;
    });

  const timelineItemsByPlayer: Record<string, string[]> = {};
  for (const playerId of playerIds) {
    timelineItemsByPlayer[playerId] = shuffle(
      scenario.timeline.map((event) => event.id),
      createSeededRandom(`${seed}:timeline:${playerId}`),
    );
  }

  return { roles, clueIdsByPlayer, roomViewByPlayer, anomalyIdByPlayer, timelineItemsByPlayer };
}
