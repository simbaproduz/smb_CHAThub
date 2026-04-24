//        __     __                   
// _|_   (_ ||\/|__) /\ _ _ _ _|   _  
//  |    __)||  |__)/--|_| (_(_||_|/_ 
//                     |  

import { randomUUID } from "node:crypto";
import { getPlatformDef, buildConnectionId } from "../core/platforms.mjs";

const KICK_CHANNEL_API = "https://kick.com/api/v2/channels";
const KICK_CHANNEL_PROXY_API = "https://r.jina.ai/http://kick.com/api/v2/channels";
const KICK_EMOTE_CDN = "https://files.kick.com/emotes";
const PUSHER_KEY = "32cbd69e4b950bf97679";
const PUSHER_URL = `wss://ws-us2.pusher.com/app/${PUSHER_KEY}?protocol=7&client=js&version=8.4.0&flash=false`;

function nowIso() {
  return new Date().toISOString();
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim().length > 0;
}

export function normalizeKickChannelInput(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) {
    return "";
  }

  try {
    const url = new URL(/^[a-z]+:\/\//i.test(rawValue) ? rawValue : `https://${rawValue}`);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (host.includes("kick.com")) {
      const segments = url.pathname.split("/").filter(Boolean);
      if (segments[0] === "popout" && segments[1]) {
        return sanitizeKickChannel(segments[1]);
      }
      if (segments[0]) {
        return sanitizeKickChannel(segments[0]);
      }
    }
  } catch {
    // Continua no parser simples abaixo.
  }

  return sanitizeKickChannel(rawValue);
}

function sanitizeKickChannel(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .replace(/\/(?:chat|chatroom)$/i, "")
    .replace(/^kick:/i, "")
    .toLowerCase();
}

export function canStartKickCompatibility(config = {}) {
  return Boolean(
    config?.enabled
    && normalizeKickChannelInput(config.channel || config.quick_input || config.broadcaster_user_id)
    && (config.setup_mode === "compatibility" || !config.setup_mode || config.quick_input)
  );
}

function createSystemEvent({
  channel,
  streamId = "live",
  kind,
  level = "info",
  title,
  message,
  metadata
}) {
  const platform = getPlatformDef("kick");
  return {
    id: randomUUID(),
    version: "system-event.v0",
    source: "kick",
    channel,
    connection_id: buildConnectionId({ source: "kick", channel, streamId }),
    stream_id: streamId,
    kind,
    level,
    time: nowIso(),
    title,
    message,
    recoverable: true,
    accent_color: platform.accentColor,
    metadata
  };
}

