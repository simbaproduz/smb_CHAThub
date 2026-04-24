//        __     __                   
// _|_   (_ ||\/|__) /\ _ _ _ _|   _  
//  |    __)||  |__)/--|_| (_(_||_|/_ 
//                     |  

import { randomUUID } from "node:crypto";
import { buildConnectionId, getPlatformDef } from "../core/platforms.mjs";

const PLATFORM = getPlatformDef("youtube");
const DEFAULT_CLIENT_VERSION = "2.20260421.00.00";
const DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
const DEFAULT_HEADERS = {
  "User-Agent": DEFAULT_USER_AGENT,
  "Accept-Language": "en-US,en;q=0.9,pt-BR;q=0.8",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
};
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_CHANNEL_ID_PATTERN = /^UC[\w-]{10,}$/i;
const YOUTUBE_HANDLE_PATTERN = /^@[\w.-]+$/i;
const MAX_SEEN_MESSAGE_IDS = 5000;
const MAX_TRANSIENT_RETRIES = 5;
const TRANSIENT_RETRY_BASE_MS = 2000;
const TRANSIENT_RETRY_MAX_MS = 30000;
const DEFAULT_POLL_INTERVAL_MS = 4000;
const MIN_POLL_INTERVAL_MS = 1000;
const MAX_POLL_INTERVAL_MS = 15000;
const INITIAL_BACKLOG_MAX_MESSAGES = 20;
const INITIAL_BACKLOG_MAX_AGE_MS = 120000;

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

function normalizePollInterval(value, fallback = DEFAULT_POLL_INTERVAL_MS) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(MAX_POLL_INTERVAL_MS, Math.max(MIN_POLL_INTERVAL_MS, parsed));
}

function normalizeHandle(value) {
  const trimmed = normalizeValue(value);
  if (!trimmed) return "";
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

function normalizeJsonText(value) {
  return normalizeValue(value)
    .replaceAll("\\u0026", "&")
    .replaceAll("\\u003d", "=")
    .replaceAll("\\/", "/");
}

function matchFirst(value, patterns) {
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (match?.[1]) {
      return normalizeJsonText(match[1]);
    }
  }

  return "";
}

function createCompatError(code, message, options = {}) {
  const error = new Error(message);
  error.code = code;
  error.title = options.title || "youtube falhou";
  error.level = options.level || "error";
  error.recoverable = options.recoverable ?? false;
  error.metadata = {
    reason: code,
    ingestion_method: "compatibility",
    ...(options.metadata || {})
  };
  return error;
}

function normalizeCompatError(error) {
  if (error?.code) {
    return error;
  }

  const message = error?.message || "Falha inesperada no modo de compatibilidade do YouTube.";
  return createCompatError("compatibility_failed", message, {
    title: "youtube falhou",
    recoverable: true
  });
}

function isTransientCompatError(error) {
  return [
    "network_error",
    "rate_limited",
    "temporarily_unavailable",
    "compatibility_failed"
  ].includes(error.code);
}

function buildPublicWatchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

function buildLiveChatWatchUrl(videoId) {
  return `https://www.youtube.com/live_chat?is_popout=1&v=${encodeURIComponent(videoId)}`;
}

function parseYouTubeInput(rawValue) {
  const value = normalizeValue(rawValue);
  if (!value) {
    return null;
  }

  if (YOUTUBE_VIDEO_ID_PATTERN.test(value)) {
    return { type: "video", videoId: value, label: value };
  }

  if (YOUTUBE_CHANNEL_ID_PATTERN.test(value)) {
    return { type: "channel_id", channelId: value, label: value };
  }

  if (YOUTUBE_HANDLE_PATTERN.test(value)) {
    return { type: "handle", handle: normalizeHandle(value), label: normalizeHandle(value) };
  }

  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    if (!host.includes("youtube.com") && host !== "youtu.be") {
      return { type: "unknown", label: value };
    }

    const segments = url.pathname.split("/").filter(Boolean);
    if (host === "youtu.be") {
      return {
        type: "video",
        videoId: normalizeValue(segments[0]),
        label: value
      };
    }

    if ((segments[0] === "watch" || segments[0] === "live_chat") && hasValue(url.searchParams.get("v"))) {
      return {
        type: "video",
        videoId: normalizeValue(url.searchParams.get("v")),
        label: value
      };
    }

    if (segments[0] === "live" && segments[1]) {
      return {
        type: "video",
        videoId: normalizeValue(segments[1]),
        label: value
      };
    }

    if (segments[0]?.startsWith("@")) {
      return {
        type: "handle",
        handle: normalizeHandle(segments[0]),
        label: normalizeHandle(segments[0])
      };
    }

    if (segments[0] === "channel" && segments[1]) {
      return {
        type: "channel_id",
        channelId: normalizeValue(segments[1]),
        label: normalizeValue(segments[1])
      };
    }

    if ((segments[0] === "c" || segments[0] === "user") && segments[1]) {
      return {
        type: "path",
        path: `${segments[0]}/${segments[1]}`,
        label: value
      };
    }

    if (segments[0]) {
      return {
        type: "path",
        path: segments[0],
        label: value
      };
    }
  } catch {
    return {
      type: "path",
      path: value,
      label: value
    };
  }

  return { type: "unknown", label: value };
}

