//        __     __                   
// _|_   (_ ||\/|__) /\ _ _ _ _|   _  
//  |    __)||  |__)/--|_| (_(_||_|/_ 
//                     |  

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { buildConnectionId } from "./platforms.mjs";

const allowedSources = new Set(["replay", "twitch", "youtube", "kick", "tiktok"]);
const chatKinds = new Set(["message", "highlight", "command", "reward", "membership"]);
const systemKinds = new Set([
  "source_connecting",
  "source_connected",
  "source_disconnected",
  "source_error",
  "replay_started",
  "replay_finished",
  "stream_started",
  "stream_ended",
  "livestream_metadata_updated"
]);
const levels = new Set(["info", "warning", "error"]);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isIsoDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

export function eventType(event) {
  if (event?.version === "chat-event.v0") return "chat";
  if (event?.version === "system-event.v0") return "system";
  return "unknown";
}

export function validateChatEvent(event, fileName = "inline") {
  assert(typeof event.id === "string" && event.id.length > 0, `${fileName}: ChatEvent sem id`);
  assert(allowedSources.has(event.source), `${fileName}: ChatEvent ${event.id} com source invalido`);
  assert(typeof event.channel === "string" && event.channel.length > 0, `${fileName}: ChatEvent ${event.id} sem channel`);
  assert(chatKinds.has(event.kind), `${fileName}: ChatEvent ${event.id} com kind invalido`);
  assert(isIsoDate(event.time), `${fileName}: ChatEvent ${event.id} sem time ISO valido`);
  assert(event.author && typeof event.author.name === "string" && event.author.name.length > 0, `${fileName}: ChatEvent ${event.id} sem author.name`);
  assert(Array.isArray(event.author.roles), `${fileName}: ChatEvent ${event.id} sem author.roles`);
  assert(typeof event.text === "string", `${fileName}: ChatEvent ${event.id} sem text`);
  assert(!/[<>]/.test(event.text), `${fileName}: ChatEvent ${event.id} tem HTML ou tag em text`);
  assert(Array.isArray(event.parts), `${fileName}: ChatEvent ${event.id} sem parts`);

  for (const part of event.parts) {
    assert(["text", "emote", "link"].includes(part.type), `${fileName}: ChatEvent ${event.id} tem part.type invalido`);
    assert(typeof part.value === "string", `${fileName}: ChatEvent ${event.id} tem part.value invalido`);
  }
}

export function validateSystemEvent(event, fileName = "inline") {
  assert(typeof event.id === "string" && event.id.length > 0, `${fileName}: SystemEvent sem id`);
  assert(allowedSources.has(event.source), `${fileName}: SystemEvent ${event.id} com source invalido`);
  assert(systemKinds.has(event.kind), `${fileName}: SystemEvent ${event.id} com kind invalido`);
  assert(levels.has(event.level), `${fileName}: SystemEvent ${event.id} com level invalido`);
  assert(isIsoDate(event.time), `${fileName}: SystemEvent ${event.id} sem time ISO valido`);
  assert(typeof event.title === "string" && event.title.length > 0, `${fileName}: SystemEvent ${event.id} sem title`);
  assert(typeof event.message === "string", `${fileName}: SystemEvent ${event.id} sem message`);
  assert(typeof event.recoverable === "boolean", `${fileName}: SystemEvent ${event.id} sem recoverable boolean`);
}

export function validateEvent(event, fileName = "inline") {
  const type = eventType(event);
  if (type === "chat") validateChatEvent(event, fileName);
  else if (type === "system") validateSystemEvent(event, fileName);
  else throw new Error(`${fileName}: evento ${event?.id || "(sem id)"} tem version invalida`);
  return type;
}

function ensureConnection(state, event) {
  const connectionId = event.connection_id || buildConnectionId({
    source: event.source,
    channel: event.channel,
    streamId: event.stream_id || "default"
  });

  if (!state.connections[connectionId]) {
    state.connections[connectionId] = {
      id: connectionId,
      source: event.source,
      channel: event.channel || "default",
      stream_id: event.stream_id || null,
      status: "unknown",
      title: null,
      live_status: "unknown",
      last_event_at: null,
      message_count: 0,
      system_event_count: 0
    };
  }

  return state.connections[connectionId];
}

export function createReplayState() {
  return {
    session_id: "session-replay-local",
    mode: "replay",
    sources: {},
    connections: {},
    messages: [],
    system_events: [],
    filters: {
      sources: ["replay"],
      hide_commands: true
    },
    display: {
      font_size: 18,
      opacity: 0.85,
      click_through: false,
      group_by_connection: false
    },
    stats: {
      received: 0,
      shown: 0,
      duplicates: 0,
      commands_hidden: 0,
      errors: 0
    }
  };
}

