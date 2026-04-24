//        __     __                   
// _|_   (_ ||\/|__) /\ _ _ _ _|   _  
//  |    __)||  |__)/--|_| (_(_||_|/_ 
//                     |  

import { randomUUID } from "node:crypto";
import { buildConnectionId, getPlatformDef } from "../core/platforms.mjs";

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_CHANNEL_ID_PATTERN = /^UC[\w-]{10,}$/i;
const YOUTUBE_HANDLE_PATTERN = /^@[\w.-]+$/i;

function nowIso() {
  return new Date().toISOString();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim().length > 0;
}

function normalizeValue(value) {
  return String(value || "").trim();
}

function looksLikeYouTubeUrl(value) {
  const rawValue = normalizeValue(value);
  return /^https?:\/\//i.test(rawValue) && /(youtu\.be|youtube\.com)/i.test(rawValue);
}

function parseYouTubeUrl(rawValue) {
  const value = normalizeValue(rawValue);
  if (!looksLikeYouTubeUrl(value)) {
    return {};
  }

  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    const segments = url.pathname.split("/").filter(Boolean);

    if (host === "youtu.be") {
      return { videoId: segments[0] || "" };
    }

    if (segments[0] === "watch" || segments[0] === "live_chat") {
      return { videoId: url.searchParams.get("v") || "" };
    }

    if (segments[0] === "live" && segments[1]) {
      return { videoId: segments[1] };
    }

    if (segments[0]?.startsWith("@")) {
      return { handle: segments[0] };
    }

    if (segments[0] === "channel" && segments[1]) {
      return { channelId: segments[1] };
    }

    if (segments[0] === "user" && segments[1]) {
      return { userName: segments[1] };
    }

    return {};
  } catch {
    return {};
  }
}

export function canStartYouTubeRealtime(config = {}) {
  const quickInput = normalizeValue(config.quick_input);
  const channel = normalizeValue(config.channel);
  const channelId = normalizeValue(config.channel_id);
  const parsedUrl = parseYouTubeUrl(quickInput);
  const hasCredential = hasValue(config.api_key) || hasValue(config.access_token);
  const hasResolvableTarget = Boolean(
    parsedUrl.videoId
    || parsedUrl.handle
    || parsedUrl.channelId
    || parsedUrl.userName
    || YOUTUBE_CHANNEL_ID_PATTERN.test(channelId)
    || YOUTUBE_CHANNEL_ID_PATTERN.test(channel)
    || YOUTUBE_HANDLE_PATTERN.test(channel)
    || YOUTUBE_HANDLE_PATTERN.test(quickInput)
    || YOUTUBE_VIDEO_ID_PATTERN.test(quickInput)
  );

  return Boolean(config.enabled && hasCredential && hasResolvableTarget);
}

function buildAuthorRoles(authorDetails = {}) {
  const roles = [];

  if (authorDetails.isChatOwner) roles.push("streamer");
  if (authorDetails.isChatModerator) roles.push("mod");
  if (authorDetails.isChatSponsor) roles.push("member");

  if (roles.length === 0) {
    roles.push("viewer");
  }

  return roles;
}

function buildChatText(item) {
  const snippet = item?.snippet || {};
  const displayMessage = normalizeValue(snippet.displayMessage);
  if (displayMessage) {
    return displayMessage;
  }

  if (snippet.type === "superChatEvent" && hasValue(snippet.superChatDetails?.amountDisplayString)) {
    return `Super Chat ${snippet.superChatDetails.amountDisplayString}`;
  }

  if (snippet.type === "superStickerEvent" && hasValue(snippet.superStickerDetails?.amountDisplayString)) {
    return `Super Sticker ${snippet.superStickerDetails.amountDisplayString}`;
  }

  if (snippet.type === "newSponsorEvent") {
    return "Novo membro entrou no canal";
  }

  if (snippet.type === "memberMilestoneChatEvent") {
    return "Mensagem de marco de membro";
  }

  if (snippet.type === "membershipGiftingEvent") {
    return "Gift de membresia enviado";
  }

  if (snippet.type === "giftMembershipReceivedEvent") {
    return "Gift de membresia recebido";
  }

  return "";
}