function buildCandidateUrls(target) {
  if (!target) {
    return [];
  }

  if (target.type === "video" && hasValue(target.videoId)) {
    return [buildPublicWatchUrl(target.videoId)];
  }

  if (target.type === "handle" && hasValue(target.handle)) {
    return [
      `https://www.youtube.com/${target.handle}/live`,
      `https://www.youtube.com/${target.handle}`
    ];
  }

  if (target.type === "channel_id" && hasValue(target.channelId)) {
    return [
      `https://www.youtube.com/channel/${target.channelId}/live`,
      `https://www.youtube.com/channel/${target.channelId}`
    ];
  }

  if (target.type === "path" && hasValue(target.path)) {
    const normalizedPath = target.path.replace(/^\/+/, "").replace(/\/+$/, "");
    return [
      `https://www.youtube.com/${normalizedPath}/live`,
      `https://www.youtube.com/${normalizedPath}`
    ];
  }

  return [];
}

function detectRestrictionError(html) {
  const playabilityReason = matchFirst(html, [
    /"playabilityStatus":\{"status":"LOGIN_REQUIRED"[\s\S]{0,1600}?"reason":"([^"]+)"/,
    /"playabilityStatus":\{"status":"UNPLAYABLE"[\s\S]{0,1600}?"reason":"([^"]+)"/,
    /"playabilityStatus":\{"status":"ERROR"[\s\S]{0,1600}?"reason":"([^"]+)"/,
    /"playabilityStatus":\{"status":"LOGIN_REQUIRED"[\s\S]{0,1600}?"simpleText":"([^"]+)"/,
    /"playabilityStatus":\{"status":"UNPLAYABLE"[\s\S]{0,1600}?"simpleText":"([^"]+)"/,
    /"playabilityStatus":\{"status":"ERROR"[\s\S]{0,1600}?"simpleText":"([^"]+)"/
  ]).toLowerCase();

  if (playabilityReason.includes("private")) {
    return createCompatError("private_live", "A live do YouTube existe, mas esta privada.", {
      title: "youtube privado"
    });
  }

  if (
    playabilityReason.includes("members")
    || /available to this channel's members/i.test(html)
  ) {
    return createCompatError("members_only", "A live do YouTube esta em members-only e o chat nao pode ser lido em compatibilidade.", {
      title: "youtube members-only"
    });
  }

  if (
    playabilityReason.includes("confirm your age")
    || /Sign in to confirm your age/i.test(html)
    || /age-restricted/i.test(playabilityReason)
  ) {
    return createCompatError("age_restricted", "A live do YouTube exige confirmacao de idade ou login e nao pode ser lida em compatibilidade.", {
      title: "youtube com restricao de idade"
    });
  }

  return null;
}

function detectIsLive(html) {
  return [
    /"isLiveContent":true/,
    /"isLiveNow":true/,
    /"liveBroadcastDetails":\{[^}]*"isLiveNow":true/,
    /"setLiveChatCollapsedStateAction"/,
    /"liveChatRenderer"/
  ].some((pattern) => pattern.test(html));
}

function extractVideoId(html, finalUrl) {
  try {
    const url = new URL(finalUrl);
    const watchId = normalizeValue(url.searchParams.get("v"));
    if (YOUTUBE_VIDEO_ID_PATTERN.test(watchId)) {
      return watchId;
    }

    const segments = url.pathname.split("/").filter(Boolean);
    if (segments[0] === "live" && YOUTUBE_VIDEO_ID_PATTERN.test(segments[1] || "")) {
      return segments[1];
    }
  } catch {
    // ignore
  }

  return matchFirst(html, [
    /"videoId":"([A-Za-z0-9_-]{11})"/,
    /"externalVideoId":"([A-Za-z0-9_-]{11})"/
  ]);
}

function extractChannelId(html) {
  return matchFirst(html, [
    /"externalChannelId":"(UC[\w-]+)"/,
    /"ownerProfileUrl":"https?:\/\/www\.youtube\.com\/channel\/(UC[\w-]+)"/,
    /"channelId":"(UC[\w-]+)"/
  ]);
}