export function updateSource(state, event) {
  if (!state.sources[event.source]) {
    state.sources[event.source] = {
      status: "unknown",
      last_event_at: null,
      last_issue_at: null,
      last_issue_kind: "",
      last_issue_message: ""
    };
  }

  state.sources[event.source].last_event_at = event.time;
  const connection = ensureConnection(state, event);
  connection.last_event_at = event.time;

  if (event.version !== "system-event.v0") {
    state.sources[event.source].status = "connected";
    state.sources[event.source].last_issue_at = null;
    state.sources[event.source].last_issue_kind = "";
    state.sources[event.source].last_issue_message = "";
    connection.status = "connected";
    connection.live_status = "live";
    return connection;
  }

  if (event.kind === "source_connecting") {
    state.sources[event.source].status = "connecting";
    connection.status = "connecting";
  }
  if (event.kind === "source_connected" || event.kind === "replay_started") {
    state.sources[event.source].status = "connected";
    state.sources[event.source].last_issue_at = null;
    state.sources[event.source].last_issue_kind = "";
    state.sources[event.source].last_issue_message = "";
    connection.status = "connected";
  }
  if (event.kind === "source_disconnected" || event.kind === "replay_finished") {
    state.sources[event.source].status = "disconnected";
    state.sources[event.source].last_issue_at = event.time;
    state.sources[event.source].last_issue_kind = event.kind;
    state.sources[event.source].last_issue_message = event.message || "A fonte desconectou.";
    connection.status = "disconnected";
  }
  if (event.kind === "source_error") {
    state.sources[event.source].status = "error";
    state.sources[event.source].last_issue_at = event.time;
    state.sources[event.source].last_issue_kind = event.kind;
    state.sources[event.source].last_issue_message = event.message || event.title || "A fonte reportou erro.";
    connection.status = "error";
  }
  if (event.kind === "stream_started") {
    state.sources[event.source].status = "connected";
    state.sources[event.source].last_issue_at = null;
    state.sources[event.source].last_issue_kind = "";
    state.sources[event.source].last_issue_message = "";
    connection.status = "connected";
    connection.live_status = "live";
  }
  if (event.kind === "stream_ended") {
    state.sources[event.source].last_issue_at = event.time;
    state.sources[event.source].last_issue_kind = event.kind;
    state.sources[event.source].last_issue_message = event.message || "A live saiu do ar.";
    connection.live_status = "offline";
  }
  if (event.metadata?.title) {
    connection.title = event.metadata.title;
  }

  return connection;
}

export function applyReplay(events) {
  const state = createReplayState();
  const seen = new Set();

  for (const event of [...events].sort((a, b) => Date.parse(a.time) - Date.parse(b.time))) {
    state.stats.received += 1;
    const connection = updateSource(state, event);

    if (seen.has(event.id)) {
      state.stats.duplicates += 1;
      continue;
    }
    seen.add(event.id);

    if (event.version === "system-event.v0") {
      state.system_events.push(event);
      connection.system_event_count += 1;
      if (event.level === "error") state.stats.errors += 1;
      continue;
    }

    const text = String(event.text || "");
    if (state.filters.hide_commands && (event.kind === "command" || text.trim().startsWith("!"))) {
      state.stats.commands_hidden += 1;
      continue;
    }

    state.messages.push(event);
    connection.message_count += 1;
    state.stats.shown += 1;
  }

  return state;
}

export function compareExpected(state, expected, fileName = "inline") {
  for (const key of ["received", "shown", "duplicates", "commands_hidden", "errors"]) {
    assert(state.stats[key] === expected[key], `${fileName}: esperado ${key}=${expected[key]}, obtido ${state.stats[key]}`);
  }
}

export async function loadReplayFixture(filePath) {
  const data = JSON.parse(await readFile(filePath, "utf8"));
  assert(typeof data.scenario === "string" && data.scenario.length > 0, `${filePath}: scenario ausente`);
  assert(Array.isArray(data.events), `${filePath}: events precisa ser array`);
  assert(data.expected && typeof data.expected === "object", `${filePath}: expected ausente`);

  for (const event of data.events) {
    validateEvent(event, path.basename(filePath));
  }

  const state = applyReplay(data.events);
  compareExpected(state, data.expected, path.basename(filePath));

  return { scenario: data.scenario, state, events: data.events };
}

export async function getReplayFixtureFiles(fixtureDir) {
  const files = await readdir(fixtureDir);
  return files
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => path.join(fixtureDir, file));
}

export async function loadReplayFixtures(fixtureDir) {
  const files = await getReplayFixtureFiles(fixtureDir);
  const fixtures = [];

  for (const file of files) {
    fixtures.push(await loadReplayFixture(file));
  }

  return fixtures;
}

export function summarizeReplayResults(results) {
  return results.reduce(
    (acc, result) => {
      for (const key of Object.keys(acc)) {
        acc[key] += result.state.stats[key];
      }
      return acc;
    },
    { received: 0, shown: 0, duplicates: 0, commands_hidden: 0, errors: 0 }
  );
}
