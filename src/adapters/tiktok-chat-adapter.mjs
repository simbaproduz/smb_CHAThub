//        __     __                   
// _|_   (_ ||\/|__) /\ _ _ _ _|   _  
//  |    __)||  |__)/--|_| (_(_||_|/_ 
//                     |  

import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { buildConnectionId, getPlatformDef } from "../core/platforms.mjs";

const require = createRequire(import.meta.url);
const { TikTokLiveConnection } = require("tiktok-live-connector");

const PLATFORM = getPlatformDef("tiktok");
const TIKTOK_EMOTE_URL_BY_LABEL = new Map();

function nowIso() {
  return new Date().toISOString();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim().length > 0;
}

export function normalizeTikTokUniqueIdInput(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) {
    return "";
  }

  try {
    const candidate = /^[a-z]+:\/\//i.test(rawValue) ? rawValue : `https://${rawValue}`;
    const url = new URL(candidate);
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    if (host.includes("tiktok.com")) {
      const segments = url.pathname.split("/").filter(Boolean);
      const handleSegment = segments.find((segment) => segment.startsWith("@")) || segments[0] || "";
      return handleSegment.replace(/^@/, "").trim().toLowerCase();
    }
  } catch {
    // fallback para entrada manual abaixo
  }

  return rawValue
    .replace(/^@/, "")
    .replace(/\/live$/i, "")
    .trim()
    .toLowerCase();
}

export function canStartTikTokCompatibility(config = {}) {
  return Boolean(
    config?.enabled
    && normalizeTikTokUniqueIdInput(config.unique_id || config.channel || config.quick_input)
    && (config.setup_mode === "compatibility" || !config.setup_mode || config.quick_input)
  );
}

function normalizeTikTokError(error) {
  const message = error?.message || String(error);

  if (/isn'?t online/i.test(message)) {
    return "Nenhuma live publica ativa foi encontrada para esse @handle do TikTok.";
  }

  if (/ttTargetIdc|sessionId|authenticate/i.test(message)) {
    return "A rota atual do TikTok exige sessao autenticada adicional para este tipo de conexao.";
  }

  if (/sign server|signature|websocket/i.test(message)) {
    return "A rota real do TikTok depende de signing/relay que falhou nesta tentativa.";
  }

  if (/SIGI_STATE|captcha-blocked|blocked by TikTok/i.test(message)) {
    return "TikTok bloqueou a resolucao publica desta live no momento.";
  }

  return message;
}

function isRetryableTikTokError(message) {
  return /signing\/relay|sign server|signature|websocket|ttTargetIdc|sessionId|authenticate|SIGI_STATE|captcha-blocked|blocked by TikTok/i.test(message);
}

function buildAuthorRoles(data = {}) {
  const roles = [];
  const badges = Array.isArray(data?.user?.userBadges) ? data.user.userBadges : [];

  if (data?.user?.isModerator) {
    roles.push("mod");
  }

  if (data?.user?.isSubscriber) {
    roles.push("subscriber");
  }

  for (const badge of badges) {
    const badgeText = String(
      badge?.displayType
      || badge?.name
      || badge?.badgeName
      || badge?.badgeScene
      || ""
    ).toLowerCase();

    if (badgeText.includes("moder")) {
      roles.push("mod");
    }
    if (badgeText.includes("sub")) {
      roles.push("subscriber");
    }
  }

  if (roles.length === 0) {
    roles.push("viewer");
  }

  return [...new Set(roles)];
}

function createSystemEvent({
  channel,
  streamId,
  kind,
  level = "info",
  title,
  message,
  metadata
}) {
  return {
    id: randomUUID(),
    version: "system-event.v0",
    source: "tiktok",
    channel,
    connection_id: buildConnectionId({ source: "tiktok", channel, streamId }),
    stream_id: streamId,
    kind,
    level,
    time: nowIso(),
    title,
    message,
    recoverable: kind !== "stream_ended",
    accent_color: PLATFORM.accentColor,
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
  kind = "message",
  metadata = {}
}) {
  return {
    id: id || randomUUID(),
    version: "chat-event.v0",
    source: "tiktok",
    channel,
    connection_id: buildConnectionId({ source: "tiktok", channel, streamId }),
    stream_id: streamId,
    channel_display_name: channelDisplayName,
    kind,
    time: nowIso(),
    author,
    text,
    parts: Array.isArray(parts) && parts.length > 0 ? parts : [{ type: "text", value: text }],
    accent_color: PLATFORM.accentColor,
    raw_ref: id || "",
    metadata
  };
}