function extractChannelDisplayName(html, fallbackLabel) {
  return matchFirst(html, [
    /"ownerChannelName":"([^"]+)"/,
    /"author":"([^"]+)"/,
    /"channelName":"([^"]+)"/,
    /<meta itemprop="name" content="([^"]+)"/i,
    /<meta property="og:site_name" content="([^"]+)"/i
  ]) || fallbackLabel || "YouTube";
}

function extractTitle(html) {
  return matchFirst(html, [
    /<meta property="og:title" content="([^"]+)"/i,
    /"title":"([^"]+)"/
  ]);
}

function extractStartedAt(html) {
  return matchFirst(html, [
    /"startTimestamp":"([^"]+)"/,
    /"uploadDate":"([^"]+)"/
  ]);
}

function extractLiveChatContinuation(html) {
  return matchFirst(html, [
    /"liveChatRenderer"[\s\S]{0,12000}?"continuation":"([^"]{20,})"/,
    /"invalidationContinuationData":\{[^}]*"continuation":"([^"]{20,})"/,
    /"timedContinuationData":\{[^}]*"continuation":"([^"]{20,})"/,
    /"reloadContinuationData":\{[^}]*"continuation":"([^"]{20,})"/,
    /"continuation":"([^"]{20,})"/
  ]);
}

function extractApiKey(html) {
  return matchFirst(html, [
    /"INNERTUBE_API_KEY":"([^"]+)"/,
    /"innertubeApiKey":"([^"]+)"/
  ]);
}

function extractClientVersion(html) {
  return matchFirst(html, [
    /"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/,
    /"clientVersion":"([^"]+)"/
  ]);
}

function extractVisitorData(html) {
  return matchFirst(html, [
    /"VISITOR_DATA":"([^"]+)"/,
    /"visitorData":"([^"]+)"/
  ]);
}

function normalizeImageUrl(value = "") {
  const rawUrl = normalizeJsonText(value);
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

function getLargestThumbnail(thumbnails = []) {
  if (!Array.isArray(thumbnails) || thumbnails.length === 0) {
    return null;
  }

  return [...thumbnails]
    .filter((thumbnail) => normalizeImageUrl(thumbnail?.url))
    .sort((a, b) => Number(b.width || 0) - Number(a.width || 0))
    .at(0) || null;
}

function getEmojiImage(emoji = {}) {
  const thumbnail = getLargestThumbnail(emoji.image?.thumbnails || emoji.thumbnails || []);
  if (!thumbnail) {
    return {};
  }

  return {
    src: normalizeImageUrl(thumbnail.url),
    width: Number(thumbnail.width || 0) || undefined,
    height: Number(thumbnail.height || 0) || undefined
  };
}

function coalesceTextParts(parts = []) {
  const output = [];
  for (const part of parts) {
    if (!part?.value) {
      continue;
    }
    const previous = output.at(-1);
    if (part.type === "text" && previous?.type === "text") {
      previous.value += part.value;
    } else {
      output.push(part);
    }
  }
  return output;
}

function buildTextFromParts(parts = []) {
  return parts.map((part) => part.value || part.alt || "").join("");
}

function parseRunsParts(runs = []) {
  return coalesceTextParts(runs.map((run) => {
    if (hasValue(run.text)) {
      return { type: "text", value: normalizeJsonText(run.text) };
    }

    if (run.emoji) {
      const value = normalizeJsonText(
        run.emoji.shortcuts?.[0]
        || run.emoji.searchTerms?.[0]
        || run.emoji.emojiId
        || "emote"
      );
      const image = getEmojiImage(run.emoji);
      return {
        type: "emote",
        value,
        alt: value,
        id: normalizeJsonText(run.emoji.emojiId || ""),
        provider: "youtube",
        ...image
      };
    }

    return { type: "text", value: "" };
  }));
}

function extractRendererMessageParts(renderer) {
  if (hasValue(renderer?.message?.simpleText)) {
    return [{ type: "text", value: normalizeJsonText(renderer.message.simpleText) }];
  }

  let parts = parseRunsParts(renderer?.message?.runs || []);
  if (parts.length > 0) {
    return parts;
  }

  if (hasValue(renderer?.headerSubtext?.simpleText)) {
    return [{ type: "text", value: normalizeJsonText(renderer.headerSubtext.simpleText) }];
  }

  parts = parseRunsParts(renderer?.headerSubtext?.runs || []);
  if (parts.length > 0) {
    return parts;
  }

  const stickerImage = getEmojiImage(renderer?.sticker || {});
  if (stickerImage.src) {
    const value = normalizeValue(
      renderer?.sticker?.accessibility?.accessibilityData?.label
      || renderer?.sticker?.label
      || "Sticker"
    );
    return [{
      type: "emote",
      value,
      alt: value,
      provider: "youtube",
      ...stickerImage
    }];
  }

  if (hasValue(renderer?.purchaseAmountText?.simpleText)) {
    return [{ type: "text", value: normalizeJsonText(renderer.purchaseAmountText.simpleText) }];
  }

  return [];
}

function extractAuthorRoles(renderer) {
  const roles = new Set();

  for (const badge of renderer?.authorBadges || []) {
    const rendererPayload = badge.liveChatAuthorBadgeRenderer || badge.metadataBadgeRenderer || {};
    const label = normalizeValue(
      rendererPayload.tooltip
      || rendererPayload.accessibility?.accessibilityData?.label
      || rendererPayload.icon?.iconType
      || rendererPayload.label
    ).toLowerCase();

    if (label.includes("owner") || label.includes("host") || label.includes("streamer")) {
      roles.add("streamer");
    }
    if (label.includes("moderator") || label.includes("mod")) {
      roles.add("mod");
    }
    if (label.includes("member") || label.includes("sponsor")) {
      roles.add("member");
    }
  }

  if (roles.size === 0) {
    roles.add("viewer");
  }

  return [...roles];
}

function convertTimestampUsecToIso(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return nowIso();
  }

  return new Date(Math.floor(numeric / 1000)).toISOString();
}