function mapMessageKind(item) {
  const type = item?.snippet?.type || "";

  if (type === "superChatEvent" || type === "superStickerEvent") {
    return "highlight";
  }

  if (
    type === "newSponsorEvent"
    || type === "memberMilestoneChatEvent"
    || type === "membershipGiftingEvent"
    || type === "giftMembershipReceivedEvent"
  ) {
    return "membership";
  }

  return "message";
}

function createApiError(response, payload) {
  const reason = payload?.error?.errors?.[0]?.reason || "";
  const message = payload?.error?.message || `Falha HTTP ${response.status} no YouTube.`;
  const error = new Error(message);
  error.status = response.status;
  error.reason = reason;
  return error;
}

export class YouTubeLiveAdapter {
  constructor({
    config,
    onEvent,
    onLog = () => {}
  }) {
    this.config = {
      enabled: Boolean(config?.enabled),
      quick_input: normalizeValue(config?.quick_input),
      channel: normalizeValue(config?.channel),
      channel_id: normalizeValue(config?.channel_id),
      api_key: normalizeValue(config?.api_key),
      access_token: normalizeValue(config?.access_token)
    };
    this.onEvent = onEvent;
    this.onLog = onLog;
    this.platform = getPlatformDef("youtube");
    this.running = false;
    this.pollLoopPromise = null;
    this.pollingIntervalMs = 5000;
    this.nextPageToken = "";
    this.streamId = "";
    this.liveChatId = "";
    this.channelKey = "";
    this.channelDisplayName = "";
    this.currentTitle = "";
  }

  buildConnectionId() {
    return buildConnectionId({
      source: "youtube",
      channel: this.channelKey,
      streamId: this.streamId
    });
  }

  emitSystemEvent({
    kind,
    level = "info",
    title,
    message,
    metadata
  }) {
    this.onEvent({
      id: randomUUID(),
      version: "system-event.v0",
      source: "youtube",
      channel: this.channelKey,
      connection_id: this.buildConnectionId(),
      stream_id: this.streamId,
      kind,
      level,
      time: nowIso(),
      title,
      message,
      recoverable: kind !== "stream_ended",
      accent_color: this.platform.accentColor,
      metadata
    });
  }

  emitChatEvent(item) {
    const text = buildChatText(item);
    if (!text) {
      return;
    }

    const authorDetails = item.authorDetails || {};
    this.onEvent({
      id: item.id || randomUUID(),
      version: "chat-event.v0",
      source: "youtube",
      channel: this.channelKey,
      channel_display_name: this.channelDisplayName || this.channelKey,
      connection_id: this.buildConnectionId(),
      stream_id: this.streamId,
      kind: mapMessageKind(item),
      time: item.snippet?.publishedAt || nowIso(),
      author: {
        id: authorDetails.channelId || "",
        name: authorDetails.displayName || "YouTube user",
        roles: buildAuthorRoles(authorDetails)
      },
      text,
      parts: [{ type: "text", value: text }],
      accent_color: this.platform.accentColor,
      raw_ref: item.id || ""
    });
  }

  getRequestHeaders() {
    if (hasValue(this.config.access_token)) {
      return {
        Authorization: `Bearer ${this.config.access_token}`
      };
    }

    return {};
  }

