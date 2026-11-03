import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { LAST_LIGHT } from "../src/scenarios.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = join(root, "node_modules", "wrangler", "bin", "wrangler.js");

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) =>
    server.once("error", reject).listen(0, "127.0.0.1", resolveListen),
  );
  const { port } = server.address();
  await new Promise((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
  return port;
}

async function waitForWorker(baseUrl, processHandle, output) {
  const stopAt = Date.now() + 60_000;
  while (Date.now() < stopAt) {
    if (processHandle.exitCode !== null) throw new Error(`Wrangler exited early:\n${output()}`);
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      /* The local Worker is still starting. */
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Timed out waiting for Wrangler:\n${output()}`);
}

function observe(socket) {
  const observer = { socket, latest: null, waiters: [] };
  socket.addEventListener("message", (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.type !== "state") return;
      observer.latest = message.data;
      for (const waiter of [...observer.waiters]) {
        if (waiter.predicate(observer.latest)) {
          clearTimeout(waiter.timer);
          observer.waiters.splice(observer.waiters.indexOf(waiter), 1);
          waiter.resolve(observer.latest);
        }
      }
    } catch {
      /* Ignore non-state frames. */
    }
  });
  return observer;
}

function stateWhen(observer, predicate, label) {
  if (observer.latest && predicate(observer.latest)) return Promise.resolve(observer.latest);
  return new Promise((resolveState, reject) => {
    const waiter = { predicate, resolve: resolveState, timer: null };
    waiter.timer = setTimeout(() => {
      observer.waiters.splice(observer.waiters.indexOf(waiter), 1);
      reject(new Error(`Timed out waiting for ${label}.`));
    }, 10_000);
    observer.waiters.push(waiter);
  });
}

const dataDir = await mkdtemp(join(tmpdir(), "paradox-room-integration-"));
const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
let processOutput = "";
const worker = spawn(
  process.execPath,
  [
    wrangler,
    "dev",
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
    "--persist-to",
    join(dataDir, "state"),
  ],
  {
    cwd: root,
    env: { ...process.env, XDG_CONFIG_HOME: join(dataDir, "config") },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
worker.stdout.setEncoding("utf8").on("data", (chunk) => {
  processOutput += chunk;
});
worker.stderr.setEncoding("utf8").on("data", (chunk) => {
  processOutput += chunk;
});
const sockets = [];

try {
  await waitForWorker(baseUrl, worker, () => processOutput);
  const createdResponse = await fetch(`${baseUrl}/api/create`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Witness 1" }),
  });
  const created = await createdResponse.json();
  assert.equal(createdResponse.status, 200, JSON.stringify(created));

  const players = [created];
  for (let index = 2; index <= 4; index++) {
    const response = await fetch(`${baseUrl}/api/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: `Witness ${index}`, code: created.code }),
    });
    const player = await response.json();
    assert.equal(response.status, 200, JSON.stringify(player));
    players.push(player);
  }

  const observers = [];
  const tickets = [];
  for (const player of players) {
    const ticketResponse = await fetch(`${baseUrl}/socket/${created.code}/ticket`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: player.token }),
    });
    const ticketData = await ticketResponse.json();
    assert.equal(ticketResponse.status, 200, JSON.stringify(ticketData));
    assert.ok(ticketData.ticket && !ticketData.ticket.includes(player.token));
    tickets.push(ticketData.ticket);
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}/socket/${created.code}/connect?ticket=${encodeURIComponent(ticketData.ticket)}`,
    );
    sockets.push(socket);
    const observer = observe(socket);
    observers.push(observer);
    await new Promise((resolveOpen, rejectOpen) => {
      socket.addEventListener("open", resolveOpen, { once: true });
      socket.addEventListener(
        "error",
        () => rejectOpen(new Error(`WebSocket failed to open:\n${processOutput}`)),
        { once: true },
      );
    });
    await stateWhen(
      observer,
      (state) => state.phase === "lobby" && state.players.length === 4,
      "four-player lobby state",
    );
  }

  const replay = new WebSocket(
    `ws://127.0.0.1:${port}/socket/${created.code}/connect?ticket=${encodeURIComponent(tickets[0])}`,
  );
  sockets.push(replay);
  const replayOpened = await new Promise((resolveReplay) => {
    const finish = (opened) => {
      clearTimeout(timer);
      resolveReplay(opened);
    };
    const timer = setTimeout(() => finish(false), 3_000);
    replay.addEventListener("open", () => finish(true), { once: true });
    replay.addEventListener("error", () => finish(false), { once: true });
    replay.addEventListener("close", () => finish(false), { once: true });
  });
  assert.equal(replayOpened, false, "a consumed WebSocket ticket must not be reusable");
  replay.close();

  async function act(player, type, data = {}) {
    const response = await fetch(`${baseUrl}/socket/${created.code}/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: player.token, action: { type, ...data } }),
    });
    const result = await response.json();
    assert.equal(response.status, 200, `${type}: ${JSON.stringify(result)}`);
    return result;
  }

  for (const player of players) await act(player, "ready", { ready: true });
  await Promise.all(
    observers.map((observer) =>
      stateWhen(
        observer,
        (state) => state.players.every((player) => player.ready),
        "everyone ready",
      ),
    ),
  );
  await act(players[0], "start");
  await Promise.all(
    observers.map((observer) =>
      stateWhen(observer, (state) => state.phase === "investigation", "investigation phase"),
    ),
  );

  const views = observers.map((observer) => observer.latest.you.room);
  assert.equal(
    new Set(views.map((view) => view.id)).size,
    4,
    "each witness must receive a different room view",
  );
  assert.ok(
    observers.every((observer) => !Object.hasOwn(observer.latest.you, "role")),
    "hidden roles must not appear before reveal",
  );

  for (let index = 0; index < players.length; index++) {
    let found = 0;
    for (const object of views[index].objects) {
      const result = await act(players[index], "inspect", { objectId: object.id });
      found += result.foundCount;
    }
    assert.equal(
      found,
      observers[index].latest.you.evidenceTotal,
      "inspecting the full room should reveal only that player's assigned evidence",
    );
  }

  for (let index = 0; index < players.length; index++) {
    const clue = observers[index].latest.you.clues[0];
    assert.ok(clue, "each player should have private evidence");
    await act(players[index], "share", { clueId: clue.id });
  }
  const distorterIndex = observers.findIndex((observer) => observer.latest.you.ability);
  assert.notEqual(distorterIndex, -1, "one player should privately receive the Distorter ability");
  const sharedId = observers[0].latest.shared[0].id;
  await act(players[distorterIndex], "distort", { sharedId, direction: "later" });
  const distorted = await stateWhen(
    observers[0],
    (state) => state.shared.some((item) => item.id === sharedId && item.distorted),
    "distorted evidence update",
  );
  assert.equal(
    Object.hasOwn(
      distorted.shared.find((item) => item.id === sharedId),
      "time",
    ),
    false,
    "original timestamps stay private until reveal",
  );

  await act(players[0], "advance");
  await Promise.all(
    observers.map((observer) =>
      stateWhen(observer, (state) => state.phase === "discussion", "discussion phase"),
    ),
  );
  await act(players[0], "advance");
  await Promise.all(
    observers.map((observer) =>
      stateWhen(observer, (state) => state.phase === "timeline", "timeline phase"),
    ),
  );
  const correctOrder = LAST_LIGHT.timeline.map((event) => event.id);
  for (const player of players) await act(player, "timeline", { order: correctOrder });
  await act(players[0], "advance");
  await Promise.all(
    observers.map((observer) =>
      stateWhen(observer, (state) => state.phase === "voting", "voting phase"),
    ),
  );
  for (let index = 0; index < players.length; index++) {
    const target = players[(index + 1) % players.length].playerId;
    await act(players[index], "vote", { targetId: target });
  }
  const finalStates = await Promise.all(
    observers.map((observer) =>
      stateWhen(observer, (state) => state.phase === "reveal", "final revelation"),
    ),
  );
  assert.ok(
    finalStates.every((state) => state.result.correctTimelineIds.join() === correctOrder.join()),
  );
  assert.ok(finalStates.every((state) => state.result.distorter && state.you.role));
  console.log(
    "PASS: four independent clients completed a live Worker round with private evidence, a Distorter action, timeline submissions, voting, and reveal.",
  );
} finally {
  for (const socket of sockets) socket.close();
  worker.kill();
  await new Promise((resolveExit) => {
    if (worker.exitCode !== null || worker.signalCode !== null) return resolveExit();
    const timeout = setTimeout(resolveExit, 10_000);
    worker.once("exit", () => {
      clearTimeout(timeout);
      resolveExit();
    });
  });
  const resolvedTemp = resolve(dataDir);
  const resolvedTempRoot = resolve(tmpdir()) + sep;
  if (resolvedTemp.startsWith(resolvedTempRoot)) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await rm(resolvedTemp, { recursive: true, force: true });
        break;
      } catch (error) {
        if (attempt === 4)
          console.warn(`Could not remove temporary Wrangler state: ${error.message}`);
        else await new Promise((resolveRetry) => setTimeout(resolveRetry, 250));
      }
    }
  }
}
