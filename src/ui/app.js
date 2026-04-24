//        __     __                   
// _|_   (_ ||\/|__) /\ _ _ _ _|   _  
//  |    __)||  |__)/--|_| (_(_||_|/_ 
//                     |  

import {
  PUBLIC_PROVIDER_KEYS,
  createEventStream,
  fetchJson,
  fetchSnapshot,
  formatTimestamp,
  isConfirmedActiveConnection,
  isPendingLiveConnection,
  isPublicProviderKey,
  renderRuntimeCard,
  saveProviderConfig
} from "./shared.js";
import {
  installMessagePartImageFallback,
  renderMessageParts
} from "./message-parts.js";
import {
  applyTranslations,
  getCurrentLocale,
  initI18n,
  t
} from "./i18n.js";

const runtimeCard = document.querySelector("#runtimeCard");
const providerList = document.querySelector("#providerList");
const connectionList = document.querySelector("#connectionList");
const messageList = document.querySelector("#messageList");
const systemList = document.querySelector("#systemList");
const sourceAlert = document.querySelector("#sourceAlert");
const filterStatusCard = document.querySelector("#filterStatusCard");
const feedSubtitle = document.querySelector("#feedSubtitle");
const overlayToggleButton = document.querySelector("#overlayToggleButton");
const overlayStatusBadge = document.querySelector("#overlayStatusBadge");
const overlayAdvancedDetails = document.querySelector("#overlayAdvancedDetails");
const overlayAdvancedSummary = document.querySelector("#overlayAdvancedSummary");
const overlayDiagnosticPanel = document.querySelector("#overlayDiagnosticPanel");
const overlayDiagnosticList = document.querySelector("#overlayDiagnosticList");
const overlayCopyDiagnostic = document.querySelector("#overlayCopyDiagnostic");
const messageLimitSelect = document.querySelector("#messageLimitSelect");
const chatFollowButton = document.querySelector("#chatFollowButton");
const chatCacheClearButton = document.querySelector("#chatCacheClearButton");
const homeConnectForm = document.querySelector("#homeConnectForm");
const homeConnectInput = document.querySelector("#homeConnectInput");
const homeConnectStatus = document.querySelector("#homeConnectStatus");
const quickSummary = document.querySelector("#quickSummary");

let currentSnapshot = null;
let activeFilter = "all";
let lastFilterSync = "";
const PUBLIC_FILTER_KEYS = new Set(["all", ...PUBLIC_PROVIDER_KEYS]);
let overlayStatus = { status: "closed", pid: null, monitor: null, bounds: null, error: null, openedAt: null };
let messageLimit = Number(globalThis.localStorage?.getItem("livechat-message-limit")) || 60;
let chatAutoFollow = true;
let pendingChatUpdates = 0;
let latestRenderedMessageId = "";
let latestKnownMessageId = "";
let isApplyingChatScroll = false;

const PROVIDER_META = {
  twitch: { label: "Twitch" },
  youtube: { label: "YouTube" },
  kick: { label: "Kick" },
  tiktok: { label: "TikTok" }
};

function getProviderIconSrc(providerKey) {
  return `/icon/${providerKey}.ico`;
}

function renderProviderIcon(providerKey, label) {
  return `<img class="provider-icon" src="${getProviderIconSrc(providerKey)}" alt="" aria-hidden="true" loading="lazy"><span>${escapeHtml(label)}</span>`;
}

function getMessageIdentity(message) {
  return String(message?.id || `${message?.source || ""}:${message?.time || ""}:${message?.author?.name || ""}:${message?.text || ""}`);
}

function isMessageListAtLiveEdge() {
  return !messageList || messageList.scrollTop <= 24;
}

function updateChatFollowButton() {
  if (!chatFollowButton) {
    return;
  }

  messageList?.classList.toggle("is-reading-mode", !chatAutoFollow);
  chatFollowButton.hidden = chatAutoFollow;
  if (chatAutoFollow) {
    chatFollowButton.textContent = t("home.backLive");
    return;
  }

  chatFollowButton.textContent = pendingChatUpdates > 0
    ? t("home.newMessagesBackLive")
    : t("home.backLive");
}

function setChatScrollTop(value) {
  if (!messageList) {
    return;
  }

  isApplyingChatScroll = true;
  messageList.scrollTop = Math.max(0, value);
  requestAnimationFrame(() => {
    isApplyingChatScroll = false;
  });
}

function countNewMessages(messages, previousLatestId) {
  if (!previousLatestId || messages.length === 0) {
    return 0;
  }

  const previousIndex = messages.findIndex((message) => getMessageIdentity(message) === previousLatestId);
  if (previousIndex <= 0) {
    return previousIndex === -1 ? 1 : 0;
  }

  return previousIndex;
}

function resumeChatFollow(options = {}) {
  chatAutoFollow = true;
  pendingChatUpdates = 0;
  updateChatFollowButton();

  if (options.renderLatest && currentSnapshot) {
    renderMessages(currentSnapshot);
    return;
  }

  setChatScrollTop(0);
}