  async youtubeGet(endpoint, params = {}) {
    const url = new URL(`${YOUTUBE_API_BASE}/${endpoint}`);
    for (const [key, value] of Object.entries(params)) {
      if (hasValue(value)) {
        url.searchParams.set(key, String(value));
      }
    }

    if (hasValue(this.config.api_key)) {
      url.searchParams.set("key", this.config.api_key);
    }

    const response = await fetch(url, {
      headers: this.getRequestHeaders()
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw createApiError(response, payload);
    }

    return payload;
  }

  extractConfiguredTarget() {
    const quickInput = normalizeValue(this.config.quick_input);
    const channelId = normalizeValue(this.config.channel_id);
    const channel = normalizeValue(this.config.channel);
    const parsedUrl = parseYouTubeUrl(quickInput);

    return {
      quickInput,
      videoId: parsedUrl.videoId || (YOUTUBE_VIDEO_ID_PATTERN.test(quickInput) ? quickInput : ""),
      handle: parsedUrl.handle || (YOUTUBE_HANDLE_PATTERN.test(quickInput) ? quickInput : YOUTUBE_HANDLE_PATTERN.test(channel) ? channel : ""),
      channelId: channelId || parsedUrl.channelId || (YOUTUBE_CHANNEL_ID_PATTERN.test(channel) ? channel : ""),
      userName: parsedUrl.userName || ""
    };
  }

  async resolveChannel(candidate) {
    if (candidate.channelId) {
      const payload = await this.youtubeGet("channels", {
        part: "id,snippet",
        id: candidate.channelId,
        maxResults: 1
      });
      const item = payload.items?.[0];
      if (!item?.id) {
        throw new Error("Nao consegui localizar esse channel ID no YouTube.");
      }

      return {
        channelId: item.id,
        channelDisplayName: item.snippet?.title || candidate.channelId,
        channelKey: candidate.handle || item.id
      };
    }

    if (candidate.handle) {
      const payload = await this.youtubeGet("channels", {
        part: "id,snippet",
        forHandle: candidate.handle,
        maxResults: 1
      });
      const item = payload.items?.[0];
      if (!item?.id) {
        throw new Error("Nao consegui resolver esse @handle do YouTube.");
      }

      return {
        channelId: item.id,
        channelDisplayName: item.snippet?.title || candidate.handle,
        channelKey: candidate.handle
      };
    }

    if (candidate.userName) {
      const payload = await this.youtubeGet("channels", {
        part: "id,snippet",
        forUsername: candidate.userName,
        maxResults: 1
      });
      const item = payload.items?.[0];
      if (!item?.id) {
        throw new Error("Nao consegui resolver esse usuario legado do YouTube.");
      }

      return {
        channelId: item.id,
        channelDisplayName: item.snippet?.title || candidate.userName,
        channelKey: item.id
      };
    }

    throw new Error("Para YouTube real nesta passada, use URL da live publica, @handle ou channel ID.");
  }

  async resolveLiveVideoId(candidate) {
    const payload = await this.youtubeGet("search", {
      part: "id,snippet",
      channelId: candidate.channelId,
      eventType: "live",
      type: "video",
      maxResults: 1
    });
    const item = payload.items?.[0];
    const videoId = item?.id?.videoId || "";

    if (!videoId) {
      throw new Error("Nenhuma live publica ativa foi encontrada para esse alvo do YouTube.");
    }

    return videoId;
  }

  async resolveLiveSession() {
    const target = this.extractConfiguredTarget();
    let videoId = target.videoId;
    let channelContext = null;

    if (!videoId) {
      channelContext = await this.resolveChannel(target);
      videoId = await this.resolveLiveVideoId(channelContext);
    }

    const payload = await this.youtubeGet("videos", {
      part: "id,snippet,liveStreamingDetails",
      id: videoId
    });
    const item = payload.items?.[0];

    if (!item?.id) {
      throw new Error("Nao consegui localizar a live do YouTube a partir desse alvo.");
    }

    const liveChatId = item.liveStreamingDetails?.activeLiveChatId || "";
    if (!liveChatId) {
      throw new Error("A live do YouTube foi localizada, mas nao expoe um live chat ativo agora.");
    }

    return {
      channelKey: channelContext?.channelKey || target.handle || target.channelId || item.snippet?.channelId || item.id,
      channelDisplayName: item.snippet?.channelTitle || channelContext?.channelDisplayName || target.handle || "YouTube",
      channelId: item.snippet?.channelId || channelContext?.channelId || target.channelId || "",
      streamId: item.id,
      liveChatId,
      title: item.snippet?.title || "",
      startedAt: item.liveStreamingDetails?.actualStartTime || nowIso()
    };
  }

  async fetchNextLiveChatPage() {
    return this.youtubeGet("liveChat/messages", {
      part: "id,snippet,authorDetails",
      liveChatId: this.liveChatId,
      pageToken: this.nextPageToken,
      maxResults: 200,
      hl: "pt-BR",
      profileImageSize: 88
    });
  }

  applyLiveChatPayload(payload) {
    for (const item of payload.items || []) {
      this.emitChatEvent(item);
    }

    if (hasValue(payload.nextPageToken)) {
      this.nextPageToken = payload.nextPageToken;
    }

    const nextInterval = Number(payload.pollingIntervalMillis);
    if (Number.isFinite(nextInterval) && nextInterval >= 1000) {
      this.pollingIntervalMs = nextInterval;
    }

    if (hasValue(payload.offlineAt)) {
      this.emitSystemEvent({
        kind: "stream_ended",
        level: "warning",
        title: "live finalizada",
        message: `${this.channelDisplayName} saiu do ar no YouTube.`,
        metadata: {
          offline_at: payload.offlineAt
        }
      });
      this.emitSystemEvent({
        kind: "source_disconnected",
        level: "warning",
        title: "youtube desconectado",
        message: "A live publica terminou e o adapter foi encerrado."
      });
      this.running = false;
    }
  }

  async pollLoop() {
    while (this.running) {
      await wait(this.pollingIntervalMs);
      if (!this.running) {
        break;
      }

      try {
        const payload = await this.fetchNextLiveChatPage();
        this.applyLiveChatPayload(payload);
      } catch (error) {
        if (!this.running) {
          break;
        }

        if (error.reason === "rateLimitExceeded") {
          this.onLog("warning", "youtube_rate_limit", error.message, {
            channel: this.channelKey,
            stream_id: this.streamId,
            retry_in_ms: this.pollingIntervalMs
          });
          continue;
        }

        if (error.reason === "liveChatEnded" || error.reason === "liveChatDisabled") {
          this.emitSystemEvent({
            kind: "stream_ended",
            level: "warning",
            title: "live finalizada",
            message: error.reason === "liveChatDisabled"
              ? "A live publica encontrada nao deixou o chat ativo."
              : "O chat ao vivo do YouTube foi encerrado."
          });
          this.emitSystemEvent({
            kind: "source_disconnected",
            level: "warning",
            title: "youtube desconectado",
            message: "O adapter do YouTube foi encerrado apos o fim do chat."
          });
          this.running = false;
          break;
        }

        this.onLog("error", "youtube_poll_failed", error.message, {
          channel: this.channelKey,
          stream_id: this.streamId
        });
        this.emitSystemEvent({
          kind: "source_error",
          level: "error",
          title: "youtube falhou",
          message: error.message
        });
        this.running = false;
        break;
      }
    }
  }

  async start() {
    if (this.running) {
      return;
    }

    if (!hasValue(this.config.api_key) && !hasValue(this.config.access_token)) {
      throw new Error("Salve `api_key` ou `access_token` do YouTube para habilitar a leitura real desta passada.");
    }

    const session = await this.resolveLiveSession();
    this.channelKey = session.channelKey;
    this.channelDisplayName = session.channelDisplayName;
    this.streamId = session.streamId;
    this.liveChatId = session.liveChatId;
    this.currentTitle = session.title;

    this.emitSystemEvent({
      kind: "source_connecting",
      title: "youtube conectando",
      message: `Preparando leitura publica para ${this.channelDisplayName}.`
    });

    const initialPayload = await this.fetchNextLiveChatPage();
    this.running = true;

    this.emitSystemEvent({
      kind: "source_connected",
      title: "youtube conectado",
      message: `Sessao ${this.channelDisplayName} pronta.`
    });

    this.emitSystemEvent({
      kind: "stream_started",
      title: "live detectada",
      message: `${this.channelDisplayName} entrou ao vivo`,
      metadata: {
        title: this.currentTitle,
        started_at: session.startedAt
      }
    });

    if (hasValue(this.currentTitle)) {
      this.emitSystemEvent({
        kind: "livestream_metadata_updated",
        title: "metadata sincronizada",
        message: `${this.channelDisplayName} publicou titulo`,
        metadata: {
          title: this.currentTitle
        }
      });
    }

    this.onLog("info", "youtube_connected", "Sessao conectada", {
      channel: this.channelKey,
      stream_id: this.streamId,
      title: this.currentTitle
    });

    this.applyLiveChatPayload(initialPayload);
    if (this.running) {
      this.pollLoopPromise = this.pollLoop();
    }
  }

  async stop() {
    this.running = false;
    await Promise.resolve(this.pollLoopPromise).catch(() => {});
    this.pollLoopPromise = null;
  }
}
