export type AiPersonalityId =
  | "archivist"
  | "skeptic"
  | "storyteller"
  | "pattern-reader"
  | "contrarian"
  | "quiet-witness"
  | "careful-witness"
  | "provocateur";

export type AiPhase = "investigation" | "discussion";

export interface AiEvidence {
  title: string;
  text: string;
  time: string;
}

export interface AiTimelineEvent {
  id: string;
  text: string;
}

export interface AiPlayerView {
  id: string;
  name: string;
  kind: "human" | "ai";
}

export interface AiChatLine {
  playerId: string;
  text: string;
}

export const AI_PERSONALITIES = [
  {
    id: "archivist",
    name: "Mara Voss",
    title: "The Archivist",
    manner: "Precise and methodical. She shares clear records and asks for corroboration.",
    shareRate: 0.85,
    timelineNoise: 0,
    voteStyle: "evidence",
  },
  {
    id: "skeptic",
    name: "Ivo Chen",
    title: "The Skeptic",
    manner: "Questions confident claims and prefers sensor records over memory.",
    shareRate: 0.65,
    timelineNoise: 1,
    voteStyle: "challenge",
  },
  {
    id: "storyteller",
    name: "Nia Vale",
    title: "The Storyteller",
    manner: "Thinks in scenes and cause-and-effect, and explains her reasoning aloud.",
    shareRate: 0.8,
    timelineNoise: 1,
    voteStyle: "social",
  },
  {
    id: "pattern-reader",
    name: "Ada Kline",
    title: "The Pattern Reader",
    manner: "Looks for repeated details and checks whether times agree across records.",
    shareRate: 0.9,
    timelineNoise: 0,
    voteStyle: "evidence",
  },
  {
    id: "contrarian",
    name: "Rook Mercer",
    title: "The Contrarian",
    manner: "Tests the group's leading theory and is wary of easy consensus.",
    shareRate: 0.5,
    timelineNoise: 2,
    voteStyle: "contrarian",
  },
  {
    id: "quiet-witness",
    name: "Sol Reyes",
    title: "The Quiet Witness",
    manner: "Keeps a low profile, listens first, and shares only a few useful traces.",
    shareRate: 0.45,
    timelineNoise: 2,
    voteStyle: "quiet",
  },
  {
    id: "careful-witness",
    name: "Lena Osei",
    title: "The Careful Witness",
    manner: "Separates what she saw from what she only suspects.",
    shareRate: 0.65,
    timelineNoise: 1,
    voteStyle: "careful",
  },
  {
    id: "provocateur",
    name: "Vex Rowan",
    title: "The Provocateur",
    manner: "Pushes witnesses to explain themselves and shares evidence dramatically.",
    shareRate: 0.75,
    timelineNoise: 1,
    voteStyle: "challenge",
  },
] as const;

export type AiPersonality = (typeof AI_PERSONALITIES)[number];

export function getAiPersonality(id: string | null | undefined): AiPersonality | null {
  return AI_PERSONALITIES.find((profile) => profile.id === id) || null;
}