function createChatEvent({
  id,
  channel,
  streamId,
  channelDisplayName,
  author,
  text,
  parts,
  rawRef,
  time
}) {
  const platform = getPlatformDef("kick");
  return {
    id: id ? `kick-${id}` : randomUUID(),
    version: "chat-event.v0",
    source: "kick",
    channel,
    connection_id: buildConnectionId({ source: "kick", channel, streamId }),
    stream_id: streamId,
    channel_display_name: channelDisplayName || channel,
    kind: text.trim().startsWith("!") ? "command" : "message",
    time: time || nowIso(),
    author,
    text,
    parts: Array.isArray(parts) && parts.length > 0 ? parts : [{ type: "text", value: text }],
    accent_color: platform.accentColor,
    raw_ref: rawRef
  };
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripHtml(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function normalizeEmoteUrl(value = "") {
  const rawUrl = decodeHtmlEntities(value).trim();
  if (!rawUrl) {
    return "";
  }
  if (rawUrl.startsWith("//")) {
    return `https:${rawUrl}`;
  }
  if (/^https?:\/\//i.test(rawUrl)) {
    return rawUrl;
  }
  return "";
}

function getHtmlAttribute(tag = "", name = "") {
  const match = new RegExp(`${name}=["']([^"']*)["']`, "i").exec(tag);
  return match ? decodeHtmlEntities(match[1]) : "";
}

function buildKickEmoteUrl(id = "") {
  const safeId = String(id || "").trim();
  if (!/^\d+$/.test(safeId)) {
    return "";
  }
  return `${KICK_EMOTE_CDN}/${safeId}/fullsize`;
}

function normalizeKickEmoteLabel(value = "", id = "") {
  const label = decodeHtmlEntities(value).replace(/^:+|:+$/g, "").trim();
  return label || (id ? `emote ${id}` : "emote");
}

function splitKickShortcodeParts(value = "") {
  const text = String(value || "");
  if (!text) {
    return [];
  }

  const pattern = /\[emote:(\d+):([^\]\r\n]+)\]|\[emotes?(\d+)\]/gi;
  const parts = [];
  let cursor = 0;
  let match;

  while ((match = pattern.exec(text))) {
    if (match.index > cursor) {
      parts.push({ type: "text", value: text.slice(cursor, match.index) });
    }

    const id = match[1] || match[3] || "";
    const label = normalizeKickEmoteLabel(match[2] || "", id);
    const src = buildKickEmoteUrl(id);
    if (src) {
      parts.push({
        type: "emote",
        value: label,
        alt: label,
        provider: "kick",
        id,
        src
      });
    } else {
      parts.push({ type: "text", value: match[0] });
    }

    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    parts.push({ type: "text", value: text.slice(cursor) });
  }

  return parts.length > 0 ? parts : [{ type: "text", value: text }];
}

function expandKickShortcodeParts(parts = []) {
  const expanded = [];
  let changed = false;

  for (const part of parts) {
    if (part?.type !== "text") {
      expanded.push(part);
      continue;
    }

    const splitParts = splitKickShortcodeParts(part.value);
    if (splitParts.length !== 1 || splitParts[0].value !== part.value || splitParts[0].type !== "text") {
      changed = true;
    }
    expanded.push(...splitParts);
  }

  return changed ? expanded : parts;
}

function extractKickShortcodeParts(value = "") {
  const parts = splitKickShortcodeParts(value);
  return parts.some((part) => part.type === "emote") ? parts : null;
}

function messagePartsToText(parts = []) {
  return parts
    .map((part) => part?.type === "emote"
      ? (part.alt || part.value || "")
      : (part?.value || ""))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function extractHtmlMessageParts(value = "") {
  const raw = String(value || "");
  if (!/<img\b/i.test(raw)) {
    return null;
  }

  const parts = [];
  const imagePattern = /<img\b[^>]*>/gi;
  let cursor = 0;
  let match;

  while ((match = imagePattern.exec(raw))) {
    const before = stripHtml(raw.slice(cursor, match.index));
    if (before) {
      parts.push({ type: "text", value: before });
    }

    const tag = match[0];
    const src = normalizeEmoteUrl(getHtmlAttribute(tag, "src"));
    const alt = getHtmlAttribute(tag, "alt") || getHtmlAttribute(tag, "title") || "emote";
    if (src) {
      parts.push({
        type: "emote",
        value: alt,
        alt,
        provider: "kick",
        src
      });
    } else if (alt) {
      parts.push({ type: "text", value: alt });
    }

    cursor = match.index + tag.length;
  }

  const after = stripHtml(raw.slice(cursor));
  if (after) {
    parts.push({ type: "text", value: after });
  }

  return parts.length > 0 ? expandKickShortcodeParts(parts) : null;
}

function extractText(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string" || typeof value === "number") {
    return stripHtml(value);
  }

  if (Array.isArray(value)) {
    return value.map(extractText).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }

  if (typeof value !== "object") {
    return "";
  }

  const directCandidates = [
    value.text,
    value.content,
    value.message,
    value.body,
    value.value,
    value.name
  ];
  for (const candidate of directCandidates) {
    const text = extractText(candidate);
    if (text) {
      return text;
    }
  }

  const fragmentCandidates = [
    value.fragments,
    value.parts,
    value.messages,
    value.children
  ];
  for (const candidate of fragmentCandidates) {
    const text = extractText(candidate);
    if (text) {
      return text;
    }
  }

  return "";
}

function parseJsonMaybe(value) {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function readJsonResponse(response) {
  const text = await response.text();
  const parsed = parseJsonMaybe(text);

  if (!response.ok) {
    const message = typeof parsed === "object" && parsed?.error
      ? parsed.error
      : text || `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return parsed;
}

async function fetchKickChannelDirect(channel) {
  const response = await fetch(`${KICK_CHANNEL_API}/${encodeURIComponent(channel)}`, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "Live-Control-CHAThub/1.0"
    }
  });
  return readJsonResponse(response);
}

async function fetchKickChannelProxy(channel) {
  const response = await fetch(`${KICK_CHANNEL_PROXY_API}/${encodeURIComponent(channel)}`, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "Live-Control-CHAThub/1.0"
    }
  });
  const payload = await readJsonResponse(response);
  const content = payload?.data?.content || payload?.content || "";
  const parsed = parseJsonMaybe(content);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Fallback publico da Kick nao retornou metadata JSON.");
  }
  return parsed;
}

async function fetchKickChannel(channel) {
  try {
    const payload = await fetchKickChannelDirect(channel);
    return { payload, method: "direct" };
  } catch (directError) {
    const payload = await fetchKickChannelProxy(channel);
    return {
      payload,
      method: "proxy",
      direct_error: directError.message
    };
  }
}

function normalizeMetadata(payload = {}, method = "direct", directError = "") {
  const chatroomId = payload.chatroom?.id ?? payload.chatroom_id ?? "";
  const channelId = payload.id ?? payload.channel_id ?? "";
  const broadcasterUserId = payload.user_id ?? payload.broadcaster_user_id ?? payload.user?.id ?? "";
  const livestream = payload.livestream || null;
  return {
    channel: payload.slug || payload.username || "",
    channel_display_name: payload.user?.username || payload.slug || payload.username || "",
    chatroom_id: chatroomId ? String(chatroomId) : "",
    channel_id: channelId ? String(channelId) : "",
    broadcaster_user_id: broadcasterUserId ? String(broadcasterUserId) : "",
    is_live: Boolean(livestream),
    title: livestream?.session_title || livestream?.title || "",
    started_at: livestream?.created_at || livestream?.start_time || "",
    viewer_count: livestream?.viewer_count ?? livestream?.viewers ?? null,
    metadata_method: method,
    direct_error: directError
  };
}

function buildAuthor(sender = {}, message = {}) {
  const roles = [];
  const rawRoles = Array.isArray(sender.roles) ? sender.roles : [];
  const badges = Array.isArray(sender.badges) ? sender.badges : [];
  const roleText = [
    ...rawRoles.map((role) => String(role).toLowerCase()),
    ...badges.map((badge) => String(badge?.name || badge?.label || badge).toLowerCase())
  ];

  if (sender.is_moderator || sender.moderator || roleText.some((role) => role.includes("mod"))) {
    roles.push("mod");
  }
  if (sender.is_vip || sender.vip || roleText.some((role) => role.includes("vip"))) {
    roles.push("vip");
  }
  if (sender.is_subscriber || sender.subscriber || roleText.some((role) => role.includes("sub"))) {
    roles.push("subscriber");
  }
  if (roles.length === 0) {
    roles.push("viewer");
  }

  return {
    id: String(sender.id || sender.user_id || message.sender_id || ""),
    name: sender.display_name || sender.username || sender.name || "Kick viewer",
    color: sender.identity?.color || sender.color || "",
    roles
  };
}

function normalizeChatPacket(packet) {
  const body = parseJsonMaybe(packet?.data) || packet?.body || {};
  const payload = body.message || body.data?.message || body.payload?.message ? body : { message: body };
  const message = payload.message || payload.data?.message || payload.payload?.message || payload;
  const sender = payload.sender || payload.user || message?.sender || payload.profile || {};
  const rawContent = message?.content || message?.message || message?.body || payload?.content || payload?.message || "";
  const rawText = extractText(message) || extractText(payload);
  const parts = extractHtmlMessageParts(rawContent) || extractKickShortcodeParts(rawText);
  const text = parts ? (messagePartsToText(parts) || rawText) : rawText;

  if (!text) {
    return null;
  }

  return {
    id: message?.id || payload.message_id || payload.id || "",
    time: message?.created_at || payload.created_at || payload.timestamp || nowIso(),
    author: buildAuthor(sender, message),
    text,
    parts: parts || [{ type: "text", value: text }],
    raw: body
  };
}

export class KickChatAdapter {
  constructor({
    channel,
    onEvent,
    metadataRefreshMs = 60000,
    reconnectBaseDelayMs = 2000,
    reconnectMaxDelayMs = 30000,
    onLog = () => {}
  }) {
    this.channel = normalizeKickChannelInput(channel);
    this.channelDisplayName = this.channel;
    this.onEvent = onEvent;
    this.metadataRefreshMs = metadataRefreshMs;
    this.reconnectBaseDelayMs = reconnectBaseDelayMs;
    this.reconnectMaxDelayMs = reconnectMaxDelayMs;
    this.onLog = onLog;
    this.streamId = "live";
    this.chatroomId = "";
    this.channelId = "";
    this.broadcasterUserId = "";
    this.socket = null;
    this.running = false;
    this.connected = false;
    this.liveSeen = false;
    this.currentTitle = "";
    this.metadataTimer = null;
    this.pingTimer = null;
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
    this.manualStop = false;
    this.seenMessageIds = new Set();
  }

  buildConnectionId() {
    return buildConnectionId({
      source: "kick",
      channel: this.channel,
      streamId: this.streamId
    });
  }

  async start() {
    if (this.running) return;
    if (!this.channel) {
      throw new Error("Kick adapter precisa de channel.");
    }

    this.running = true;
    this.manualStop = false;
    await this.startConnectionAttempt({ initial: true });

    this.metadataTimer = setInterval(() => {
      this.refreshMetadata()
        .then((metadata) => this.applyMetadata(metadata))
        .catch((error) => {
          this.onEvent(createSystemEvent({
            channel: this.channel,
            streamId: this.streamId,
            kind: "source_error",
            level: "warning",
            title: "metadata kick falhou",
            message: error.message
          }));
        });
    }, this.metadataRefreshMs);
  }

  async startConnectionAttempt({ initial = false } = {}) {
    if (!this.running) return;

    const message = initial
      ? `Preparando sessao Kick ${this.channel}`
      : `Reconectando Kick ${this.channel} (tentativa ${this.reconnectAttempt})`;

    this.onEvent(createSystemEvent({
      channel: this.channel,
      streamId: this.streamId,
      kind: "source_connecting",
      title: initial ? "kick conectando" : "kick reconectando",
      message,
      metadata: { ingestion_method: "compatibility" }
    }));
    this.onLog("info", "kick_connecting", message, {
      channel: this.channel,
      reconnect_attempt: this.reconnectAttempt,
      initial
    });

    try {
      const metadata = await this.refreshMetadata();
      this.applyMetadata(metadata);
      if (!this.chatroomId) {
        throw new Error("Kick nao retornou chatroom_id publico para este canal.");
      }
      if (!metadata.is_live) {
        throw new Error(`${this.channelDisplayName || this.channel} nao esta ao vivo na Kick.`);
      }
      await this.openSocket();
      this.reconnectAttempt = 0;
    } catch (error) {
      this.connected = false;
      this.onEvent(createSystemEvent({
        channel: this.channel,
        streamId: this.streamId,
        kind: "source_error",
        level: "warning",
        title: "kick falhou",
        message: error.message,
        metadata: { ingestion_method: "compatibility" }
      }));
      this.onLog("warning", "kick_connect_failed", error.message, {
        channel: this.channel,
        reconnect_attempt: this.reconnectAttempt
      });
      this.scheduleReconnect(error.message);
    }
  }

  async refreshMetadata() {
    const { payload, method, direct_error: directError } = await fetchKickChannel(this.channel);
    return normalizeMetadata(payload, method, directError);
  }

  applyMetadata(metadata) {
    if (metadata.channel) {
      this.channel = normalizeKickChannelInput(metadata.channel);
    }
    this.channelDisplayName = metadata.channel_display_name || this.channelDisplayName || this.channel;
    this.chatroomId = metadata.chatroom_id || this.chatroomId;
    this.channelId = metadata.channel_id || this.channelId;
    this.broadcasterUserId = metadata.broadcaster_user_id || this.broadcasterUserId;

    if (metadata.title && metadata.title !== this.currentTitle) {
      this.currentTitle = metadata.title;
      this.onEvent(createSystemEvent({
        channel: this.channel,
        streamId: this.streamId,
        kind: "livestream_metadata_updated",
        title: "metadata kick sincronizada",
        message: `${this.channel} publicou titulo`,
        metadata: {
          title: metadata.title,
          viewer_count: metadata.viewer_count,
          ingestion_method: "compatibility",
          metadata_method: metadata.metadata_method
        }
      }));
    }

    if (metadata.is_live && !this.liveSeen) {
      this.liveSeen = true;
      this.onEvent(createSystemEvent({
        channel: this.channel,
        streamId: this.streamId,
        kind: "stream_started",
        title: "kick live detectada",
        message: `${this.channel} entrou ao vivo na Kick`,
        metadata: {
          title: metadata.title,
          started_at: metadata.started_at || "",
          viewer_count: metadata.viewer_count,
          ingestion_method: "compatibility",
          metadata_method: metadata.metadata_method
        }
      }));
    }

    if (!metadata.is_live && this.liveSeen) {
      this.liveSeen = false;
      this.onEvent(createSystemEvent({
        channel: this.channel,
        streamId: this.streamId,
        kind: "stream_ended",
        title: "kick live encerrada",
        message: `${this.channel} saiu do ar na Kick`,
        metadata: { ingestion_method: "compatibility" }
      }));
    }

    if (metadata.metadata_method === "proxy" && metadata.direct_error) {
      this.onLog("warning", "kick_metadata_proxy_fallback", metadata.direct_error, {
        channel: this.channel
      });
    }
  }

  sendPusherFrame(event, data) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(JSON.stringify({ event, data }));
  }

  openSocket() {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(PUSHER_URL);
      this.socket = socket;
      let resolved = false;
      let subscribed = false;
      let socketErrorMessage = "";

      const timeout = setTimeout(() => {
        if (!resolved) {
          reject(new Error("Timeout ao conectar no chat publico da Kick."));
        }
        try {
          socket.close();
        } catch {
          // socket ja pode ter fechado
        }
      }, 15000);

      const resolveOnce = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        resolve();
      };

      const rejectOnce = (error) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        reject(error);
      };

      socket.addEventListener("message", (event) => {
        const payload = parseJsonMaybe(String(event.data));
        if (!payload || typeof payload !== "object") {
          return;
        }

        const eventName = payload.event || "";
        if (eventName === "pusher:connection_established") {
          const channels = [
            `chatrooms.${this.chatroomId}.v2`,
            `chatrooms.${this.chatroomId}`
          ];
          if (this.channelId) {
            channels.push(`channel.${this.channelId}`);
          }
          for (const channel of channels) {
            this.sendPusherFrame("pusher:subscribe", { auth: "", channel });
          }
          this.startPusherPing(payload.data);
          return;
        }

        if (eventName === "pusher_internal:subscription_succeeded") {
          if (!subscribed) {
            subscribed = true;
            this.connected = true;
            this.onEvent(createSystemEvent({
              channel: this.channel,
              streamId: this.streamId,
              kind: "source_connected",
              title: "kick conectado",
              message: `Sessao Kick ${this.channel} pronta`,
              metadata: {
                ingestion_method: "compatibility",
                chatroom_id: this.chatroomId,
                pusher_channel: payload.channel || ""
              }
            }));
            this.onLog("info", "kick_connected", "Sessao conectada", {
              channel: this.channel,
              chatroom_id: this.chatroomId
            });
            resolveOnce();
          }
          return;
        }

        if (eventName === "pusher:ping") {
          this.sendPusherFrame("pusher:pong", {});
          return;
        }

        if (eventName === "pusher:pong") {
          return;
        }

        if (eventName === "pusher:error") {
          const message = payload.data?.message || "Erro no socket publico da Kick.";
          this.onLog("warning", "kick_pusher_error", message, {
            channel: this.channel
          });
          if (!this.connected) {
            rejectOnce(new Error(message));
          }
          return;
        }

        if (eventName === "App\\Events\\ChatMessageEvent") {
          const chatPayload = normalizeChatPacket(payload);
          if (!chatPayload) return;
          if (chatPayload.id && this.seenMessageIds.has(chatPayload.id)) return;
          if (chatPayload.id) {
            this.seenMessageIds.add(chatPayload.id);
            if (this.seenMessageIds.size > 500) {
              const oldest = this.seenMessageIds.values().next().value;
              this.seenMessageIds.delete(oldest);
            }
          }
          this.onEvent(createChatEvent({
            id: chatPayload.id,
            channel: this.channel,
            streamId: this.streamId,
            channelDisplayName: this.channelDisplayName,
            author: chatPayload.author,
            text: chatPayload.text,
            parts: chatPayload.parts,
            time: chatPayload.time,
            rawRef: {
              pusher_event: eventName,
              message_id: chatPayload.id,
              payload: chatPayload.raw
            }
          }));
        }
      });

      socket.addEventListener("error", () => {
        socketErrorMessage = "Falha no socket publico da Kick.";
        this.onLog("warning", "kick_socket_error", socketErrorMessage, {
          channel: this.channel
        });
        if (!this.connected) {
          rejectOnce(new Error(socketErrorMessage));
        }
      });

      socket.addEventListener("close", () => {
        clearTimeout(timeout);
        this.stopPusherPing();
        if (!this.running) {
          return;
        }

        if (this.connected) {
          this.connected = false;
          this.socket = null;
          this.onEvent(createSystemEvent({
            channel: this.channel,
            streamId: this.streamId,
            kind: "source_disconnected",
            title: "kick desconectado",
            message: `${this.channel} finalizado`,
            metadata: { ingestion_method: "compatibility" }
          }));
          this.onLog("warning", "kick_disconnected", "Socket fechado", {
            channel: this.channel,
            manual_stop: this.manualStop
          });
          if (!this.manualStop) {
            this.scheduleReconnect("Conexao de chat Kick fechada.");
          }
        } else if (!resolved) {
          rejectOnce(new Error(socketErrorMessage || "Conexao da Kick fechou antes de confirmar a sessao."));
        }
      });
    });
  }

  startPusherPing(rawConnectionData = "") {
    this.stopPusherPing();
    const connectionData = parseJsonMaybe(rawConnectionData) || {};
    const activityTimeoutSeconds = Number(connectionData.activity_timeout || 60);
    const intervalMs = Math.min(
      Number.isFinite(activityTimeoutSeconds) ? activityTimeoutSeconds * 750 : 45000,
      45000
    );
    this.pingTimer = setInterval(() => {
      this.sendPusherFrame("pusher:ping", {});
    }, intervalMs);
  }

  stopPusherPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  scheduleReconnect(reason = "") {
    if (!this.running || this.manualStop) {
      return;
    }

    if (this.reconnectTimer) {
      return;
    }

    this.reconnectAttempt += 1;
    const delayMs = Math.min(
      this.reconnectMaxDelayMs,
      this.reconnectBaseDelayMs * 2 ** Math.max(0, this.reconnectAttempt - 1)
    );

    this.onEvent(createSystemEvent({
      channel: this.channel,
      streamId: this.streamId,
      kind: "source_connecting",
      title: "kick reconnect agendado",
      message: `${reason || "Reconexao Kick necessaria"} Nova tentativa em ${Math.ceil(delayMs / 1000)}s.`,
      metadata: { ingestion_method: "compatibility" }
    }));
    this.onLog("warning", "kick_reconnect_scheduled", reason || "Reconexao necessaria", {
      channel: this.channel,
      reconnect_attempt: this.reconnectAttempt,
      delay_ms: delayMs
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.startConnectionAttempt().catch(() => {
        // a propria tentativa ja emite estado e agenda novo reconnect
      });
    }, delayMs);
  }

  async stop() {
    this.running = false;
    this.manualStop = true;

    if (this.metadataTimer) {
      clearInterval(this.metadataTimer);
      this.metadataTimer = null;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.stopPusherPing();

    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // socket ja pode estar fechado
      }
      this.socket = null;
    }
  }
}