function normalizeEmoteUrl(value = "") {
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const normalized = normalizeEmoteUrl(candidate);
      if (normalized) {
        return normalized;
      }
    }
    return "";
  }

  const rawUrl = String(value || "").trim();
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

function normalizeTikTokShortcodeLabel(value = "") {
  return String(value || "").replace(/^\[|\]$/g, "").trim();
}

function getTikTokImageUrl(image = {}) {
  return normalizeEmoteUrl([
    image?.imageUrl,
    image?.url,
    image?.uri
  ]);
}

function getTikTokEmoteUrl(emote = {}) {
  return normalizeEmoteUrl([
    emote.emoteImageUrl,
    emote.imageUrl,
    getTikTokImageUrl(emote.image),
    emote.emote?.emoteImageUrl,
    emote.emote?.imageUrl,
    getTikTokImageUrl(emote.emote?.image),
    emote.url
  ]);
}

function getTikTokEmoteId(emote = {}) {
  return String(
    emote.emoteId
    || emote.id
    || emote.emote?.emoteId
    || emote.emote?.id
    || ""
  );
}

function isTikTokShortcodeLabel(value = "") {
  return /^[A-Za-z][A-Za-z0-9_-]{1,48}$/.test(String(value || ""));
}

function findTikTokShortcodeAt(text = "", rawPosition = 0) {
  const position = Math.max(0, Math.min(text.length, Number(rawPosition) || 0));
  const pattern = /\[([A-Za-z][A-Za-z0-9_-]{1,48})\]/g;
  let match;

  while ((match = pattern.exec(text))) {
    const start = match.index;
    const end = start + match[0].length;
    if (start <= position && position <= end) {
      return { start, end, label: normalizeTikTokShortcodeLabel(match[1]) };
    }
    if (start > position) {
      break;
    }
  }

  return null;
}

function rememberTikTokEmote(label = "", src = "") {
  const key = normalizeTikTokShortcodeLabel(label).toLowerCase();
  if (key && src) {
    TIKTOK_EMOTE_URL_BY_LABEL.set(key, src);
  }
}

function getCachedTikTokEmoteUrl(label = "") {
  return TIKTOK_EMOTE_URL_BY_LABEL.get(normalizeTikTokShortcodeLabel(label).toLowerCase()) || "";
}

function splitTikTokShortcodeParts(text = "") {
  const rawText = String(text || "");
  if (!rawText) {
    return [];
  }

  const parts = [];
  const pattern = /\[([A-Za-z][A-Za-z0-9_-]{1,48})\]/g;
  let cursor = 0;
  let match;

  while ((match = pattern.exec(rawText))) {
    const label = normalizeTikTokShortcodeLabel(match[1]);
    if (!isTikTokShortcodeLabel(label)) {
      continue;
    }

    if (match.index > cursor) {
      parts.push({ type: "text", value: rawText.slice(cursor, match.index) });
    }

    const src = getCachedTikTokEmoteUrl(label);
    parts.push({
      type: "emote",
      value: label,
      alt: label,
      id: "",
      provider: "tiktok",
      src
    });
    cursor = match.index + match[0].length;
  }

  if (cursor < rawText.length) {
    parts.push({ type: "text", value: rawText.slice(cursor) });
  }

  return parts.length > 0 ? parts : [{ type: "text", value: rawText }];
}