async function clearChatCache() {
  if (chatCacheClearButton?.disabled) {
    return;
  }

  const originalText = chatCacheClearButton?.textContent || t("home.clearCache");
  if (chatCacheClearButton) {
    chatCacheClearButton.disabled = true;
    chatCacheClearButton.textContent = t("home.cleaning");
  }

  try {
    chatAutoFollow = true;
    pendingChatUpdates = 0;
    latestRenderedMessageId = "";
    latestKnownMessageId = "";

    if (messageLimit > 60) {
      messageLimit = 60;
      globalThis.localStorage?.setItem("livechat-message-limit", "60");
      if (messageLimitSelect) {
        messageLimitSelect.value = "60";
      }
    }

    messageList.innerHTML = "";
    setChatScrollTop(0);
    updateChatFollowButton();

    const payload = await fetchJson("/api/cache/chat/clear", { method: "POST" });
    if (payload.snapshot) {
      render(payload.snapshot);
    }

    if (chatCacheClearButton) {
      chatCacheClearButton.textContent = t("home.clean");
    }
  } catch (error) {
    runtimeCard.innerHTML = `<strong>${t("home.cacheNotCleared")}</strong><span class="runtime-meta">${error.message}</span>`;
  } finally {
    setTimeout(() => {
      if (chatCacheClearButton) {
        chatCacheClearButton.disabled = false;
        chatCacheClearButton.textContent = originalText;
      }
    }, 900);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeProviderName(value) {
  return String(value || "").trim().replace(/^@/, "");
}

function createOutOfScopeProviderError(providerLabel) {
  return new Error(t("validation.outOfScopeProvider", { provider: providerLabel }));
}

function parseIdentityForProvider(providerKey, rawValue, options = {}) {
  const value = normalizeProviderName(rawValue);
  if (!value) {
    throw new Error(t("validation.invalidChannel"));
  }

  if (!PUBLIC_FILTER_KEYS.has(providerKey) || providerKey === "all") {
    throw createOutOfScopeProviderError(providerKey);
  }

  if (providerKey === "tiktok") {
    return {
      providerKey,
      rawInput: options.rawInput ?? rawValue,
      targetLabel: options.targetLabel ?? `@${value}`,
      patch: {
        channel: value,
        unique_id: value
      }
    };
  }

  if (providerKey === "youtube" && /^UC[\w-]{10,}$/i.test(value)) {
    return {
      providerKey,
      rawInput: options.rawInput ?? rawValue,
      targetLabel: options.targetLabel ?? value,
      patch: {
        channel: value,
        channel_id: value
      }
    };
  }

  return {
    providerKey,
    rawInput: options.rawInput ?? rawValue,
    targetLabel: options.targetLabel ?? value,
    patch: {
      channel: value
    }
  };
}

function maybeUrlCandidate(rawInput) {
  if (/^[a-z]+:\/\//i.test(rawInput)) {
    return rawInput;
  }

  if (/^(www\.)?(twitch\.tv|youtube\.com|youtu\.be|kick\.com|tiktok\.com|livecenter\.tiktok\.com)\//i.test(rawInput)) {
    return `https://${rawInput}`;
  }

  return "";
}

function parseQuickPrefix(rawInput) {
  const match = rawInput.match(/^(twitch|tw|youtube|yt|kick|tiktok|tt)\s*[:/ ]\s*(.+)$/i);
  if (!match) {
    return null;
  }

  const prefix = match[1].toLowerCase();
  const providerKey = prefix === "tw"
    ? "twitch"
    : prefix === "yt"
      ? "youtube"
      : prefix === "tt"
        ? "tiktok"
        : prefix;

  return parseIdentityForProvider(providerKey, match[2], {
    rawInput,
    targetLabel: match[2]
  });
}

function parseTwitchUrl(url, rawInput) {
  const segments = url.pathname.split("/").filter(Boolean);
  const reserved = new Set(["directory", "downloads", "jobs", "p", "settings", "subscriptions"]);
  let channel = url.searchParams.get("channel") || "";
  if (!channel && segments[0] === "popout" && segments[1]) {
    channel = segments[1];
  }
  if (!channel && segments[0] && !reserved.has(segments[0])) {
    channel = segments[0];
  }
  if (!channel) {
    throw new Error(t("validation.twitchUrl"));
  }
  return parseIdentityForProvider("twitch", channel, { rawInput, targetLabel: channel });
}

function parseYouTubeUrl(url, rawInput) {
  const segments = url.pathname.split("/").filter(Boolean);
  let target = "";
  let channelId = "";
  let needsResolution = false;

  if (url.hostname.includes("youtu.be")) {
    target = segments[0] || "";
    needsResolution = true;
  } else if (segments[0]?.startsWith("@")) {
    target = segments[0];
  } else if (segments[0] === "channel" && segments[1]) {
    target = segments[1];
    channelId = segments[1];
  } else if ((segments[0] === "c" || segments[0] === "user" || segments[0] === "live") && segments[1]) {
    target = segments[1];
    needsResolution = segments[0] === "live";
  } else if (segments[0] === "watch" || segments[0] === "live_chat") {
    target = url.searchParams.get("v") || rawInput;
    needsResolution = true;
  } else if (segments[0]) {
    target = segments[0];
  }

  if (!target) {
    throw new Error(t("validation.youtubeUrl"));
  }

  const parsed = parseIdentityForProvider("youtube", target, {
    rawInput,
    targetLabel: needsResolution ? "live do YouTube" : target
  });
  if (channelId) {
    parsed.patch.channel_id = channelId;
  }
  if (needsResolution) {
    parsed.patch.channel = "";
    parsed.needsResolution = true;
    parsed.sourceUrl = url.toString();
  }
  return parsed;
}

function parseKickUrl(url, rawInput) {
  const segments = url.pathname.split("/").filter(Boolean);
  const channel = segments[0] === "popout" && segments[1] ? segments[1] : segments[0] || "";
  if (!channel) {
    throw new Error(t("validation.kickUrl"));
  }
  return parseIdentityForProvider("kick", channel, { rawInput, targetLabel: channel });
}

function parseTikTokUrl(url, rawInput) {
  const segments = url.pathname.split("/").filter(Boolean);
  const handleSegment = segments.find((segment) => segment.startsWith("@"));
  const uniqueId = normalizeProviderName(handleSegment || segments[0] || "");
  if (!uniqueId) {
    throw new Error(t("validation.tiktokUrl"));
  }
  return parseIdentityForProvider("tiktok", uniqueId, {
    rawInput,
    targetLabel: `@${uniqueId}`
  });
}

function parseHomeQuickStartInput(rawInput) {
  const trimmed = String(rawInput || "").trim();
  if (!trimmed) {
    throw new Error(t("validation.quickStartEmpty"));
  }

  const prefixed = parseQuickPrefix(trimmed);
  if (prefixed) {
    return prefixed;
  }

  const urlCandidate = maybeUrlCandidate(trimmed);
  if (urlCandidate) {
    const url = new URL(urlCandidate);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();

    if (host.includes("twitch.tv")) return parseTwitchUrl(url, trimmed);
    if (host.includes("youtube.com") || host.includes("youtu.be")) return parseYouTubeUrl(url, trimmed);
    if (host.includes("kick.com")) return parseKickUrl(url, trimmed);
    if (host.includes("tiktok.com")) return parseTikTokUrl(url, trimmed);
  }

  if (trimmed.startsWith("@") || /^UC[\w-]{10,}$/i.test(trimmed)) {
    return parseIdentityForProvider("youtube", trimmed);
  }

  throw new Error(t("validation.unknownPlatform"));
}

function getProviderConfig(providerKey) {
  return currentSnapshot?.settings?.providers?.[providerKey] || {};
}

function buildCompatibilityPatch(providerKey, parsed) {
  const currentConfig = getProviderConfig(providerKey);
  const patch = {
    enabled: true,
    setup_mode: providerKey === "twitch" && currentConfig.auth_status === "authenticated"
      ? "official"
      : "compatibility",
    quick_input: parsed.rawInput
  };

  if (providerKey === "twitch") {
    patch.channel = parsed.patch.channel || currentConfig.channel || "";
    if (currentConfig.auth_status !== "authenticated") {
      patch.auth_status = "idle";
      patch.auth_error = "";
    }
  }

  if (providerKey === "youtube") {
    patch.channel = parsed.patch.channel || "";
    patch.channel_id = parsed.patch.channel_id || "";
    patch.setup_mode = "compatibility";
  }

  if (providerKey === "kick") {
    patch.channel = parsed.patch.channel || currentConfig.channel || "";
  }

  if (providerKey === "tiktok") {
    patch.setup_mode = "compatibility";
    patch.channel = parsed.patch.channel || currentConfig.channel || "";
    patch.unique_id = parsed.patch.unique_id || patch.channel;
  }

  return patch;
}

async function maybeResolveQuickStart(parsed) {
  if (parsed.providerKey !== "youtube" || !parsed.needsResolution) {
    return parsed;
  }

  try {
    const payload = await fetchJson("/api/quick-start/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw_input: parsed.sourceUrl || parsed.rawInput })
    });

    if (!payload.resolution) {
      return parsed;
    }

    return {
      ...parsed,
      targetLabel: payload.resolution.display_label || parsed.targetLabel,
      patch: {
        ...parsed.patch,
        channel: payload.resolution.channel || parsed.patch.channel || "",
        channel_id: payload.resolution.channel_id || parsed.patch.channel_id || ""
      }
    };
  } catch {
    return parsed;
  }
}

function renderHomeConnectStatus(message = "", tone = "info") {
  if (!homeConnectStatus) return;
  if (!message) {
    homeConnectStatus.hidden = true;
    homeConnectStatus.innerHTML = "";
    return;
  }

  homeConnectStatus.hidden = false;
  homeConnectStatus.innerHTML = `
    <p><span class="provider-state ${tone}">${tone === "error" ? t("common.error") : t("common.ready")}</span></p>
    <p>${escapeHtml(message)}</p>
  `;
}

async function handleHomeConnectSubmit(event) {
  event.preventDefault();
  if (!homeConnectInput) return;

  try {
    const parsed = await maybeResolveQuickStart(parseHomeQuickStartInput(homeConnectInput.value));
    const patch = buildCompatibilityPatch(parsed.providerKey, parsed);
    const snapshot = await saveProviderConfig(parsed.providerKey, patch);
    render(snapshot);
    renderHomeConnectStatus(t("settings.quick.providerReady", {
      provider: PROVIDER_META[parsed.providerKey].label,
      target: parsed.targetLabel
    }));
  } catch (error) {
    renderHomeConnectStatus(error.message, "error");
  }
}

function formatConnectionStatus(status) {
  if (status === "connected") return t("common.connected");
  if (status === "connecting") return t("common.connecting");
  if (status === "disconnected") return t("common.disconnected");
  if (status === "error") return t("common.error");
  return t("common.waiting");
}

function formatLiveStatus(status) {
  if (status === "live") return t("home.summary.live");
  if (status === "offline") return t("common.offline");
  return "";
}

function formatActivityTitle(event) {
  if (event.kind === "source_connected") return `${event.platform_label} ${t("common.connected").toLowerCase()}`;
  if (event.kind === "source_connecting") return `${event.platform_label} ${t("common.connecting").toLowerCase()}`;
  if (event.kind === "source_disconnected") return `${event.platform_label} ${t("common.disconnected").toLowerCase()}`;
  if (event.kind === "source_error") return `${event.platform_label} ${t("common.error").toLowerCase()}`;
  if (event.kind === "stream_started") return `${event.platform_label} ${t("home.summary.live").toLowerCase()}`;
  if (event.kind === "stream_ended") return `${event.platform_label} ${t("common.offline").toLowerCase()}`;
  if (event.kind === "livestream_metadata_updated") {
    return event.metadata?.viewer_count ? t("home.activity.audienceUpdated") : t("home.activity.statusUpdated");
  }
  return event.title;
}

function getMessageSourceLabel(message) {
  const providerConfig = currentSnapshot?.settings?.providers?.[message.source] || {};

  if (message.source === "tiktok") {
    const handle = providerConfig.unique_id || providerConfig.channel || message.channel || "";
    return handle ? `@${String(handle).replace(/^@/, "")}` : "TikTok";
  }

  if (message.source === "youtube") {
    return providerConfig.channel || providerConfig.channel_id || message.channel_display_name || message.channel || "";
  }

  return providerConfig.channel || message.channel_display_name || message.channel || "";
}

function getFeedItemKind(message) {
  if (message.kind === "membership") {
    return { label: t("feed.join"), className: "feed-join" };
  }

  if (message.kind === "highlight") {
    return { label: t("feed.highlight"), className: "feed-highlight" };
  }

  return { label: t("feed.message"), className: "feed-message" };
}

function getSystemItemKind(event) {
  if (event.kind === "source_error") {
    return { label: t("system.error"), className: "system-error" };
  }

  if (event.kind === "source_disconnected" || event.kind === "stream_ended") {
    return { label: t("system.drop"), className: "system-warning" };
  }

  if (event.kind === "source_connected" || event.kind === "stream_started") {
    return { label: t("system.ok"), className: "system-ok" };
  }

  return { label: t("system.technical"), className: "system-technical" };
}

function providerMatchesFilter(providerKey) {
  return isPublicProviderKey(providerKey)
    && (activeFilter === "all" || activeFilter === providerKey);
}

function getRuntimeProviderLabel(snapshot, provider) {
  const runtimeSource = snapshot.state.sources?.[provider.provider] || { status: "idle" };
  const runtimeConnection = Object.values(snapshot.state.connections || {}).find((connection) => (
    connection.source === provider.provider
    && connection.status !== "disconnected"
    && connection.status !== "error"
  ));
  const sourceIssueKind = runtimeSource.last_issue_kind || "";

  if (isConfirmedActiveConnection(runtimeConnection)) {
    return { text: t("common.active"), className: "runtime_connected" };
  }

  if (runtimeSource.status === "error" || sourceIssueKind === "source_error" || provider.auth_error) {
    return { text: t("common.error"), className: "error" };
  }

  if (runtimeConnection?.live_status === "offline" || sourceIssueKind === "stream_ended") {
    return { text: t("common.offline"), className: "error" };
  }

  if (runtimeSource.status === "disconnected" || sourceIssueKind === "source_disconnected") {
    return { text: t("common.disconnected"), className: "info" };
  }

  if (runtimeSource.status === "connecting") {
    return { text: t("common.connecting"), className: "info" };
  }

  if (isPendingLiveConnection(runtimeConnection)) {
    return { text: t("common.pendingLive"), className: "info" };
  }

  return {
    text: provider.human_status_label,
    className: provider.human_status_key
  };
}

function renderProviders(snapshot) {
  if (!providerList) {
    return;
  }
  providerList.innerHTML = "";
  for (const provider of snapshot.providers.filter((item) => isPublicProviderKey(item.provider))) {
    const runtimeStatus = getRuntimeProviderLabel(snapshot, provider);
    const target = provider.target_label || "sem alvo";

    const card = document.createElement("article");
    card.className = `provider-card provider-status-card provider-${provider.provider}`;
    card.style.setProperty("--accent", provider.accent_color);
    card.innerHTML = `
      <div class="provider-head">
        <span class="provider-logo" aria-hidden="true"><img src="${getProviderIconSrc(provider.provider)}" alt="" loading="lazy"></span>
        <strong>${provider.label}</strong>
        <span class="provider-state ${runtimeStatus.className}">${runtimeStatus.text}</span>
      </div>
      <p class="provider-identity">${escapeHtml(target)}</p>
    `;
    providerList.append(card);
  }
}

function getConfirmedActiveConnections(snapshot, { filtered = false } = {}) {
  return Object.values(snapshot.state.connections || {})
    .filter((connection) => (
      isPublicProviderKey(connection.source)
      && (!filtered || providerMatchesFilter(connection.source))
      && isConfirmedActiveConnection(connection)
    ));
}

function renderConnections(snapshot) {
  connectionList.innerHTML = "";
  const connections = getConfirmedActiveConnections(snapshot, { filtered: true });

  if (connections.length === 0) {
    const activeIssues = getActiveOperationalIssues(snapshot)
      .filter(({ source }) => providerMatchesFilter(source));
    const hasAnyActiveConnection = getConfirmedActiveConnections(snapshot).length > 0;
    connectionList.innerHTML = activeIssues.length > 0
      ? `<div class="empty">${t("home.empty.issue")}</div>`
      : hasAnyActiveConnection
        ? `<div class="empty">${t("home.empty.noFilteredSource")}</div>`
        : `<div class="empty">${t("home.empty.noLiveSource")}</div>`;
    return;
  }

  for (const connection of connections) {
    const card = document.createElement("article");
    card.className = "connection-card";
    card.style.setProperty("--accent", connection.accent_color);
    card.innerHTML = `
      <div class="connection-title">
        <span class="platform-pill ${connection.source}">${renderProviderIcon(connection.source, connection.platform_label)}</span>
        <strong>${connection.channel_display_name}</strong>
      </div>
      <p class="connection-stream">${connection.title || "sem titulo sincronizado"}</p>
      <div class="connection-meta">
        <span>${formatConnectionStatus(connection.status)}</span>
        ${formatLiveStatus(connection.live_status) ? `<span>${formatLiveStatus(connection.live_status)}</span>` : ""}
        <span>${connection.message_count} mensagens</span>
      </div>
    `;
    connectionList.append(card);
  }
}

function renderMessages(snapshot) {
  const shouldFollowLive = chatAutoFollow || isMessageListAtLiveEdge();
  const messages = snapshot.state.messages.filter((message) => providerMatchesFilter(message.source));
  if (messages.length === 0) {
    messageList.innerHTML = "";
    const activeIssues = getActiveOperationalIssues(snapshot)
      .filter(({ source }) => providerMatchesFilter(source));
    const visibleActiveConnections = getConfirmedActiveConnections(snapshot, { filtered: true });
    const hasAnyActiveConnection = getConfirmedActiveConnections(snapshot).length > 0;
    messageList.innerHTML = activeIssues.length > 0
      ? `<div class="empty">${t("home.empty.issue")}</div>`
      : visibleActiveConnections.length > 0
        ? `<div class="empty">${t("home.empty.waitingMessages")}</div>`
        : hasAnyActiveConnection
          ? `<div class="empty">${t("home.empty.noFilteredSource")}</div>`
          : `<div class="empty">${t("home.empty.noConfirmedLive")}</div>`;
    latestRenderedMessageId = "";
    latestKnownMessageId = "";
    chatAutoFollow = true;
    pendingChatUpdates = 0;
    updateChatFollowButton();
    return;
  }

  const latestMessageId = getMessageIdentity(messages[0]);
  const newMessageCount = countNewMessages(messages, latestKnownMessageId || latestRenderedMessageId);

  if (!shouldFollowLive && messageList.children.length > 0) {
    chatAutoFollow = false;
    pendingChatUpdates += newMessageCount;
    latestKnownMessageId = latestMessageId;
    updateChatFollowButton();
    return;
  }

  messageList.innerHTML = "";

  for (const message of messages.slice(0, messageLimit)) {
    const kind = getFeedItemKind(message);
    const item = document.createElement("article");
    item.className = `message-item ${kind.className}`;
    item.dataset.messageId = getMessageIdentity(message);
    item.style.setProperty("--accent", message.accent_color);
    item.innerHTML = `
      <div class="message-head">
        <span class="platform-pill ${message.source}">${renderProviderIcon(message.source, message.platform_label)}</span>
        <span class="platform-pill subtle-pill">${kind.label}</span>
        <strong>${message.author.name}</strong>
        <span class="message-channel">${getMessageSourceLabel(message)}</span>
        <span class="message-time">${formatTimestamp(message.time)}</span>
      </div>
      <p class="message-text"></p>
    `;
    renderMessageParts(item.querySelector(".message-text"), message.parts, message.text, {
      source: message.source
    });
    messageList.append(item);
  }

  if (shouldFollowLive) {
    chatAutoFollow = true;
    pendingChatUpdates = 0;
    setChatScrollTop(0);
  }

  latestRenderedMessageId = latestMessageId;
  latestKnownMessageId = latestMessageId;
  updateChatFollowButton();
}

function getFilterLabel(filterKey = activeFilter) {
  if (filterKey === "all") return t("common.all");
  return PROVIDER_META[filterKey]?.label || filterKey;
}

function renderSystem(snapshot) {
  if (!systemList) return;
  systemList.innerHTML = "";
  const activeIssues = getActiveOperationalIssues(snapshot)
    .filter(({ source }) => providerMatchesFilter(source));

  if (activeIssues.length === 0) {
    const activeConnections = getConfirmedActiveConnections(snapshot, { filtered: true });
    const latestInfo = (snapshot.state.system_events || [])
      .filter((event) => providerMatchesFilter(event.source) && isOperationalSystemEvent(event))
      .find((event) => event.kind === "source_connected" || event.kind === "stream_started");
    const latestSourceUpdate = Object.entries(snapshot.state.sources || {})
      .filter(([source, sourceState]) => (
        providerMatchesFilter(source)
        && sourceState?.last_event_at
      ))
      .sort((a, b) => Date.parse(b[1].last_event_at) - Date.parse(a[1].last_event_at))[0];
    const infoText = latestInfo
      ? t("home.system.lastUpdate", {
        title: formatActivityTitle(latestInfo),
        time: formatTimestamp(latestInfo.time)
      })
      : latestSourceUpdate
        ? t("home.system.lastSourceUpdate", {
          label: PROVIDER_META[latestSourceUpdate[0]]?.label || latestSourceUpdate[0],
          time: formatTimestamp(latestSourceUpdate[1].last_event_at)
        })
        : t("home.system.waiting");

    systemList.innerHTML = `
      <div class="empty system-clean">
        <span class="provider-state runtime_connected">OK</span>
        <strong>${t("home.system.ok")}</strong>
        <p>${t("home.system.okText", { count: activeConnections.length })}</p>
        <p>${escapeHtml(infoText)}</p>
      </div>
    `;
    return;
  }

  for (const { event } of activeIssues.slice(0, 4)) {
    const kind = getSystemItemKind(event);
    const activityTitle = formatActivityTitle(event);
    const activityMessage = event.message || "";
    const item = document.createElement("article");
    item.className = `system-item ${kind.className}`;
    item.style.setProperty("--accent", event.accent_color);
    item.innerHTML = `
      <div class="system-head">
        <span class="platform-pill ${event.source}">${renderProviderIcon(event.source, event.platform_label)}</span>
        <span class="platform-pill subtle-pill">${kind.label}</span>
        <strong title="${escapeHtml(activityTitle)}">${escapeHtml(activityTitle)}</strong>
        <span class="message-time">${formatTimestamp(event.time)}</span>
      </div>
      <p class="system-text" title="${escapeHtml(activityMessage)}"></p>
    `;
    item.querySelector(".system-text").textContent = activityMessage;
    systemList.append(item);
  }
}

function isOperationalSystemEvent(event) {
  return [
    "source_error",
    "source_disconnected",
    "stream_ended",
    "source_connected",
    "stream_started"
  ].includes(event.kind);
}

function isIssueSystemEvent(event) {
  return ["source_error", "source_disconnected", "stream_ended"].includes(event.kind);
}

function isResolvedSystemEvent(event) {
  return ["source_connected", "stream_started"].includes(event.kind);
}

function getLatestOperationalEventsBySource(events = []) {
  const latestBySource = new Map();
  for (const event of events) {
    if (!isPublicProviderKey(event.source) || !isOperationalSystemEvent(event)) {
      continue;
    }
    if (!latestBySource.has(event.source)) {
      latestBySource.set(event.source, event);
    }
  }
  return latestBySource;
}

function createSyntheticIssueEvent(source, kind, sourceState = {}, message = "") {
  const label = PROVIDER_META[source]?.label || source;
  const issueKind = sourceState.last_issue_kind || kind;
  return {
    id: `state:${source}:${issueKind}`,
    source,
    kind: issueKind,
    platform_label: label,
    time: sourceState.last_issue_at || sourceState.last_event_at || new Date().toISOString(),
    message: sourceState.last_issue_message || message || t("home.issue.fallback"),
    accent_color: undefined
  };
}

function getActiveOperationalIssues(snapshot) {
  const latestBySource = getLatestOperationalEventsBySource(snapshot.state.system_events || []);
  const latestConnectionBySource = new Map();
  for (const connection of Object.values(snapshot.state.connections || {})) {
    if (!isPublicProviderKey(connection.source)) continue;
    const current = latestConnectionBySource.get(connection.source);
    const currentTime = Date.parse(current?.last_event_at || current?.ended_at || 0);
    const nextTime = Date.parse(connection.last_event_at || connection.ended_at || 0);
    if (!current || nextTime >= currentTime) {
      latestConnectionBySource.set(connection.source, connection);
    }
  }

  const issues = new Map();
  const sources = new Set([
    ...Object.keys(snapshot.state.sources || {}),
    ...latestConnectionBySource.keys()
  ]);

  for (const source of sources) {
    if (!isPublicProviderKey(source)) continue;

    const sourceState = snapshot.state.sources?.[source] || {};
    const connection = latestConnectionBySource.get(source);
    if (isConfirmedActiveConnection(connection)) {
      continue;
    }
    const isOfflineLive = connection?.status === "connected" && connection.live_status === "offline";
    const latest = latestBySource.get(source);
    const latestIssue = latest && isIssueSystemEvent(latest) ? latest : null;
    const storedIssueKind = sourceState.last_issue_kind || "";
    const latestResolved = latest && isResolvedSystemEvent(latest) && !isOfflineLive;
    if (latestResolved) {
      continue;
    }

    if (sourceState?.status === "error" || latestIssue?.kind === "source_error" || storedIssueKind === "source_error") {
      issues.set(source, {
        source,
        event: latestIssue?.kind === "source_error"
          ? latestIssue
          : createSyntheticIssueEvent(source, "source_error", sourceState, t("home.issue.error"))
      });
      continue;
    }

    if (
      sourceState?.status === "disconnected"
      || latestIssue?.kind === "source_disconnected"
      || storedIssueKind === "source_disconnected"
    ) {
      issues.set(source, {
        source,
        event: latestIssue?.kind === "source_disconnected"
          ? latestIssue
          : createSyntheticIssueEvent(source, "source_disconnected", sourceState, t("home.issue.disconnected"))
      });
      continue;
    }

    if (isOfflineLive || latestIssue?.kind === "stream_ended" || storedIssueKind === "stream_ended") {
      issues.set(source, {
        source,
        event: latestIssue?.kind === "stream_ended"
          ? latestIssue
          : createSyntheticIssueEvent(
            source,
            "stream_ended",
            {
              ...sourceState,
              last_issue_at: sourceState.last_issue_at || connection?.ended_at || connection?.last_event_at || sourceState.last_event_at
            },
            t("home.issue.ended", {
              label: connection?.channel_display_name || PROVIDER_META[source]?.label || source
            })
          )
      });
    }
  }

  return Array.from(issues.values())
    .sort((a, b) => Date.parse(b.event.time || 0) - Date.parse(a.event.time || 0));
}

function getCompactSystemEvents(events) {
  const operationalEvents = events.filter(isOperationalSystemEvent);
  const issueEvents = operationalEvents.filter(isIssueSystemEvent);
  const selected = [];
  const selectedIds = new Set();

  for (const event of issueEvents) {
    if (selected.length >= 4) break;
    selected.push(event);
    selectedIds.add(event.id);
  }

  const latestBySource = new Map();
  for (const event of operationalEvents) {
    if (!latestBySource.has(event.source)) {
      latestBySource.set(event.source, event);
    }
  }

  for (const event of latestBySource.values()) {
    if (selected.length >= 4) break;
    if (!selectedIds.has(event.id)) {
      selected.push(event);
      selectedIds.add(event.id);
    }
  }

  for (const event of operationalEvents) {
    if (selected.length >= 4) break;
    if (!selectedIds.has(event.id)) {
      selected.push(event);
      selectedIds.add(event.id);
    }
  }

  return selected;
}

function renderQuickSummary(snapshot) {
  if (!quickSummary) return;

  const connections = Object.values(snapshot.state.connections || {})
    .filter((connection) => isPublicProviderKey(connection.source));
  const connectedConnections = connections.filter((connection) => connection.status === "connected");
  const liveConnections = connectedConnections.filter(isConfirmedActiveConnection);
  const offlineConnections = connectedConnections.filter((connection) => connection.live_status === "offline");
  const errorSources = Object.entries(snapshot.state.sources || {})
    .filter(([source, sourceState]) => isPublicProviderKey(source) && sourceState?.status === "error");
  const lastEvent = (snapshot.state.system_events || [])[0];
  const lastUpdate = lastEvent?.time ? formatTimestamp(lastEvent.time) : t("home.summary.now");

  quickSummary.innerHTML = `
    <div class="summary-row">
      <span class="summary-icon">C</span>
      <span>${t("home.summary.connected")}</span>
      <strong>${connectedConnections.length}</strong>
    </div>
    <div class="summary-row">
      <span class="summary-icon">A</span>
      <span>${t("home.summary.live")}</span>
      <strong>${liveConnections.length}</strong>
    </div>
    <div class="summary-row">
      <span class="summary-icon">O</span>
      <span>${t("home.summary.offline")}</span>
      <strong>${offlineConnections.length}</strong>
    </div>
    <div class="summary-row">
      <span class="summary-icon">E</span>
      <span>${t("home.summary.error")}</span>
      <strong>${errorSources.length}</strong>
    </div>
    <div class="summary-row">
      <span class="summary-icon">U</span>
      <span>${t("home.summary.lastUpdate")}</span>
      <strong>${lastUpdate}</strong>
    </div>
  `;
}

function renderSourceAlert(snapshot) {
  if (!sourceAlert) return;

  const activeIssues = getActiveOperationalIssues(snapshot);
  if (activeIssues.length === 0) {
    sourceAlert.hidden = true;
    sourceAlert.innerHTML = "";
    return;
  }

  const { source, event } = activeIssues[0];
  const label = PROVIDER_META[source]?.label || source;
  const issueText = event?.message || t("home.alert.fallback");

  sourceAlert.hidden = false;
  sourceAlert.className = "panel source-alert is-error";
  sourceAlert.innerHTML = `
    <div>
      <span class="provider-state error">${t("home.alert.errorCount", { count: activeIssues.length })}</span>
      <strong>${escapeHtml(t("home.alert.needsAttention", { label }))}</strong>
      <p>${escapeHtml(issueText)}</p>
    </div>
    <button type="button" class="action tiny ghost platform-filter ${source}" data-filter="${source}">${t("home.alert.detail")}</button>
  `;
}

function renderFilterStatus(snapshot) {
  if (!filterStatusCard) return;

  const allConnections = getConfirmedActiveConnections(snapshot);
  const visibleConnections = allConnections.filter((connection) => providerMatchesFilter(connection.source));
  const messageCount = (snapshot.state.messages || [])
    .filter((message) => providerMatchesFilter(message.source)).length;
  const isAll = activeFilter === "all";
  const label = getFilterLabel(activeFilter);

  filterStatusCard.innerHTML = `
    <div>
      <span class="panel-sub">${t("home.filter.active")}</span>
      <strong>${escapeHtml(label)}</strong>
      <p>${t("home.filter.visible", { visible: visibleConnections.length, total: allConnections.length, messages: messageCount })}</p>
    </div>
    ${isAll ? "" : `<button type="button" class="action tiny ghost" data-filter="all">${t("home.filter.clear")}</button>`}
  `;

  if (feedSubtitle) {
    feedSubtitle.textContent = isAll
      ? t("home.allFeed")
      : t("home.filter.only", { label });
  }
}

function getOverlayStatusLabel(status) {
  if (status === "open") return { text: t("home.overlay.opened"), cls: "runtime_connected" };
  if (status === "opening") return { text: t("home.overlay.opening"), cls: "info" };
  if (status === "closing") return { text: t("home.overlay.closing"), cls: "info" };
  if (status === "failed") return { text: t("home.overlay.failed"), cls: "error" };
  return { text: t("home.overlay.closed"), cls: "" };
}

function setOverlayButtonLabel(text) {
  if (!overlayToggleButton) return;
  overlayToggleButton.innerHTML = `<span>${escapeHtml(text)}</span>`;
}

function renderOverlayDiagnostic() {
  if (overlayStatusBadge) {
    const label = getOverlayStatusLabel(overlayStatus.status);
    overlayStatusBadge.textContent = label.text;
    overlayStatusBadge.className = `provider-state overlay-status-badge ${label.cls}`;
  }

  if (!overlayDiagnosticPanel || !overlayDiagnosticList) return;

  const hasDiag = overlayStatus.status !== "closed"
    || Boolean(overlayStatus.error)
    || Boolean(overlayStatus.bounds);

  if (overlayAdvancedDetails) {
    overlayAdvancedDetails.hidden = !hasDiag;
    overlayAdvancedDetails.open = overlayStatus.status === "failed";
  }
  if (overlayAdvancedSummary) {
    overlayAdvancedSummary.textContent = overlayStatus.status === "failed"
      ? t("home.diagnostic.failedSummary")
      : t("home.diagnostic.summary");
  }

  overlayDiagnosticPanel.hidden = !hasDiag;
  if (!hasDiag) {
    overlayDiagnosticList.innerHTML = "";
    if (overlayCopyDiagnostic) overlayCopyDiagnostic.hidden = true;
    return;
  }

  const entries = [
    [t("home.diagnostic.status"), overlayStatus.status],
    overlayStatus.monitor ? [t("common.monitor"), overlayStatus.monitor] : null,
    overlayStatus.bounds ? [t("home.diagnostic.position"), `x:${overlayStatus.bounds.x}  y:${overlayStatus.bounds.y}`] : null,
    overlayStatus.bounds ? [t("home.diagnostic.size"), `${overlayStatus.bounds.width}x${overlayStatus.bounds.height}`] : null,
    overlayStatus.openedAt ? [t("home.diagnostic.openedAt"), new Date(overlayStatus.openedAt).toLocaleTimeString(getCurrentLocale())] : null,
    overlayStatus.error ? [t("common.error"), overlayStatus.error] : null
  ].filter(Boolean);

  overlayDiagnosticList.innerHTML = entries.map(([key, value]) => `
    <div class="overlay-diagnostic-row">
      <dt>${key}</dt>
      <dd>${String(value)}</dd>
    </div>
  `).join("");

  if (overlayCopyDiagnostic) overlayCopyDiagnostic.hidden = false;
}

function updateOverlayToggleButton() {
  if (!overlayToggleButton) return;

  const { status } = overlayStatus;
  overlayToggleButton.classList.remove("ghost", "solid");

  if (status === "opening" || status === "closing") {
    setOverlayButtonLabel(status === "opening" ? t("home.overlay.opening") : t("home.overlay.closing"));
    overlayToggleButton.classList.add("ghost");
    overlayToggleButton.disabled = true;
  } else if (status === "open") {
    setOverlayButtonLabel(t("home.overlay.buttonClose"));
    overlayToggleButton.classList.add("ghost");
    overlayToggleButton.disabled = false;
  } else {
    setOverlayButtonLabel(status === "failed" ? t("home.overlay.tryAgain") : t("home.overlay.buttonOpen"));
    overlayToggleButton.classList.add("solid");
    overlayToggleButton.disabled = false;
  }

  renderOverlayDiagnostic();
}

function handleOverlayEvent(state) {
  if (!state || typeof state !== "object") return;
  overlayStatus = state;
  updateOverlayToggleButton();
}

async function syncOverlayState() {
  const payload = await fetchJson("/api/overlay/status");
  overlayStatus = { status: "closed", ...(payload.overlay || {}) };
  updateOverlayToggleButton();
}

function renderFilterButtons() {
  document.querySelectorAll("[data-filter]").forEach((button) => {
    if (button.closest("#sourceAlert")) {
      button.classList.remove("is-active");
      return;
    }
    button.classList.toggle("is-active", button.dataset.filter === activeFilter);
  });
}

function render(snapshot) {
  currentSnapshot = snapshot;
  const snapshotFilter = snapshot.settings?.ui?.active_source_filter || "all";
  const nextFilter = PUBLIC_FILTER_KEYS.has(snapshotFilter) ? snapshotFilter : "all";
  if (nextFilter !== activeFilter) {
    activeFilter = nextFilter;
  }
  renderRuntimeCard(runtimeCard, snapshot);
  renderProviders(snapshot);
  renderConnections(snapshot);
  renderMessages(snapshot);
  renderSystem(snapshot);
  renderSourceAlert(snapshot);
  renderFilterStatus(snapshot);
  renderQuickSummary(snapshot);
  renderFilterButtons();
  applyTranslations();
}

async function setActiveFilter(nextFilter) {
  activeFilter = nextFilter;
  resumeChatFollow();
  render(currentSnapshot);

  if (nextFilter === lastFilterSync) {
    return;
  }

  lastFilterSync = nextFilter;
  await fetchJson("/api/config/ui", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active_source_filter: nextFilter })
  });
}