function messageTimeToMs(message) {
  const parsed = Date.parse(message?.time || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function selectInitialMessagesToEmit(messages = []) {
  if (!messages.length) {
    return new Set();
  }

  const latestTimestampMs = Math.max(...messages.map((message) => messageTimeToMs(message)));
  const minimumTimestampMs = latestTimestampMs > 0
    ? latestTimestampMs - INITIAL_BACKLOG_MAX_AGE_MS
    : 0;

  let selectedMessages = messages.filter((message) => {
    const timestampMs = messageTimeToMs(message);
    return timestampMs > 0 && timestampMs >= minimumTimestampMs;
  });

  if (!selectedMessages.length) {
    selectedMessages = [...messages];
  }

  if (selectedMessages.length > INITIAL_BACKLOG_MAX_MESSAGES) {
    selectedMessages = selectedMessages.slice(-INITIAL_BACKLOG_MAX_MESSAGES);
  }

  return new Set(selectedMessages.map((message) => message.id));
}

function mapRendererKind(rendererType) {
  if (rendererType === "liveChatPaidMessageRenderer" || rendererType === "liveChatPaidStickerRenderer") {
    return "highlight";
  }

  if (rendererType === "liveChatMembershipItemRenderer") {
    return "membership";
  }

  return "message";
}

function extractLiveChatMessages(payload) {
  const containers = [
    payload?.continuationContents?.liveChatContinuation?.actions,
    payload?.contents?.liveChatContinuation?.actions,
    payload?.liveChatContinuation?.actions
  ].filter(Array.isArray);

  const messages = [];

  for (const container of containers) {
    for (const action of container) {
      const item = action?.addChatItemAction?.item;
      if (!item) continue;

      const rendererType = item?.liveChatTextMessageRenderer
        ? "liveChatTextMessageRenderer"
        : item?.liveChatPaidMessageRenderer
          ? "liveChatPaidMessageRenderer"
          : item?.liveChatMembershipItemRenderer
            ? "liveChatMembershipItemRenderer"
            : item?.liveChatPaidStickerRenderer
              ? "liveChatPaidStickerRenderer"
              : "";

      if (!rendererType) continue;

      const renderer = item[rendererType];
      const parts = extractRendererMessageParts(renderer);
      const text = normalizeValue(buildTextFromParts(parts));
      if (!hasValue(text)) continue;

      messages.push({
        id: renderer.id || `${renderer.authorExternalChannelId || "user"}:${renderer.timestampUsec || Date.now()}:${text}`,
        time: convertTimestampUsecToIso(renderer.timestampUsec),
        author: {
          id: renderer.authorExternalChannelId || "",
          name: normalizeValue(renderer.authorName?.simpleText || "YouTube user"),
          roles: extractAuthorRoles(renderer)
        },
        kind: mapRendererKind(rendererType),
        text,
        parts
      });
    }
  }

  return messages;
}

function extractNextContinuation(payload) {
  const continuations = [
    ...(payload?.continuationContents?.liveChatContinuation?.continuations || []),
    ...(payload?.contents?.liveChatContinuation?.continuations || []),
    ...(payload?.liveChatContinuation?.continuations || [])
  ];

  for (const continuation of continuations) {
    const data = continuation.invalidationContinuationData
      || continuation.timedContinuationData
      || continuation.reloadContinuationData;

    if (hasValue(data?.continuation)) {
      return {
        continuation: data.continuation,
        timeoutMs: Number(data.timeoutMs || 0)
      };
    }
  }

  return { continuation: "", timeoutMs: 0 };
}

function buildInitialSession(target, page, attemptedUrl) {
  const restrictionError = detectRestrictionError(page.html);
  if (restrictionError) {
    throw restrictionError;
  }

  const videoId = extractVideoId(page.html, page.finalUrl);
  const isLive = detectIsLive(page.html);
  const liveChatContinuation = extractLiveChatContinuation(page.html);
  const channelId = extractChannelId(page.html);
  const channelDisplayName = extractChannelDisplayName(page.html, target.label);
  const title = extractTitle(page.html);
  const startedAt = extractStartedAt(page.html);

  if (hasValue(videoId) && hasValue(liveChatContinuation)) {
    return {
      watchUrl: buildPublicWatchUrl(videoId),
      liveChatUrl: buildLiveChatWatchUrl(videoId),
      videoId,
      channelId,
      channelDisplayName,
      channelKey: normalizeValue(target.handle || channelId || channelDisplayName || target.label || videoId),
      title,
      startedAt,
      continuation: liveChatContinuation,
      apiKey: extractApiKey(page.html),
      clientVersion: extractClientVersion(page.html),
      visitorData: extractVisitorData(page.html)
    };
  }

  if (isLive) {
    throw createCompatError("live_without_chat", "A live publica foi encontrada, mas o chat ao vivo nao esta disponivel agora.", {
      title: "youtube sem chat",
      metadata: {
        attempted_url: attemptedUrl,
        final_url: page.finalUrl,
        video_id: videoId || ""
      }
    });
  }

  throw createCompatError("offline", "Nenhuma live publica ativa foi encontrada para esse alvo do YouTube.", {
    title: "youtube offline",
    metadata: {
      attempted_url: attemptedUrl,
      final_url: page.finalUrl
    }
  });
}

export function canStartYouTubeCompatibility(config = {}) {
  return Boolean(
    config?.enabled
    && (
      hasValue(config.quick_input)
      || hasValue(config.channel)
      || hasValue(config.channel_id)
    )
  );
}

export class YouTubeCompatAdapter {
  constructor({
    config,
    onEvent,
    onLog = () => {}
  }) {
    this.config = {
      enabled: Boolean(config?.enabled),
      quick_input: normalizeValue(config?.quick_input),
      channel: normalizeValue(config?.channel),
      channel_id: normalizeValue(config?.channel_id)
    };
    this.onEvent = onEvent;
    this.onLog = onLog;
    this.running = false;
    this.pollLoopPromise = null;
    this.streamId = "";
    this.channelKey = "";
    this.channelDisplayName = "";
    this.currentTitle = "";
    this.currentContinuation = "";
    this.currentWatchUrl = "";
    this.currentLiveChatUrl = "";
    this.apiKey = "";
    this.clientVersion = DEFAULT_CLIENT_VERSION;
    this.visitorData = "";
    this.pollingIntervalMs = DEFAULT_POLL_INTERVAL_MS;
    this.seenMessageIds = new Set();
    this.seenMessageQueue = [];
    this.isRecovering = false;
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
      channel: this.channelKey || normalizeValue(this.config.channel || this.config.channel_id || "youtube"),
      connection_id: this.buildConnectionId(),
      stream_id: this.streamId || "live",
      kind,
      level,
      time: nowIso(),
      title,
      message,
      recoverable: kind !== "stream_ended",
      accent_color: PLATFORM.accentColor,
      metadata: {
        ingestion_method: "compatibility",
        ...(metadata || {})
      }
    });
  }

  emitChatEvent(message) {
    this.onEvent({
      id: message.id,
      version: "chat-event.v0",
      source: "youtube",
      channel: this.channelKey,
      channel_display_name: this.channelDisplayName || this.channelKey,
      connection_id: this.buildConnectionId(),
      stream_id: this.streamId,
      kind: message.kind,
      time: message.time,
      author: message.author,
      text: message.text,
      parts: message.parts?.length ? message.parts : [{ type: "text", value: message.text }],
      accent_color: PLATFORM.accentColor,
      raw_ref: message.id
    });
  }

  rememberMessageId(id) {
    if (this.seenMessageIds.has(id)) {
      return false;
    }

    this.seenMessageIds.add(id);
    this.seenMessageQueue.push(id);
    while (this.seenMessageQueue.length > MAX_SEEN_MESSAGE_IDS) {
      const oldest = this.seenMessageQueue.shift();
      if (oldest) {
        this.seenMessageIds.delete(oldest);
      }
    }

    return true;
  }

  resolveConfiguredTarget() {
    const quickInput = parseYouTubeInput(this.config.quick_input);
    if (quickInput && quickInput.type !== "unknown") {
      return quickInput;
    }

    const channelId = parseYouTubeInput(this.config.channel_id);
    if (channelId && channelId.type !== "unknown") {
      return channelId;
    }

    const channel = parseYouTubeInput(this.config.channel);
    if (channel && channel.type !== "unknown") {
      return channel;
    }

    throw createCompatError("failed_to_resolve", "Informe uma live URL, channel URL, @handle ou channel ID valido para o YouTube.", {
      title: "youtube falhou ao resolver"
    });
  }

  async fetchPublicPage(url) {
    let response;
    try {
      response = await fetch(url, {
        headers: DEFAULT_HEADERS,
        redirect: "follow"
      });
    } catch (error) {
      throw createCompatError("network_error", `Nao consegui abrir ${url}. ${error.message}`, {
        title: "youtube sem resposta",
        recoverable: true,
        metadata: { attempted_url: url }
      });
    }

    const html = await response.text();
    if (!response.ok) {
      throw createCompatError("failed_to_resolve", `O YouTube respondeu ${response.status} ao tentar abrir ${url}.`, {
        title: "youtube falhou ao resolver",
        metadata: {
          attempted_url: url,
          final_url: response.url || url,
          status: response.status
        }
      });
    }

    return {
      html,
      finalUrl: response.url || url
    };
  }

  async resolveLiveSession(target = this.resolveConfiguredTarget()) {
    const candidateUrls = buildCandidateUrls(target);
    if (candidateUrls.length === 0) {
      throw createCompatError("failed_to_resolve", "Nao encontrei nenhuma URL publica para esse alvo do YouTube.", {
        title: "youtube falhou ao resolver"
      });
    }

    let lastError = null;

    for (const candidateUrl of candidateUrls) {
      try {
        const page = await this.fetchPublicPage(candidateUrl);
        return buildInitialSession(target, page, candidateUrl);
      } catch (error) {
        const compatError = normalizeCompatError(error);
        if (compatError.code !== "offline" && compatError.code !== "failed_to_resolve") {
          throw compatError;
        }
        lastError = compatError;
      }
    }

    throw lastError || createCompatError("failed_to_resolve", "Nao consegui resolver esse alvo publico do YouTube.", {
      title: "youtube falhou ao resolver"
    });
  }

  async bootstrapChatPage() {
    const candidates = [
      this.currentLiveChatUrl,
      hasValue(this.currentContinuation)
        ? `https://www.youtube.com/live_chat?continuation=${encodeURIComponent(this.currentContinuation)}`
        : ""
    ].filter(Boolean);

    for (const url of candidates) {
      try {
        const page = await this.fetchPublicPage(url);
        const restrictionError = detectRestrictionError(page.html);
        if (restrictionError) {
          throw restrictionError;
        }

        const nextContinuation = extractLiveChatContinuation(page.html);
        if (!hasValue(this.currentContinuation) && hasValue(nextContinuation)) {
          this.currentContinuation = nextContinuation;
        }

        const apiKey = extractApiKey(page.html);
        if (hasValue(apiKey)) {
          this.apiKey = apiKey;
        }

        const clientVersion = extractClientVersion(page.html);
        if (hasValue(clientVersion)) {
          this.clientVersion = clientVersion;
        }

        const visitorData = extractVisitorData(page.html);
        if (hasValue(visitorData)) {
          this.visitorData = visitorData;
        }

        if (hasValue(this.currentContinuation)) {
          return;
        }
      } catch (error) {
        const compatError = normalizeCompatError(error);
        if (!["failed_to_resolve", "network_error", "compatibility_failed"].includes(compatError.code)) {
          throw compatError;
        }
      }
    }

    if (!hasValue(this.currentContinuation)) {
      throw createCompatError("live_without_chat", "A live do YouTube foi encontrada, mas o bootstrap do chat nao devolveu uma continuacao valida.", {
        title: "youtube sem chat"
      });
    }
  }

  async fetchLiveChatPayload() {
    if (!hasValue(this.currentContinuation)) {
      throw createCompatError("live_without_chat", "A live do YouTube ficou sem token valido de live chat.", {
        title: "youtube sem chat"
      });
    }

    const url = new URL("https://www.youtube.com/youtubei/v1/live_chat/get_live_chat");
    if (hasValue(this.apiKey)) {
      url.searchParams.set("key", this.apiKey);
    }
    url.searchParams.set("prettyPrint", "false");

    const payload = {
      context: {
        client: {
          clientName: "WEB",
          clientVersion: this.clientVersion || DEFAULT_CLIENT_VERSION,
          hl: "en",
          gl: "US",
          visitorData: this.visitorData || undefined,
          userAgent: DEFAULT_USER_AGENT,
          originalUrl: this.currentLiveChatUrl || buildLiveChatWatchUrl(this.streamId),
          platform: "DESKTOP",
          browserName: "Chrome",
          browserVersion: "135.0.0.0",
          osName: "Windows",
          osVersion: "10.0"
        }
      },
      continuation: this.currentContinuation
    };

    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "User-Agent": DEFAULT_USER_AGENT,
          "Content-Type": "application/json",
          "Accept-Language": "en-US,en;q=0.9,pt-BR;q=0.8"
        },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      throw createCompatError("network_error", `Falha de rede ao consultar o chat do YouTube. ${error.message}`, {
        title: "youtube sem resposta",
        recoverable: true
      });
    }

    const rawPayload = await response.text();
    let parsedPayload = {};
    try {
      parsedPayload = rawPayload ? JSON.parse(rawPayload) : {};
    } catch {
      throw createCompatError("compatibility_failed", "O YouTube devolveu uma resposta de chat invalida para o modo de compatibilidade.", {
        title: "youtube falhou",
        recoverable: true
      });
    }

    if (!response.ok) {
      const reason = normalizeValue(parsedPayload?.error?.errors?.[0]?.reason);
      const message = normalizeValue(parsedPayload?.error?.message) || `Falha HTTP ${response.status} no chat do YouTube.`;

      if (reason === "liveChatDisabled") {
        throw createCompatError("live_without_chat", "A live publica foi encontrada, mas o chat ao vivo esta desativado.", {
          title: "youtube sem chat"
        });
      }

      if (reason === "liveChatEnded") {
        throw createCompatError("stream_ended", "O chat ao vivo do YouTube foi encerrado.", {
          title: "youtube finalizou"
        });
      }

      if (response.status === 429 || reason === "rateLimitExceeded") {
        throw createCompatError("rate_limited", message, {
          title: "youtube limitou o polling",
          recoverable: true
        });
      }

      if (response.status >= 500) {
        throw createCompatError("temporarily_unavailable", message, {
          title: "youtube indisponivel",
          recoverable: true
        });
      }

      throw createCompatError("compatibility_failed", message, {
        title: "youtube falhou",
        recoverable: true,
        metadata: {
          status: response.status,
          raw_reason: reason
        }
      });
    }

    return parsedPayload;
  }

  applyLiveChatPayload(payload, options = {}) {
    const messages = extractLiveChatMessages(payload);
    const emitMessageIds = options.initial ? selectInitialMessagesToEmit(messages) : null;

    for (const message of messages) {
      if (!this.rememberMessageId(message.id)) {
        continue;
      }
      if (emitMessageIds && !emitMessageIds.has(message.id)) {
        continue;
      }
      this.emitChatEvent(message);
    }

    const continuation = extractNextContinuation(payload);
    if (hasValue(continuation.continuation)) {
      this.currentContinuation = continuation.continuation;
    }

    if (Number.isFinite(continuation.timeoutMs) && continuation.timeoutMs >= MIN_POLL_INTERVAL_MS) {
      this.pollingIntervalMs = normalizePollInterval(continuation.timeoutMs, this.pollingIntervalMs);
    }

    if (!hasValue(this.currentContinuation)) {
      throw createCompatError("live_without_chat", "O YouTube parou de devolver uma continuacao valida para o chat ao vivo.", {
        title: "youtube sem chat"
      });
    }
  }

  async pollLoop() {
    let retryCount = 0;

    while (this.running) {
      await wait(this.pollingIntervalMs);
      if (!this.running) {
        break;
      }

      try {
        const payload = await this.fetchLiveChatPayload();
        const recoveredAfterRetries = retryCount;
        const wasRecovering = this.isRecovering;
        retryCount = 0;
        this.applyLiveChatPayload(payload);

        if (wasRecovering) {
          this.isRecovering = false;
          this.emitSystemEvent({
            kind: "source_connected",
            title: "youtube recuperado",
            message: `A leitura do chat de ${this.channelDisplayName} foi retomada.`,
            metadata: {
              recovered_after_retries: recoveredAfterRetries,
              watch_url: this.currentWatchUrl
            }
          });
        }
      } catch (error) {
        const compatError = normalizeCompatError(error);

        if (compatError.code === "stream_ended") {
          this.isRecovering = false;
          this.emitSystemEvent({
            kind: "stream_ended",
            level: "warning",
            title: "live finalizada",
            message: compatError.message,
            metadata: compatError.metadata
          });
          this.emitSystemEvent({
            kind: "source_disconnected",
            level: "warning",
            title: "youtube desconectado",
            message: "O adapter de compatibilidade foi encerrado porque a live terminou.",
            metadata: compatError.metadata
          });
          this.running = false;
          break;
        }

        if (compatError.code === "live_without_chat") {
          this.isRecovering = false;
          this.emitSystemEvent({
            kind: "source_error",
            level: "warning",
            title: "youtube sem chat",
            message: compatError.message,
            metadata: compatError.metadata
          });
          this.running = false;
          break;
        }

        if (!isTransientCompatError(compatError)) {
          this.isRecovering = false;
          this.emitSystemEvent({
            kind: "source_error",
            level: compatError.level || "error",
            title: compatError.title,
            message: compatError.message,
            metadata: compatError.metadata
          });
          this.running = false;
          break;
        }

        retryCount += 1;
        const retryDelay = Math.min(TRANSIENT_RETRY_BASE_MS * (2 ** (retryCount - 1)), TRANSIENT_RETRY_MAX_MS);

        if (!this.isRecovering) {
          this.isRecovering = true;
          this.emitSystemEvent({
            kind: "source_connecting",
            level: "warning",
            title: "youtube reconectando",
            message: `Falha temporaria ao ler o chat. Nova tentativa em ${Math.ceil(retryDelay / 1000)}s.`,
            metadata: {
              retry_count: retryCount,
              retry_delay_ms: retryDelay,
              reason: compatError.code,
              watch_url: this.currentWatchUrl
            }
          });
        }

        this.onLog("warning", "youtube_compat_retry", compatError.message, {
          channel: this.channelKey,
          stream_id: this.streamId,
          retry_count: retryCount,
          retry_delay_ms: retryDelay
        });

        if (retryCount > MAX_TRANSIENT_RETRIES) {
          this.emitSystemEvent({
            kind: "source_error",
            level: compatError.level || "error",
            title: compatError.title,
            message: compatError.message,
            metadata: {
              ...compatError.metadata,
              retry_count: retryCount
            }
          });
          this.isRecovering = false;
          this.running = false;
          break;
        }

        await wait(retryDelay);
      }
    }
  }

  async start() {
    if (this.running) {
      return;
    }

    try {
      const target = this.resolveConfiguredTarget();
      this.channelKey = normalizeValue(target.handle || target.channelId || target.path || target.videoId || "youtube");
      this.channelDisplayName = normalizeValue(target.label || this.channelKey || "YouTube");

      const session = await this.resolveLiveSession(target);
      this.streamId = session.videoId;
      this.channelKey = session.channelKey;
      this.channelDisplayName = session.channelDisplayName;
      this.currentTitle = session.title;
      this.currentContinuation = session.continuation;
      this.currentWatchUrl = session.watchUrl;
      this.currentLiveChatUrl = session.liveChatUrl;
      this.apiKey = session.apiKey;
      this.clientVersion = session.clientVersion || DEFAULT_CLIENT_VERSION;
      this.visitorData = session.visitorData;
      this.pollingIntervalMs = DEFAULT_POLL_INTERVAL_MS;
      this.isRecovering = false;

      this.emitSystemEvent({
        kind: "source_connecting",
        title: "youtube conectando",
        message: "Tentando compatibilidade real para o alvo publico do YouTube.",
        metadata: {
          input: this.config.quick_input || this.config.channel_id || this.config.channel || "",
          watch_url: this.currentWatchUrl
        }
      });

      await this.bootstrapChatPage();
      const initialPayload = await this.fetchLiveChatPayload();

      this.running = true;

      this.emitSystemEvent({
        kind: "source_connected",
        title: "youtube conectado",
        message: `Compatibilidade ativa para ${this.channelDisplayName}.`,
        metadata: {
          watch_url: this.currentWatchUrl
        }
      });

      this.emitSystemEvent({
        kind: "stream_started",
        title: "live detectada",
        message: `${this.channelDisplayName} entrou ao vivo no YouTube.`,
        metadata: {
          title: this.currentTitle,
          started_at: session.startedAt || ""
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

      this.onLog("info", "youtube_compat_connected", "Compatibilidade conectada", {
        channel: this.channelKey,
        stream_id: this.streamId,
        title: this.currentTitle,
        watch_url: this.currentWatchUrl
      });

      this.applyLiveChatPayload(initialPayload, { initial: true });
      if (this.running) {
        this.pollLoopPromise = this.pollLoop();
      }
    } catch (error) {
      this.isRecovering = false;
      const compatError = normalizeCompatError(error);
      this.emitSystemEvent({
        kind: "source_error",
        level: compatError.level || "error",
        title: compatError.title,
        message: compatError.message,
        metadata: compatError.metadata
      });
      this.onLog("warning", "youtube_compat_start_failed", compatError.message, {
        reason: compatError.code,
        input: this.config.quick_input || this.config.channel_id || this.config.channel || ""
      });
      throw compatError;
    }
  }

  async stop() {
    this.running = false;
    this.isRecovering = false;
    await Promise.resolve(this.pollLoopPromise).catch(() => {});
    this.pollLoopPromise = null;
  }
}