function expandTikTokShortcodesInParts(parts = []) {
  const expanded = [];

  for (const part of parts) {
    if (part?.type !== "text") {
      expanded.push(part);
      continue;
    }
    expanded.push(...splitTikTokShortcodeParts(part.value));
  }

  return expanded.filter((part) => part.value || part.src);
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

function buildTikTokMessageParts(text = "", emotes = []) {
  const validEmotes = Array.isArray(emotes)
    ? emotes
      .map((emote, index) => ({
        emote,
        index,
        position: Number(emote?.placeInComment),
        src: getTikTokEmoteUrl(emote)
      }))
      .filter((entry) => entry.src)
      .sort((a, b) => (
        Number.isFinite(a.position) && Number.isFinite(b.position)
          ? a.position - b.position
          : a.index - b.index
      ))
    : [];

  if (validEmotes.length === 0) {
    return expandTikTokShortcodesInParts([{ type: "text", value: text }]);
  }

  const parts = [];
  let cursor = 0;

  for (const entry of validEmotes) {
    const rawPosition = Number.isFinite(entry.position) ? Math.max(0, entry.position) : text.length;
    const position = Math.min(text.length, rawPosition);
    const shortcode = findTikTokShortcodeAt(text, position);
    const textEnd = shortcode && shortcode.start >= cursor ? shortcode.start : position;
    if (textEnd > cursor) {
      parts.push({ type: "text", value: text.slice(cursor, textEnd) });
    }

    const value = shortcode?.label || getTikTokEmoteId(entry.emote) || "emote";
    rememberTikTokEmote(value, entry.src);
    parts.push({
      type: "emote",
      value,
      alt: value,
      id: getTikTokEmoteId(entry.emote),
      provider: "tiktok",
      src: entry.src
    });
    cursor = shortcode && shortcode.end > cursor ? shortcode.end : position;
  }

  if (cursor < text.length) {
    parts.push({ type: "text", value: text.slice(cursor) });
  }

  return parts.length > 0 ? expandTikTokShortcodesInParts(parts) : [{ type: "text", value: text }];
}

export class TikTokChatAdapter {
  constructor({
    config,
    reconnectBaseDelayMs = 2000,
    reconnectMaxDelayMs = 30000,
    onEvent,
    onLog = () => {}
  }) {
    this.config = {
      enabled: Boolean(config?.enabled),
      quick_input: String(config?.quick_input || "").trim(),
      channel: String(config?.channel || "").trim(),
      unique_id: String(config?.unique_id || "").trim()
    };
    this.onEvent = onEvent;
    this.onLog = onLog;
    this.uniqueId = normalizeTikTokUniqueIdInput(
      this.config.unique_id || this.config.channel || this.config.quick_input
    );
    this.channelDisplayName = this.uniqueId ? `@${this.uniqueId}` : "TikTok";
    this.streamId = this.uniqueId || "live";
    this.connection = null;
    this.running = false;
    this.manualStop = false;
    this.reconnectBaseDelayMs = reconnectBaseDelayMs;
    this.reconnectMaxDelayMs = reconnectMaxDelayMs;
    this.liveStarted = false;
    this.currentTitle = "";
    this.lastViewerCount = null;
    this.starting = false;
    this.connectedOnce = false;
    this.lastStartupError = "";
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
  }

  buildConnectionId() {
    return buildConnectionId({
      source: "tiktok",
      channel: this.uniqueId,
      streamId: this.streamId
    });
  }

  emitSystemEvent(payload) {
    this.onEvent(createSystemEvent({
      channel: this.uniqueId,
      streamId: this.streamId,
      ...payload
    }));
  }

  emitChatEvent(payload) {
    this.onEvent(createChatEvent({
      channel: this.uniqueId,
      streamId: this.streamId,
      channelDisplayName: this.channelDisplayName,
      ...payload
    }));
  }

  log(level, event, message, metadata = {}) {
    this.onLog(level, event, message, metadata);
  }

  applyRoomInfo(state = {}) {
    const roomInfo = state.roomInfo?.data || {};
    const ownerNickname = roomInfo.owner?.nickname || "";
    const title = typeof roomInfo.title === "string" ? roomInfo.title.trim() : "";

    if (ownerNickname) {
      this.channelDisplayName = ownerNickname;
    }
    if (title && title !== this.currentTitle) {
      this.currentTitle = title;
      this.emitSystemEvent({
        kind: "livestream_metadata_updated",
        title: "metadata sincronizada",
        message: `${this.channelDisplayName} publicou titulo`,
        metadata: {
          ingestion_method: "compatibility",
          title
        }
      });
    }
  }

  bindConnectionEvents() {
    this.connection.on("connected", (state) => {
      this.connectedOnce = true;
      this.starting = false;
      this.reconnectAttempt = 0;
      this.applyRoomInfo(state);
      this.emitSystemEvent({
        kind: "source_connected",
        title: "tiktok conectado",
        message: `Sessao TikTok ${this.channelDisplayName} pronta`,
        metadata: {
          ingestion_method: "compatibility",
          room_id: state.roomId || null
        }
      });

      if (!this.liveStarted) {
        this.liveStarted = true;
        this.emitSystemEvent({
          kind: "stream_started",
          title: "live detectada",
          message: `${this.channelDisplayName} entrou ao vivo no TikTok.`,
          metadata: {
            ingestion_method: "compatibility",
            title: this.currentTitle || ""
          }
        });
      }

      this.log("info", "tiktok_connected", "Sessao conectada", {
        unique_id: this.uniqueId,
        room_id: state.roomId || null,
        title: this.currentTitle || ""
      });
    });

    this.connection.on("chat", (data) => {
      const text = String(data?.comment || "").trim();
      if (!text) {
        return;
      }
      const parts = buildTikTokMessageParts(text, data?.emotes);
      const displayText = messagePartsToText(parts) || text;

      this.emitChatEvent({
        id: data?.common?.msgId ? `tiktok:${data.common.msgId}` : randomUUID(),
        author: {
          id: data?.user?.userId || "",
          name: data?.user?.nickname || data?.user?.uniqueId || "TikTok user",
          color: "",
          roles: buildAuthorRoles(data)
        },
        text: displayText,
        parts,
        metadata: {
          ingestion_method: "compatibility",
          unique_id: data?.user?.uniqueId || "",
          profile_picture_url: data?.user?.profilePicture?.url?.[0] || "",
          emotes_count: Array.isArray(data?.emotes) ? data.emotes.length : 0
        }
      });
    });

    this.connection.on("member", (data) => {
      const authorName = data?.user?.nickname || data?.user?.uniqueId || "TikTok member";
      this.emitChatEvent({
        id: data?.common?.msgId ? `tiktok:${data.common.msgId}` : randomUUID(),
        kind: "membership",
        author: {
          id: data?.user?.userId || "",
          name: authorName,
          color: "",
          roles: buildAuthorRoles(data)
        },
        text: `${authorName} entrou na live`,
        metadata: {
          ingestion_method: "compatibility",
          event: "member"
        }
      });
    });

    this.connection.on("gift", (data) => {
      const authorName = data?.user?.nickname || data?.user?.uniqueId || "TikTok user";
      const giftName = data?.giftName || data?.gift?.name || "Gift";
      const repeatCount = Number(data?.repeatCount || data?.gift?.repeat_count || 1);
      this.emitChatEvent({
        id: data?.common?.msgId ? `tiktok:${data.common.msgId}` : randomUUID(),
        kind: "highlight",
        author: {
          id: data?.user?.userId || "",
          name: authorName,
          color: "",
          roles: buildAuthorRoles(data)
        },
        text: `${giftName} x${repeatCount}`,
        metadata: {
          ingestion_method: "compatibility",
          event: "gift"
        }
      });
    });

    this.connection.on("roomUser", (data) => {
      const viewerCount = Number(data?.viewerCount);
      if (!Number.isFinite(viewerCount) || viewerCount === this.lastViewerCount) {
        return;
      }

      this.lastViewerCount = viewerCount;
      this.emitSystemEvent({
        kind: "livestream_metadata_updated",
        title: "audiencia sincronizada",
        message: `${this.channelDisplayName} com ${viewerCount} pessoas na live`,
        metadata: {
          ingestion_method: "compatibility",
          viewer_count: viewerCount,
          title: this.currentTitle || ""
        }
      });
    });

    this.connection.on("streamEnd", () => {
      this.liveStarted = false;
      this.emitSystemEvent({
        kind: "stream_ended",
        level: "warning",
        title: "live finalizada",
        message: `${this.channelDisplayName} saiu do ar no TikTok.`,
        metadata: {
          ingestion_method: "compatibility"
        }
      });
    });

    this.connection.on("disconnected", ({ code = null, reason = "" } = {}) => {
      if (!this.running || this.manualStop) {
        return;
      }

      if (this.starting && !this.connectedOnce) {
        this.lastStartupError = normalizeTikTokError(reason || "Conexao TikTok encerrada durante a tentativa inicial.");
        this.log("warning", "tiktok_startup_disconnected", this.lastStartupError, {
          unique_id: this.uniqueId,
          code
        });
        return;
      }

      this.connection = null;
      this.liveStarted = false;
      this.emitSystemEvent({
        kind: "source_disconnected",
        level: "warning",
        title: "tiktok desconectado",
        message: reason || "A conexao TikTok foi encerrada.",
        metadata: {
          ingestion_method: "compatibility",
          code
        }
      });
      this.log("warning", "tiktok_disconnected", reason || "Sessao encerrada", {
        unique_id: this.uniqueId,
        code
      });
      this.scheduleReconnect(reason || "Conexao de chat TikTok encerrada.");
    });

    this.connection.on("error", ({ info = "", exception = null } = {}) => {
      if (!this.running || this.manualStop) {
        return;
      }

      const message = normalizeTikTokError(exception || info || "Falha inesperada no TikTok.");

      if (this.starting && !this.connectedOnce) {
        this.lastStartupError = message;
        this.log("warning", "tiktok_startup_error", message, {
          unique_id: this.uniqueId
        });
        return;
      }

      this.emitSystemEvent({
        kind: "source_error",
        level: "warning",
        title: "tiktok falhou",
        message,
        metadata: {
          ingestion_method: "compatibility"
        }
      });
      this.log("warning", "tiktok_runtime_error", message, {
        unique_id: this.uniqueId
      });
    });
  }

  async disposeConnection() {
    if (!this.connection) {
      return;
    }

    try {
      await this.connection.disconnect();
    } catch {
      // ignore
    }

    this.connection.removeAllListeners?.();
    this.connection = null;
  }

  async startConnectionAttempt({ initial = false, throwOnFailure = false } = {}) {
    if (!this.running) {
      return;
    }

    this.lastViewerCount = null;
    this.connectedOnce = false;
    this.lastStartupError = "";
    this.starting = true;

    const message = initial
      ? `Tentando conexao real para @${this.uniqueId}.`
      : `Reconectando TikTok @${this.uniqueId} (tentativa ${this.reconnectAttempt}).`;

    this.emitSystemEvent({
      kind: "source_connecting",
      title: initial ? "tiktok conectando" : "tiktok reconectando",
      message,
      metadata: {
        ingestion_method: "compatibility",
        input: this.config.quick_input || this.config.unique_id || this.config.channel || ""
      }
    });

    this.log("info", "tiktok_connecting", initial ? "Tentando conexao TikTok" : "Reconectando TikTok", {
      unique_id: this.uniqueId,
      reconnect_attempt: this.reconnectAttempt,
      initial
    });

    const maxAttempts = 3;
    let finalError = "";

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      this.connection = new TikTokLiveConnection(this.uniqueId, {
        fetchRoomInfoOnConnect: true,
        processInitialData: true,
        enableExtendedGiftInfo: false,
        enableRequestPolling: true,
        requestPollingIntervalMs: 1500,
        logFetchFallbackErrors: true
      });

      this.connectedOnce = false;
      this.lastStartupError = "";
      this.bindConnectionEvents();

      try {
        await this.connection.connect();
        this.starting = false;
        this.reconnectAttempt = 0;
        return;
      } catch (error) {
        finalError = this.lastStartupError || normalizeTikTokError(error);
        await this.disposeConnection();

        if (attempt >= maxAttempts || !isRetryableTikTokError(finalError)) {
          this.starting = false;
          if (throwOnFailure) {
            this.running = false;
            throw new Error(finalError);
          }

          this.emitSystemEvent({
            kind: "source_error",
            level: "warning",
            title: "tiktok falhou",
            message: finalError,
            metadata: {
              ingestion_method: "compatibility"
            }
          });
          this.log("warning", "tiktok_connect_failed", finalError, {
            unique_id: this.uniqueId,
            reconnect_attempt: this.reconnectAttempt
          });
          if (isRetryableTikTokError(finalError)) {
            this.scheduleReconnect(finalError);
          }
          return;
        }

        this.log("warning", "tiktok_retry_scheduled", "Nova tentativa TikTok agendada", {
          unique_id: this.uniqueId,
          attempt,
          max_attempts: maxAttempts,
          reason: finalError
        });
        await delay(1250 * attempt);
      }
    }

    this.starting = false;
    if (throwOnFailure) {
      this.running = false;
      throw new Error(finalError || "Falha inesperada ao iniciar TikTok.");
    }

    if (isRetryableTikTokError(finalError || "")) {
      this.scheduleReconnect(finalError || "Falha inesperada ao iniciar TikTok.");
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

    this.emitSystemEvent({
      kind: "source_connecting",
      title: "tiktok reconnect agendado",
      message: `${reason || "Reconexao TikTok necessaria"} Nova tentativa em ${Math.ceil(delayMs / 1000)}s.`,
      metadata: {
        ingestion_method: "compatibility"
      }
    });
    this.log("warning", "tiktok_reconnect_scheduled", reason || "Reconexao necessaria", {
      unique_id: this.uniqueId,
      reconnect_attempt: this.reconnectAttempt,
      delay_ms: delayMs
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.startConnectionAttempt({ initial: false }).catch(() => {
        // a propria tentativa emite estado e agenda novo reconnect
      });
    }, delayMs);
  }

  async start() {
    if (this.running) {
      return;
    }

    if (!this.uniqueId) {
      throw new Error("TikTok adapter precisa de @handle ou URL da live.");
    }

    this.running = true;
    this.manualStop = false;
    this.liveStarted = false;
    this.lastViewerCount = null;
    this.streamId = this.uniqueId;
    this.currentTitle = "";
    this.connectedOnce = false;
    this.lastStartupError = "";
    await this.startConnectionAttempt({ initial: true, throwOnFailure: true });
  }

  async stop() {
    this.running = false;
    this.manualStop = true;
    this.starting = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    await this.disposeConnection();
  }
}