function handleHotkeys(event) {
  const targetTag = event.target?.tagName;
  if (targetTag === "INPUT" || targetTag === "TEXTAREA") {
    return;
  }

  if (!event.altKey || event.ctrlKey || event.metaKey) {
    return;
  }

  const key = event.key.toLowerCase();
  if (key === "0") {
    setActiveFilter("all").catch((error) => {
      runtimeCard.innerHTML = `<strong>${t("home.filter.failed")}</strong><span class="runtime-meta">${error.message}</span>`;
    });
    event.preventDefault();
  }
  if (key === "1") {
    setActiveFilter("twitch").catch((error) => {
      runtimeCard.innerHTML = `<strong>${t("home.filter.failed")}</strong><span class="runtime-meta">${error.message}</span>`;
    });
    event.preventDefault();
  }
  if (key === "2") {
    setActiveFilter("youtube").catch((error) => {
      runtimeCard.innerHTML = `<strong>${t("home.filter.failed")}</strong><span class="runtime-meta">${error.message}</span>`;
    });
    event.preventDefault();
  }
  if (key === "3") {
    setActiveFilter("kick").catch((error) => {
      runtimeCard.innerHTML = `<strong>${t("home.filter.failed")}</strong><span class="runtime-meta">${error.message}</span>`;
    });
    event.preventDefault();
  }
  if (key === "4") {
    setActiveFilter("tiktok").catch((error) => {
      runtimeCard.innerHTML = `<strong>${t("home.filter.failed")}</strong><span class="runtime-meta">${error.message}</span>`;
    });
    event.preventDefault();
  }
}

