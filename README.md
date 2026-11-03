# THE PARADOX ROOM

A guest-access multiplayer mystery built as a Cloudflare Worker and Durable Object. The Durable Object for a room is the authority for membership, roles, private evidence, phase changes, ballots, and scores. Static browser assets are served by the same Worker.

## Run locally

1. Install Node.js 20 or newer.
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
- Player tokens are generated server-side and kept in that browser tab's session storage. Realtime snapshots are individualized before they are sent; the hidden role and unassigned clues are never in another player's snapshot.
- The scenario registry contains a canonical ordered truth, matching timeline milestones, and an evidence set. The scenario validator checks the truth order and unique identifiers before a round starts.
- The assignment engine shuffles the single Distorter, deals every clue across the room, gives every player a distinct room rendering/observation, and independently assigns environmental anomalies.
- The server validates every state-changing action. Phase deadlines use Durable Object alarms; the host can move a phase forward, while all ballots must be sealed before early reveal.

## Current scope

Scenario 01, **The Last Light**, is the complete playable scenario. Scenario data is separated from room lifecycle logic so additional scenario definitions can use the same assignment and synchronization engine. There is no login, elimination, chat transcript retention, or paid service dependency.