function hash(value: string): number {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) {
    result ^= value.charCodeAt(i);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function seededRandom(seed: string): () => number {
  let state = hash(seed) || 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(values: T[], seed: string): T[] {
  const result = [...values];
  const random = seededRandom(seed);
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

export function chooseAiShares(
  personalityId: string,
  clues: { id: string; title: string; text: string; kind: string; time: string }[],
  alreadyShared: string[],
  phase: AiPhase,
  seed: string,
): string[] {
  const profile = getAiPersonality(personalityId);
  if (!profile || !clues.length) return [];
  const available = clues.filter((clue) => !alreadyShared.includes(clue.id));
  if (!available.length) return [];

  const ordered = seededShuffle(available, `${seed}:${profile.id}:${phase}`);
  if (phase === "discussion") {
    const chance = seededRandom(`${seed}:${profile.id}:second-share`)();
    if (chance > profile.shareRate) return [];
    return ordered.slice(0, 1).map((clue) => clue.id);
  }

  const count = Math.max(1, Math.round(clues.length * profile.shareRate));
  return ordered.slice(0, count).map((clue) => clue.id);
}

export function composeAiMessage(
  personalityId: string,
  phase: AiPhase,
  sharedTitles: string[],
  anomalyTitle: string | null,
): string {
  const profile = getAiPersonality(personalityId);
  if (!profile) return "I am still searching my room.";
  const firstTitle = sharedTitles[0];
  const laterTitle = sharedTitles[1];

  if (phase === "investigation") {
    if (profile.id === "quiet-witness")
      return firstTitle
        ? `I found ${firstTitle}. I will compare it before I say more.`
        : "I am listening while I search. Give me a moment.";
    if (profile.id === "storyteller")
      return firstTitle
        ? `The room left me ${firstTitle}. I do not know what it means yet.`
        : "My room is telling a different story. I am checking the objects.";
    if (firstTitle)
      return laterTitle
        ? `I shared ${firstTitle} and ${laterTitle}. Please check them against another source.`
        : `I found ${firstTitle}. One trace is not a complete story.`;
    return "I am searching the room. Has anyone found a physical trace yet?";
  }

  if (anomalyTitle)
    return `${anomalyTitle} appeared in my room. I cannot treat it as proof; the room can fabricate memories.`;
  if (profile.id === "contrarian")
    return "The cleanest explanation may be wrong. Which detail does not fit the leading theory?";
  if (profile.id === "provocateur")
    return firstTitle
      ? `Someone explain how ${firstTitle} fits the sequence. What are we overlooking?`
      : "We need more than a confident story. What can the evidence actually support?";
  if (firstTitle)
    return `I compared ${firstTitle} with the other traces. Keep the displayed time in perspective.`;
  return "I am not ready to accuse anyone from a contradiction alone.";
}

function tokens(text: string): string[] {
  const ignored = new Set([
    "about",
    "after",
    "again",
    "also",
    "and",
    "are",
    "before",
    "been",
    "but",
    "could",
    "from",
    "had",
    "has",
    "have",
    "into",
    "its",
    "just",
    "may",
    "not",
    "onto",
    "only",
    "our",
    "same",
    "says",
    "some",
    "that",
    "the",
    "their",
    "then",
    "there",
    "this",
    "through",
    "was",
    "were",
    "when",
    "which",
    "with",
    "would",
    "your",
  ]);
  return (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter(
    (word) => word.length > 2 && !ignored.has(word),
  );
}

function minuteOfDay(value: string): number | null {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Build a timeline guess only from event cards and evidence the AI could see.
 * No scenario truth, support graph, roles, or unshared evidence enters this function.
 */
export function chooseAiTimeline(
  personalityId: string,
  events: AiTimelineEvent[],
  evidence: AiEvidence[],
  seed: string,
): string[] {
  const profile = getAiPersonality(personalityId);
  const fallback = seededShuffle(events, `${seed}:${personalityId}:cards`);
  if (!profile || !events.length) return fallback.map((event) => event.id);

  const inferred = new Map<string, number[]>();
  for (const clue of evidence) {
    const clueWords = new Set(tokens(`${clue.title} ${clue.text}`));
    let bestEvent: AiTimelineEvent | null = null;
    let bestScore = 0;
    let tied = false;
    for (const event of events) {
      const score = tokens(event.text).reduce(
        (total, word) => total + Number(clueWords.has(word)),
        0,
      );
      if (score > bestScore) {
        bestEvent = event;
        bestScore = score;
        tied = false;
      } else if (score > 0 && score === bestScore) tied = true;
    }
    const time = minuteOfDay(clue.time);
    if (bestEvent && !tied && bestScore > 0 && time !== null) {
      const values = inferred.get(bestEvent.id) || [];
      values.push(time);
      inferred.set(bestEvent.id, values);
    }
  }

  const originalOrder = new Map(fallback.map((event, index) => [event.id, index]));
  const ordered = [...events].sort((left, right) => {
    const leftTimes = inferred.get(left.id) || [];
    const rightTimes = inferred.get(right.id) || [];
    if (leftTimes.length && rightTimes.length) {
      const leftMean = leftTimes.reduce((sum, value) => sum + value, 0) / leftTimes.length;
      const rightMean = rightTimes.reduce((sum, value) => sum + value, 0) / rightTimes.length;
      return leftMean - rightMean || originalOrder.get(left.id)! - originalOrder.get(right.id)!;
    }
    if (leftTimes.length !== rightTimes.length) return leftTimes.length ? -1 : 1;
    return originalOrder.get(left.id)! - originalOrder.get(right.id)!;
  });

  const random = seededRandom(`${seed}:${personalityId}:uncertainty`);
  for (let swap = 0; swap < profile.timelineNoise && ordered.length > 1; swap++) {
    const index = Math.floor(random() * (ordered.length - 1));
    [ordered[index], ordered[index + 1]] = [ordered[index + 1], ordered[index]];
  }
  return ordered.map((event) => event.id);
}

export function chooseAiVote(
  personalityId: string,
  players: AiPlayerView[],
  chat: AiChatLine[],
  selfId: string,
  seed: string,
): string | null {
  const profile = getAiPersonality(personalityId);
  const candidates = players.filter((player) => player.id !== selfId);
  if (!profile || !candidates.length) return null;

  const accusations = new Map(candidates.map((candidate) => [candidate.id, 0]));
  const activity = new Map(candidates.map((candidate) => [candidate.id, 0]));
  const accusationWords = /\b(distorter|lying|lie|suspect|wrong|trust|contradict|accuse)\b/i;
  for (const message of chat) {
    for (const candidate of candidates) {
      if (message.playerId === candidate.id)
        activity.set(candidate.id, activity.get(candidate.id)! + 1);
      if (
        message.playerId !== candidate.id &&
        accusationWords.test(message.text) &&
        message.text.toLowerCase().includes(candidate.name.toLowerCase())
      ) {
        accusations.set(candidate.id, accusations.get(candidate.id)! + 1);
      }
    }
  }

  const random = seededRandom(`${seed}:${selfId}:${profile.id}:vote`);
  const tieBreak = new Map(candidates.map((candidate) => [candidate.id, random()]));
  let ranked = [...candidates].sort((left, right) => {
    if (profile.voteStyle === "contrarian")
      return (
        accusations.get(left.id)! - accusations.get(right.id)! ||
        tieBreak.get(left.id)! - tieBreak.get(right.id)!
      );
    if (profile.voteStyle === "social")
      return (
        activity.get(right.id)! - activity.get(left.id)! ||
        tieBreak.get(left.id)! - tieBreak.get(right.id)!
      );
    if (profile.voteStyle === "quiet")
      return (
        activity.get(left.id)! - activity.get(right.id)! ||
        tieBreak.get(left.id)! - tieBreak.get(right.id)!
      );
    return (
      accusations.get(right.id)! - accusations.get(left.id)! ||
      tieBreak.get(left.id)! - tieBreak.get(right.id)!
    );
  });

  // Keep a little uncertainty so bots do not turn a single accusation into a certain verdict.
  if (ranked.length > 1 && random() < 0.22)
    ranked = seededShuffle(ranked, `${seed}:${profile.id}:doubt`);
  return ranked[0].id;
}
