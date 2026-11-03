# THE PARADOX ROOM

A guest-access multiplayer mystery built as a Cloudflare Worker and Durable Object. The Durable Object for a room is the authority for membership, roles, private evidence, phase changes, ballots, and scores. Static browser assets are served by the same Worker.

## Run locally

1. Install Node.js 22 or newer.
2. Run `npm install`.
3. Run `npm run dev` and open the local address Wrangler prints.
4. Use separate browser profiles or devices to create a room and join with its six-character code. Four players are required to start.

Local Durable Object state is persisted by Wrangler. Remove the local Wrangler state directory if you want a clean development database.

## Deploy publicly

1. Create or sign in to a Cloudflare account and install Wrangler dependencies.
2. Run `npx wrangler login` once.
3. Run `npm run deploy` from this project.
4. Open the `workers.dev` URL printed by Wrangler and verify a four-player round using separate devices.

No end-user authentication or external database secrets are required. Cloudflare account access is required to publish the public URL.

## Game and privacy model

- Each room code maps to one Durable Object with SQLite-backed storage and a hibernating WebSocket interface.
- Player tokens are generated server-side and kept in that browser tab's session storage. Realtime snapshots are individualized before they are sent; the hidden role, unassigned clues, and authoritative timestamps of shared clues are withheld until the reveal.
- During investigation, each witness gets a distinct room variant and uses the illustrated observatory to inspect room objects. Only assigned evidence found through a server-validated inspection enters that witness's private journal. Sharing undiscovered evidence is rejected by the room server.
- Scenario definitions live in `src/scenarios.ts`. Each definition has a versioned ordered truth, stable event IDs, clue support links to searchable objects, distinct room views, environmental anomalies, and a Distorter ability definition. Timeline event cards are independently shuffled per player so their presentation never gives away the correct sequence.
- Scenario validation checks ordered timestamps, unique IDs, valid clue-to-event references, at least two evidence links per timeline event, and enough distinct room views before a round starts.
- Assignment uses the cryptographically generated room seed to reproducibly shuffle the Distorter, clue distribution, room views, and environmental anomalies. Clues are dealt once and as evenly as possible across 4–8 participants.
- `src/projections.ts` removes the original shared-clue timestamp from every pre-reveal player snapshot and restores it only in the reveal phase.
- The server validates every state-changing action. Phase deadlines use Durable Object alarms; the host can move a phase forward, while all ballots must be sealed before early reveal.

## Current scope

Scenario 01, **The Last Light**, remains the only playable scenario. The registry and assignment engine can now validate additional scenario data, but new scenarios and AI participants are not included yet. Human-only private rooms still require 4–8 players. There is no login, elimination, chat transcript retention, or paid service dependency.

## Local checks

Run `npm run typecheck` for the Worker types and `npm test` for scenario validation, deterministic assignment, 4–8 player clue/view distribution, role distribution, per-player timeline presentation, server-validated clue inspection and sharing, and pre-reveal timestamp projection checks. These checks run locally and do not require a Cloudflare API token or paid service.