async function boot() {
  installMessagePartImageFallback();

  if (messageLimitSelect) {
    messageLimitSelect.value = String(messageLimit);
  }

  const initialSnapshot = await fetchSnapshot();
  initI18n(initialSnapshot);
  render(initialSnapshot);
  const stream = createEventStream(render);
  stream.addEventListener("overlay", (event) => {
    handleOverlayEvent(JSON.parse(event.data));
  });
  await syncOverlayState();

  homeConnectForm?.addEventListener("submit", handleHomeConnectSubmit);

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button || !PUBLIC_FILTER_KEYS.has(button.dataset.filter)) {
      return;
    }
    event.preventDefault();
    await setActiveFilter(button.dataset.filter);
  });

  overlayToggleButton?.addEventListener("click", async () => {
    if (overlayToggleButton.disabled) return;
    overlayToggleButton.disabled = true;
    try {
      const { status } = overlayStatus;
      if (status === "open") {
        await fetchJson("/api/overlay/close", { method: "POST" });
      } else if (status === "closed" || status === "failed") {
        await fetchJson("/api/overlay/open", { method: "POST" });
      }
      await syncOverlayState();
    } catch (error) {
      runtimeCard.innerHTML = `<strong>${t("home.overlay.failedCard")}</strong><span class="runtime-meta">${error.message}</span>`;
      overlayToggleButton.disabled = false;
    } finally {
      setTimeout(() => updateOverlayToggleButton(), 300);
    }
  });

  overlayCopyDiagnostic?.addEventListener("click", () => {
    const text = JSON.stringify(overlayStatus, null, 2);
    navigator.clipboard?.writeText(text).catch(() => {});
    overlayCopyDiagnostic.textContent = t("home.diagnostic.copied");
    setTimeout(() => { overlayCopyDiagnostic.textContent = t("home.diagnostic.copy"); }, 1800);
  });

  messageLimitSelect?.addEventListener("change", () => {
    const nextLimit = Number(messageLimitSelect.value);
    if (!Number.isFinite(nextLimit)) {
      return;
    }
    messageLimit = nextLimit;
    globalThis.localStorage?.setItem("livechat-message-limit", String(nextLimit));
    resumeChatFollow();
    if (currentSnapshot) {
      renderMessages(currentSnapshot);
    }
  });

  messageList?.addEventListener("scroll", () => {
    if (isApplyingChatScroll) {
      return;
    }

    if (isMessageListAtLiveEdge()) {
      if (!chatAutoFollow) {
        resumeChatFollow({ renderLatest: true });
        return;
      }
    } else {
      chatAutoFollow = false;
    }
    updateChatFollowButton();
  }, { passive: true });

  chatFollowButton?.addEventListener("click", () => resumeChatFollow({ renderLatest: true }));
  chatCacheClearButton?.addEventListener("click", clearChatCache);

  window.addEventListener("keydown", handleHotkeys);
}

boot().catch((error) => {
  runtimeCard.innerHTML = `<strong>${t("home.bootFailed")}</strong><span class="runtime-meta">${error.message}</span>`;
});
