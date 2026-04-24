//        __     __                   
// _|_   (_ ||\/|__) /\ _ _ _ _|   _  
//  |    __)||  |__)/--|_| (_(_||_|/_ 
//                     |  

import assert from "node:assert/strict";
import { MonitorStore } from "../src/core/monitor-store.mjs";
import { isConfirmedActiveConnection } from "../src/ui/shared.js";

const CHANNEL = "status_regression";
const CONNECTION_ID = `twitch:${CHANNEL}:live`;
let sequence = 0;

function nextTime() {
  sequence += 1;
  return new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)).toISOString();
}

function systemEvent(kind, patch = {}) {
  return {
    id: `system:${kind}:${sequence + 1}`,
    version: "system-event.v0",
    source: "twitch",
    channel: CHANNEL,
    connection_id: CONNECTION_ID,
    stream_id: "live",
    kind,
    level: kind === "source_error" ? "error" : "info",
    time: nextTime(),
    title: kind,
    message: `${kind} message`,
    recoverable: true,
    accent_color: "#9146ff",
    ...patch
  };
}

function chatEvent(text = "voltou") {
  return {
    id: `chat:${sequence + 1}`,
    version: "chat-event.v0",
    source: "twitch",
    channel: CHANNEL,
    connection_id: CONNECTION_ID,
    stream_id: "live",
    kind: "message",
    time: nextTime(),
    author: {
      id: "viewer",
      name: "viewer",
      color: "",
      roles: ["viewer"]
    },
    text,
    parts: [{ type: "text", value: text }],
    accent_color: "#9146ff",
    raw_ref: "status-regression"
  };
}

function stateOf(store) {
  const state = store.getState();
  return {
    source: state.sources.twitch,
    connection: state.connections[CONNECTION_ID]
  };
}

function assertActive(store, expected, label) {
  const { connection } = stateOf(store);
  assert.equal(isConfirmedActiveConnection(connection), expected, label);
}

const store = new MonitorStore();

store.applyEvent(systemEvent("source_connected"));
store.applyEvent(systemEvent("stream_started"));
store.applyEvent(chatEvent("primeira mensagem"));

let state = stateOf(store);
assert.equal(state.source.status, "connected", "fonte inicia conectada");
assert.equal(state.source.last_issue_kind, "", "fonte ativa nao tem issue pendente");
assertActive(store, true, "fonte com live e mensagem e ativa");

store.applyEvent(systemEvent("stream_ended", {
  level: "warning",
  message: "Canal saiu do ar."
}));

state = stateOf(store);
assert.equal(state.connection.live_status, "offline", "stream_ended marca offline");
assert.equal(state.source.last_issue_kind, "stream_ended", "stream_ended fica pendente");
assert.equal(state.source.last_issue_message, "Canal saiu do ar.", "mensagem de queda fica preservada");
assertActive(store, false, "offline com mensagens antigas nao conta como ativo");

store.applyEvent(systemEvent("source_connecting", {
  message: "Tentando reconectar."
}));

state = stateOf(store);
assert.equal(state.source.last_issue_kind, "stream_ended", "reconnect nao limpa queda antes de resolver");
assertActive(store, false, "reconnect ainda nao conta como ativo");

store.applyEvent(systemEvent("source_connected"));
store.applyEvent(systemEvent("stream_started"));

state = stateOf(store);
assert.equal(state.source.last_issue_kind, "", "source_connected/stream_started limpa issue");
assertActive(store, true, "reconexao confirmada volta a contar ativo");

store.applyEvent(systemEvent("source_error", {
  message: "Erro real do provider."
}));

state = stateOf(store);
assert.equal(state.source.status, "error", "source_error marca erro");
assert.equal(state.connection.status, "error", "source_error marca conexao com erro");
assert.equal(state.source.last_issue_message, "Erro real do provider.", "erro real fica persistido");
assertActive(store, false, "erro nao conta ativo");

store.applyEvent(systemEvent("source_connecting", {
  message: "Nova tentativa."
}));

state = stateOf(store);
assert.equal(state.source.status, "error", "source_connecting nao esconde erro pendente");
assert.equal(state.source.last_issue_message, "Erro real do provider.", "source_connecting preserva motivo do erro");
assertActive(store, false, "tentativa apos erro nao conta ativo");

store.applyEvent(chatEvent("chat voltou"));

state = stateOf(store);
assert.equal(state.source.status, "connected", "chat real limpa erro e marca conectado");
assert.equal(state.connection.status, "connected", "chat real reativa conexao");
assert.equal(state.connection.live_status, "live", "chat real confirma live");
assert.equal(state.source.last_issue_kind, "", "chat real limpa issue pendente");
assertActive(store, true, "chat real voltando conta ativo automaticamente");

console.log(JSON.stringify({
  ok: true,
  scenarios: [
    "live-confirmada",
    "stream-ended-nao-conta-ativo",
    "reconnect-nao-esconde-queda",
    "reconexao-limpa-issue",
    "erro-persistido",
    "chat-real-limpa-erro"
  ]
}, null, 2));
