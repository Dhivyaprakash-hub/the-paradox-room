export interface SharedEvidence {
  id: string;
  owner: string;
  ownerName: string;
  clueId: string;
  title: string;
  text: string;
  time: string;
  kind: "physical" | "sensor" | "memory";
  room: string;
  displayTime: string;
  distorted?: boolean;
}

/** Hide the authoritative timestamp from every player until the reveal phase. */
export function projectSharedEvidence(items: SharedEvidence[], revealed: boolean): Array<Omit<SharedEvidence, "time"> | SharedEvidence> {
  return items.map(item => {
    const { time, ...beforeReveal } = item;
    return revealed ? { ...beforeReveal, time } : beforeReveal;
  });
}
