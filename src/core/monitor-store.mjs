//        __     __                   
// _|_   (_ ||\/|__) /\ _ _ _ _|   _  
//  |    __)||  |__)/--|_| (_(_||_|/_ 
//                     |  

import { EventEmitter } from "node:events";
import { buildConnectionId, getPlatformDef, PLATFORM_KEYS } from "./platforms.mjs";

function sanitizeTitle(value) {
  if (typeof value !== "string") return null;
  const title = value.trim();
  return title.length > 0 ? title : null;
}

export function createEmptyMonitorState() {
  return {
    session_id: `session-${Date.now()}`,
    mode: "offline",
    sources: Object.fromEntries(PLATFORM_KEYS.map((key) => [key, {
      status: "idle",
      last_event_at: null,
      last_issue_at: null,
      last_issue_kind: "",
      last_issue_message: ""
    }])),
    connections: {},
    messages: [],
    system_events: [],
    filters: {
      sources: [...PLATFORM_KEYS],
      hide_commands: true
    },
    display: {
      font_size: 18,
      opacity: 1,
      click_through: false,
      group_by_connection: false,
      accent_by_platform: true
    },
    stats: {
      received: 0,
      shown: 0,
      duplicates: 0,
      commands_hidden: 0,
      errors: 0
    },
    ui: {
      last_update_at: null
    }
  };
}

export class MonitorStore extends EventEmitter {
  constructor() {
    super();
    this.reset();
  }

  reset() {
    this.state = createEmptyMonitorState();
    this.seen = new Set();
    this.emitChange();
  }

  pruneSeen({ force = false } = {}) {
    if (!force && this.seen.size <= 1200) {
      return;
    }

    this.seen = new Set([
      ...this.state.messages,
      ...this.state.system_events
    ].map((event) => event.id).filter(Boolean));
  }

  getState() {
    return structuredClone(this.state);
  }

  clearMessages() {
    const removed = this.state.messages.length;
    this.state.messages = [];
    this.pruneSeen({ force: true });
    this.emitChange();
    return removed;
  }

  setMode(mode) {
    this.state.mode = mode;
    this.emitChange();
  }

  removeConnection(connectionId, { emitChange = true } = {}) {
    if (!connectionId || !this.state.connections[connectionId]) {
      return false;
    }

    delete this.state.connections[connectionId];
    if (emitChange) {
      this.emitChange();
    }
    return true;
  }

  ensureConnection(event) {
    const connectionId = event.connection_id || buildConnectionId({
      source: event.source,
      channel: event.channel,
      streamId: event.stream_id || "default"
    });

    if (!this.state.connections[connectionId]) {
      const platform = getPlatformDef(event.source);
      this.state.connections[connectionId] = {
        id: connectionId,
        source: event.source,
        platform_label: platform.label,
        accent_color: event.accent_color || platform.accentColor,
        surface_color: platform.surfaceColor,
        channel: event.channel || "default",
        channel_display_name: event.channel_display_name || event.channel || "default",
        stream_id: event.stream_id || null,
        title: null,
        status: "idle",
        live_status: "unknown",
        last_event_at: null,
        started_at: null,
        ended_at: null,
        message_count: 0,
        system_event_count: 0
      };
    }

    return this.state.connections[connectionId];
  }

  applyEvent(event) {
    this.state.stats.received += 1;

    if (this.seen.has(event.id)) {
      this.state.stats.duplicates += 1;
      this.emitChange();
      return;
    }
    this.seen.add(event.id);

    const sourceState = this.state.sources[event.source] || {
      status: "idle",
      last_event_at: null,
      last_issue_at: null,
      last_issue_kind: "",
      last_issue_message: ""
    };
    sourceState.last_event_at = event.time;
    this.state.sources[event.source] = sourceState;

    const connection = this.ensureConnection(event);
    connection.last_event_at = event.time;

    if (event.version === "system-event.v0") {
      this.applySystemEvent(event, connection, sourceState);
    } else if (event.version === "chat-event.v0") {
      this.applyChatEvent(event, connection, sourceState);
    }

    this.emitChange();
  }

  applyChatEvent(event, connection, sourceState) {
    sourceState.status = "connected";
    sourceState.last_issue_at = null;
    sourceState.last_issue_kind = "";
    sourceState.last_issue_message = "";
    connection.status = "connected";
    connection.live_status = "live";
    connection.started_at ||= event.time;
    connection.ended_at = null;

    const text = String(event.text || "");
    if (this.state.filters.hide_commands && (event.kind === "command" || text.trim().startsWith("!"))) {
      this.state.stats.commands_hidden += 1;
      return;
    }

    const platform = getPlatformDef(event.source);
    this.state.messages.unshift({
      ...event,
      connection_id: connection.id,
      channel_display_name: event.channel_display_name || connection.channel_display_name,
      accent_color: event.accent_color || platform.accentColor,
      platform_label: platform.label
    });
    this.state.messages = this.state.messages.slice(0, 300);
    this.pruneSeen();
    connection.message_count += 1;
    this.state.stats.shown += 1;
  }

  applySystemEvent(event, connection, sourceState) {
    connection.system_event_count += 1;

    if (event.level === "error") {
      this.state.stats.errors += 1;
    }

    if (event.kind === "source_connecting") {
      if (sourceState.status !== "error" && connection.status !== "error") {
        sourceState.status = "connecting";
        connection.status = "connecting";
      }
    }
    if (event.kind === "source_connected" || event.kind === "replay_started") {
      sourceState.status = "connected";
      sourceState.last_issue_at = null;
      sourceState.last_issue_kind = "";
      sourceState.last_issue_message = "";
      connection.status = "connected";
    }
    if (event.kind === "source_disconnected" || event.kind === "replay_finished") {
      sourceState.status = "disconnected";
      sourceState.last_issue_at = event.time;
      sourceState.last_issue_kind = event.kind;
      sourceState.last_issue_message = event.message || "A fonte desconectou.";
      connection.status = "disconnected";
    }
    if (event.kind === "source_error") {
      sourceState.status = "error";
      sourceState.last_issue_at = event.time;
      sourceState.last_issue_kind = event.kind;
      sourceState.last_issue_message = event.message || event.title || "A fonte reportou erro.";
      connection.status = "error";
    }
    if (event.kind === "stream_started") {
      sourceState.status = "connected";
      sourceState.last_issue_at = null;
      sourceState.last_issue_kind = "";
      sourceState.last_issue_message = "";
      connection.status = "connected";
      connection.live_status = "live";
      connection.started_at = event.time;
      connection.ended_at = null;
    }
    if (event.kind === "stream_ended") {
      sourceState.last_issue_at = event.time;
      sourceState.last_issue_kind = event.kind;
      sourceState.last_issue_message = event.message || "A live saiu do ar.";
      connection.live_status = "offline";
      connection.ended_at = event.time;
    }
    if (event.kind === "livestream_metadata_updated" && event.metadata?.title) {
      connection.title = sanitizeTitle(event.metadata.title);
    }
    if (event.metadata?.title && !connection.title) {
      connection.title = sanitizeTitle(event.metadata.title);
    }

    const platform = getPlatformDef(event.source);
    this.state.system_events.unshift({
      ...event,
      connection_id: connection.id,
      channel: event.channel || connection.channel,
      accent_color: event.accent_color || platform.accentColor,
      platform_label: platform.label
    });
    this.state.system_events = this.state.system_events.slice(0, 80);
    this.pruneSeen();
  }

  emitChange() {
    this.state.ui.last_update_at = new Date().toISOString();
    this.emit("change", this.getState());
  }
}
