//        __     __                   
// _|_   (_ ||\/|__) /\ _ _ _ _|   _  
//  |    __)||  |__)/--|_| (_(_||_|/_ 
//                     |  

import {
  PUBLIC_PROVIDER_KEYS,
  applyProviderConfigToForm,
  createEventStream,
  fetchJson,
  fetchSnapshot,
  isConfirmedActiveConnection,
  isPendingLiveConnection,
  normalizeProviderPatch,
  renderRuntimeCard,
  saveProviderConfig
} from "./shared.js";
import {
  installMessagePartImageFallback,
  messagePartsToHtml
} from "./message-parts.js";
import {
  applyTranslations,
  bindLanguageSwitcher,
  initI18n,
  t
} from "./i18n.js";

const runtimeCard = document.querySelector("#runtimeCard");
const quickStartForm = document.querySelector("#quickStartForm");
const quickStartInput = document.querySelector("#quickStartInput");
const quickStartContext = document.querySelector("#quickStartContext");
const quickStartStatus = document.querySelector("#quickStartStatus");
const quickStartAutoDetectButton = document.querySelector("#quickStartAutoDetectButton");
const settingsProviderList = document.querySelector("#settingsProviderList");
const platformDetails = document.querySelector("#platformDetails");
const overlayConfigForm = document.querySelector("#overlayConfigForm");
const overlayConfigStatus = document.querySelector("#overlayConfigStatus");
const overlayPreviewStage = document.querySelector("#overlayPreviewStage");
const overlayPreviewMeta = document.querySelector("#overlayPreviewMeta");
const overlayDisplaySupport = document.querySelector("#overlayDisplaySupport");
const overlayDisplaySelect = document.querySelector("#overlayDisplaySelect");
const overlayIdentifyDisplaysButton = document.querySelector("#overlayIdentifyDisplaysButton");
const overlayTestDisplayButton = document.querySelector("#overlayTestDisplayButton");
const overlayWorkbench = document.querySelector("#overlaySettings");
const overlayWorkbenchToggles = document.querySelectorAll("[data-overlay-workbench-toggle]");

const OVERLAY_PLATFORM_KEYS = ["twitch", "youtube", "kick", "tiktok"];

const providerKeys = PUBLIC_PROVIDER_KEYS;
const providerForms = {
  twitch: document.querySelector("#twitchConfigForm"),
  youtube: document.querySelector("#youtubeConfigForm"),
  kick: document.querySelector("#kickConfigForm"),
  tiktok: document.querySelector("#tiktokConfigForm")
};
const providerOfficialForms = {
  youtube: document.querySelector("#youtubeOfficialForm")
};
const providerDetails = {
  twitch: document.querySelector("#twitchAdvancedDetails"),
  youtube: document.querySelector("#youtubeAdvancedDetails"),
  kick: document.querySelector("#kickAdvancedDetails"),
  tiktok: document.querySelector("#tiktokConfigForm")
};
const providerOfficialDetails = {
  youtube: document.querySelector("#youtubeOfficialDetails")
};
const providerCards = Object.fromEntries(providerKeys.map((providerKey) => {
  const card = document.querySelector(`[data-provider-card="${providerKey}"]`);
  return [providerKey, {
    card,
    copy: card.querySelector("[data-provider-copy]"),
    status: card.querySelector("[data-provider-status]"),
    method: card.querySelector("[data-provider-method]"),
    support: card.querySelector("[data-provider-support]"),
    target: card.querySelector("[data-provider-target]"),
    actions: card.querySelector("[data-provider-actions]"),
    notes: card.querySelector("[data-provider-notes]"),
    feedback: card.querySelector("[data-provider-feedback]")
  }];
}));

const PROVIDER_META = {
  twitch: {
    label: "Twitch",
    defaultQuickHintKey: "settings.provider.defaultTwitch",
    defaultHeadlineKey: "settings.provider.defaultTwitchHeadline"
  },
  youtube: {
    label: "YouTube",
    defaultQuickHintKey: "settings.provider.defaultYoutube",
    defaultHeadlineKey: "settings.provider.defaultYoutubeHeadline"
  },
  kick: {
    label: "Kick",
    defaultQuickHintKey: "settings.provider.defaultKick",
    defaultHeadlineKey: "settings.provider.defaultKickHeadline"
  },
  tiktok: {
    label: "TikTok",
    defaultQuickHintKey: "settings.provider.defaultTiktok",
    defaultHeadlineKey: "settings.provider.defaultTiktokHeadline"
  }
};

let latestSnapshot = null;
let lastSettingsSignature = "";
let lastOverlaySignature = "";
let quickStartPreferredProvider = "";
let selectedProviderDetail = "";
let overlayDraft = null;
let overlayWorkbenchExpanded = false;
let overlayDisplayState = {
  supported: false,
  displays: [],
  reason: ""
};

function isRealRuntimeMode(snapshot = latestSnapshot) {
  const adapters = snapshot?.runtime?.active_adapters || [];
  return adapters.length > 0 && !adapters.includes("demo") && !adapters.includes("replay");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function formatOverlayPreviewAuthor(value) {
  return String(value || "Autor").toUpperCase();
}

function getOverlayPreviewWeightValue(weight) {
  if (weight === "regular") return "400";
  if (weight === "bold") return "700";
  return "600";
}

function getProviderIconSrc(providerKey) {
  return `/icon/${providerKey}.ico`;
}

function renderQuickStartContext() {
  if (!quickStartContext) {
    return;
  }

  quickStartContext.textContent = quickStartPreferredProvider
    ? t("settings.connect.contextReady", { provider: PROVIDER_META[quickStartPreferredProvider].label })
    : t("settings.connect.note");
}

function renderQuickStartStatus(message, tone = "info") {
  quickStartStatus.hidden = false;
  quickStartStatus.innerHTML = `
    <p><span class="provider-state ${tone}">${tone === "error" ? t("common.error") : t("common.ready")}</span></p>
    <p>${escapeHtml(message)}</p>
  `;
}

function clearQuickStartStatus() {
  quickStartStatus.hidden = true;
  quickStartStatus.innerHTML = "";
}

function renderOverlayStatus(label = "", message = "", tone = "info") {
  if (!overlayConfigStatus) {
    return;
  }

  if (!label && !message) {
    overlayConfigStatus.hidden = true;
    overlayConfigStatus.innerHTML = "";
    return;
  }

  overlayConfigStatus.hidden = false;
  overlayConfigStatus.innerHTML = `
    <p><span class="provider-state ${tone}">${escapeHtml(label)}</span></p>
    <p>${escapeHtml(message)}</p>
  `;
}

function setOverlayFieldValue(name, value) {
  const field = overlayConfigForm?.elements.namedItem(name);
  if (!field) {
    return;
  }

  if (field.type === "checkbox") {
    field.checked = Boolean(value);
  } else if (typeof value === "string" || typeof value === "number") {
    field.value = value;
  }
}

function getOverlayCanonicalChannel(source, item, snapshot = latestSnapshot) {
  const providerConfig = snapshot?.settings?.providers?.[source] || {};

  if (source === "tiktok") {
    const uniqueId = providerConfig.unique_id || providerConfig.channel || item.channel || "";
    return uniqueId ? `@${String(uniqueId).replace(/^@/, "")}` : "";
  }

  if (source === "youtube") {
    return providerConfig.channel || providerConfig.channel_id || item.channel_display_name || item.channel || "";
  }

  return providerConfig.channel || item.channel_display_name || item.channel || "";
}

function classifyPreviewMessage(message) {
  if (message.kind === "membership") {
    return "join";
  }

  return "message";
}

function classifyPreviewEvent(event) {
  if (event.kind === "livestream_metadata_updated" && event.metadata?.viewer_count !== undefined) {
    return "audience";
  }

  return "technical";
}

function buildOverlayPreviewItems(snapshot, overlayConfig) {
  const cutoff = Date.now() - (overlayConfig.duration_ms || 15000);
  const matchesPlatform = (source) => overlayConfig.filters?.platforms?.[source] !== false;
  const items = [];
  const fallbackItems = [];

  for (const message of snapshot.state.messages || []) {
    if (!matchesPlatform(message.source)) {
      continue;
    }

    const kind = classifyPreviewMessage(message);
    if (kind === "message" && !overlayConfig.filters?.messages) {
      continue;
    }
    if (kind === "join" && !overlayConfig.filters?.joins) {
      continue;
    }

    const timeValue = Date.parse(message.time);
    const previewItem = {
      id: message.id,
      source: message.source,
      platformLabel: message.platform_label,
      channelLabel: getOverlayCanonicalChannel(message.source, message, snapshot),
      author: message.author?.name || "Autor",
      body: message.text,
      parts: message.parts,
      accent: message.accent_color,
      type: kind,
      time: message.time
    };

    fallbackItems.push(previewItem);
    if (Number.isFinite(timeValue) && timeValue < cutoff) {
      continue;
    }

    items.push(previewItem);
  }

  for (const event of snapshot.state.system_events || []) {
    if (!matchesPlatform(event.source)) {
      continue;
    }

    const type = classifyPreviewEvent(event);
    if (type === "audience" && !overlayConfig.filters?.audience_updates) {
      continue;
    }
    if (type === "technical" && !overlayConfig.filters?.technical_events) {
      continue;
    }

    const timeValue = Date.parse(event.time);
    const previewItem = {
      id: event.id,
      source: event.source,
      platformLabel: event.platform_label,
      channelLabel: getOverlayCanonicalChannel(event.source, event, snapshot),
      author: type === "audience" ? "Atualizacao" : event.platform_label,
      body: event.message,
      accent: event.accent_color,
      type,
      time: event.time
    };

    fallbackItems.push(previewItem);
    if (Number.isFinite(timeValue) && timeValue < cutoff) {
      continue;
    }

    items.push(previewItem);
  }

  const ordered = (items.length > 0 ? items : fallbackItems)
    .sort((a, b) => Date.parse(b.time) - Date.parse(a.time))
    .slice(0, overlayConfig.max_messages || 6);

  return ordered;
}

function renderOverlayPreview(config = overlayDraft) {
  if (!overlayPreviewStage || !config || !latestSnapshot) {
    return;
  }

  overlayPreviewStage.style.setProperty("--overlay-card-width", `${config.card_width_px}px`);
  overlayPreviewStage.style.setProperty("--overlay-font-size", `${config.font_size_px}px`);
  overlayPreviewStage.style.setProperty("--overlay-line-height", String(config.line_height));
  overlayPreviewStage.style.setProperty("--overlay-gap", `${config.gap_px}px`);
  overlayPreviewStage.style.setProperty("--overlay-message-weight", getOverlayPreviewWeightValue(config.message_font_weight));
  const overlayOpacity = Math.max(0, Math.min(1, (config.background_opacity || 0) / 100));
  overlayPreviewStage.style.setProperty("--overlay-opacity", String(overlayOpacity));
  overlayPreviewStage.style.setProperty("--overlay-sheen-strong", String(Math.min(0.075, overlayOpacity * 0.29)));
  overlayPreviewStage.style.setProperty("--overlay-sheen-soft", String(Math.min(0.026, overlayOpacity * 0.1)));
  overlayPreviewStage.style.setProperty("--overlay-border-opacity", String(Math.min(0.14, overlayOpacity * 0.56)));
  overlayPreviewStage.style.setProperty("--overlay-shadow-opacity", String(Math.min(0.24, overlayOpacity * 1.34)));
  overlayPreviewStage.dataset.animation = config.animation;
  overlayPreviewStage.dataset.enabled = String(Boolean(config.enabled));

  const items = buildOverlayPreviewItems(latestSnapshot, config);
  if (!config.enabled) {
    overlayPreviewStage.innerHTML = `<div class="overlay-preview-empty">${t("settings.overlay.disabled")}</div>`;
    overlayPreviewMeta.textContent = t("settings.overlay.disabledMeta");
    return;
  }

  if (items.length === 0) {
    overlayPreviewStage.innerHTML = `<div class="overlay-preview-empty">${t("settings.overlay.empty")}</div>`;
    overlayPreviewMeta.textContent = t("settings.overlay.emptyMeta");
    return;
  }

  overlayPreviewStage.innerHTML = items.map((item) => {
    const badges = [];
    if (config.show_platform_badge) {
      badges.push(`<span class="overlay-preview-badge">${escapeHtml(item.platformLabel)}</span>`);
    }
    if (config.show_channel && item.channelLabel) {
      badges.push(`<span class="overlay-preview-channel">${escapeHtml(item.channelLabel)}</span>`);
    }
    const authorLabel = formatOverlayPreviewAuthor(item.author);
    const initials = escapeHtml(Array.from(authorLabel.trim()).slice(0, 2).join("") || "?");
    return `
      <article class="overlay-preview-item overlay-preview-${item.type}" style="--accent:${item.accent || "#0f172a"}">
        ${config.show_avatar ? `<div class="overlay-preview-avatar">${initials}</div>` : ""}
        <div class="overlay-preview-body">
          ${badges.length > 0 ? `<div class="overlay-preview-meta">${badges.join("")}</div>` : ""}
          <p class="overlay-preview-author" title="${escapeHtml(authorLabel)}">${escapeHtml(authorLabel)}</p>
          <p class="overlay-preview-message">${messagePartsToHtml(item.parts, item.body, { emoteClassName: "overlay-preview-emote" })}</p>
        </div>
      </article>
    `;
  }).join("");

  const activePlatforms = OVERLAY_PLATFORM_KEYS.filter((key) => config.filters?.platforms?.[key]).map((key) => PROVIDER_META[key].label);
  overlayPreviewMeta.textContent = t("settings.overlay.previewCount", {
    count: items.length,
    platforms: activePlatforms.join(", ") || t("settings.overlay.noPlatform")
  });
}

function applyOverlayConfigToForm(config) {
  if (!overlayConfigForm || !config) return;

  overlayDraft = structuredClone(config);

  setOverlayFieldValue("enabled", config.enabled);
  setOverlayFieldValue("position", config.position);
  setOverlayFieldValue("offset_x", config.offset_x);
  setOverlayFieldValue("offset_y", config.offset_y);
  setOverlayFieldValue("duration_ms", config.duration_ms);
  setOverlayFieldValue("max_messages", config.max_messages);
  setOverlayFieldValue("font_size_px", config.font_size_px);
  setOverlayFieldValue("message_font_weight", config.message_font_weight || "semibold");
  setOverlayFieldValue("line_height", config.line_height);
  setOverlayFieldValue("card_width_px", config.card_width_px);
  setOverlayFieldValue("gap_px", config.gap_px);
  setOverlayFieldValue("background_opacity", config.background_opacity);
  setOverlayFieldValue("show_platform_badge", config.show_platform_badge);
  setOverlayFieldValue("show_channel", config.show_channel);
  setOverlayFieldValue("show_avatar", config.show_avatar);
  setOverlayFieldValue("animation", config.animation);
  setOverlayFieldValue("filter_messages", config.filters?.messages);
  setOverlayFieldValue("filter_joins", config.filters?.joins);
  setOverlayFieldValue("filter_audience_updates", config.filters?.audience_updates);
  setOverlayFieldValue("filter_technical_events", config.filters?.technical_events);

  for (const key of OVERLAY_PLATFORM_KEYS) {
    setOverlayFieldValue(`platform_${key}`, config.filters?.platforms?.[key]);
  }

  renderOverlayPreview(overlayDraft);
}

function getProviderSummary(providerKey) {
  return latestSnapshot?.providers?.find((provider) => provider.provider === providerKey);
}

function getProviderConfig(providerKey) {
  return latestSnapshot?.settings?.providers?.[providerKey] || {};
}

function providerHasTarget(providerKey, config = getProviderConfig(providerKey)) {
  if (providerKey === "youtube") {
    return Boolean(config.quick_input || config.channel || config.channel_id);
  }

  if (providerKey === "tiktok") {
    return Boolean(config.quick_input || config.unique_id || config.channel);
  }

  return Boolean(config.quick_input || config.channel);
}

function buildProviderPausePatch(providerKey, config) {
  return {
    enabled: false,
    setup_mode: config.setup_mode || "compatibility"
  };
}

function buildProviderReconnectPatch(providerKey, config) {
  return {
    enabled: true,
    setup_mode: config.setup_mode || "compatibility"
  };
}

function buildProviderRemovePatch(providerKey) {
  if (providerKey === "twitch") {
    return {
      enabled: false,
      channel: "",
      quick_input: "",
      broadcaster_user_id: "",
      setup_mode: ""
    };
  }

  if (providerKey === "youtube") {
    return {
      enabled: false,
      channel: "",
      channel_id: "",
      quick_input: "",
      setup_mode: ""
    };
  }

  if (providerKey === "kick") {
    return {
      enabled: false,
      channel: "",
      broadcaster_user_id: "",
      quick_input: "",
      setup_mode: ""
    };
  }

  if (providerKey === "tiktok") {
    return {
      enabled: false,
      channel: "",
      unique_id: "",
      quick_input: "",
      setup_mode: ""
    };
  }

  return {
    enabled: false
  };
}

function getProviderRuntimeConnection(providerKey, snapshot = latestSnapshot) {
  if (!isRealRuntimeMode(snapshot)) {
    return null;
  }

  return Object.values(snapshot?.state?.connections || {}).find((connection) => (
    connection.source === providerKey
    && connection.status !== "disconnected"
    && connection.status !== "error"
  )) || null;
}

function getProviderSourceState(providerKey, snapshot = latestSnapshot) {
  return snapshot?.state?.sources?.[providerKey] || { status: "idle", last_event_at: null };
}

function getProviderAdapterKey(providerKey, snapshot = latestSnapshot) {
  const activeAdapters = snapshot?.runtime?.active_adapters || [];
  if (providerKey === "youtube") {
    return activeAdapters.find((adapterKey) => (
      adapterKey.startsWith("youtube-compat:")
      || adapterKey.startsWith("youtube:")
    )) || "";
  }

  return activeAdapters.find((adapterKey) => adapterKey.startsWith(`${providerKey}:`)) || "";
}

function getLatestProviderSystemEvent(providerKey, snapshot = latestSnapshot) {
  return (snapshot?.state?.system_events || []).find((event) => event.source === providerKey) || null;
}

function hasYouTubeRealtimeCredential(config) {
  return Boolean(config?.api_key || config?.access_token);
}

function getYouTubeRuntimeErrorPresentation(event) {
  const reason = event?.metadata?.reason || "";

  if (reason === "live_without_chat") {
    return {
      statusText: t("settings.status.liveWithoutChat"),
      statusClass: "info",
      badgeLabel: t("settings.status.liveWithoutChatBadge")
    };
  }

  if (reason === "members_only" || reason === "age_restricted" || reason === "private_live") {
    return {
      statusText: t("settings.status.restricted"),
      statusClass: "error",
      badgeLabel: t("settings.status.restricted")
    };
  }

  if (reason === "offline" || reason === "failed_to_resolve") {
    return {
      statusText: t("settings.status.failedResolve"),
      statusClass: "error",
      badgeLabel: t("settings.status.failedResolve")
    };
  }

  return {
    statusText: t("common.error"),
    statusClass: "error",
    badgeLabel: t("settings.status.compatFailed")
  };
}

function getRuntimeStatusLabel(providerKey, provider) {
  const runtimeConnection = getProviderRuntimeConnection(providerKey);
  const runtimeSource = getProviderSourceState(providerKey);
  const latestEvent = getLatestProviderSystemEvent(providerKey);
  const sourceIssueKind = runtimeSource.last_issue_kind || "";

  if (isConfirmedActiveConnection(runtimeConnection)) {
    return { text: t("common.active"), className: "runtime_connected" };
  }

  if (runtimeSource.status === "error" || sourceIssueKind === "source_error" || provider.auth_error) {
    if (providerKey === "youtube") {
      const errorPresentation = getYouTubeRuntimeErrorPresentation(latestEvent);
      return {
        text: errorPresentation.statusText,
        className: errorPresentation.statusClass
      };
    }
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

function renderSettingsProviderStrip(snapshot) {
  if (!settingsProviderList) return;

  settingsProviderList.innerHTML = "";
  for (const provider of snapshot.providers.filter((item) => PUBLIC_PROVIDER_KEYS.includes(item.provider))) {
    const runtimeStatus = getRuntimeStatusLabel(provider.provider, provider);
    const target = provider.target_label || "sem alvo";
    const isSelected = selectedProviderDetail === provider.provider;
    const card = document.createElement("button");
    card.type = "button";
    card.className = `provider-card provider-status-card provider-${provider.provider}`;
    card.style.setProperty("--accent", provider.accent_color);
    card.dataset.settingsProviderTrigger = provider.provider;
    card.setAttribute("aria-expanded", String(isSelected));
    card.setAttribute("aria-controls", `providerDetail-${provider.provider}`);
    card.setAttribute("title", t("settings.provider.openDetails", { provider: provider.label }));
    card.innerHTML = `
      <div class="provider-head">
        <span class="provider-logo" aria-hidden="true"><img src="${getProviderIconSrc(provider.provider)}" alt="" loading="lazy"></span>
        <strong>${escapeHtml(provider.label)}</strong>
        <span class="provider-state ${runtimeStatus.className}">${escapeHtml(runtimeStatus.text)}</span>
      </div>
      <p class="provider-identity">${escapeHtml(target)}</p>
    `;
    settingsProviderList.append(card);
  }
}

function syncProviderDetailState() {
  const hasSelection = Boolean(selectedProviderDetail);
  platformDetails?.classList.toggle("has-selection", hasSelection);
  platformDetails?.setAttribute("aria-hidden", String(!hasSelection));

  for (const providerKey of providerKeys) {
    const isExpanded = providerKey === selectedProviderDetail;
    const elements = providerCards[providerKey];
    if (!elements?.card) {
      continue;
    }

    elements.card.id = `providerDetail-${providerKey}`;
    elements.card.classList.toggle("is-expanded", isExpanded);
  }

  settingsProviderList?.querySelectorAll("[data-settings-provider-trigger]").forEach((trigger) => {
    const isExpanded = trigger.dataset.settingsProviderTrigger === selectedProviderDetail;
    const providerName = trigger.querySelector("strong")?.textContent || "plataforma";
    trigger.classList.toggle("is-selected", isExpanded);
    trigger.setAttribute("aria-expanded", String(isExpanded));
    trigger.setAttribute("title", t(isExpanded ? "settings.provider.closeDetails" : "settings.provider.openDetails", {
      provider: providerName
    }));
  });
}

function toggleProviderDetail(providerKey) {
  if (!providerCards[providerKey]) {
    return;
  }

  selectedProviderDetail = selectedProviderDetail === providerKey ? "" : providerKey;
  syncProviderDetailState();
}

function selectProviderDetail(providerKey, { scroll = false } = {}) {
  if (!providerCards[providerKey]) {
    return;
  }

  selectedProviderDetail = providerKey;
  syncProviderDetailState();
  if (scroll) {
    providerCards[providerKey].card.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function collapseProviderDetail() {
  if (!selectedProviderDetail) {
    return;
  }

  selectedProviderDetail = "";
  syncProviderDetailState();
}

function setOverlayWorkbenchExpanded(expanded) {
  overlayWorkbenchExpanded = Boolean(expanded);
  overlayWorkbench?.classList.toggle("is-collapsed", !overlayWorkbenchExpanded);

  overlayWorkbenchToggles.forEach((toggle) => {
    toggle.setAttribute("aria-expanded", String(overlayWorkbenchExpanded));
    const label = toggle.querySelector("[data-overlay-toggle-label]");
    if (label) {
      label.textContent = overlayWorkbenchExpanded ? t("common.close") : t("common.open");
    }
  });
}

function toggleOverlayWorkbench() {
  setOverlayWorkbenchExpanded(!overlayWorkbenchExpanded);
}

function renderProviderFeedback(providerKey, provider, config) {
  const container = providerCards[providerKey].feedback;
  const runtimeConnection = getProviderRuntimeConnection(providerKey);
  const runtimeSource = getProviderSourceState(providerKey);
  const latestEvent = getLatestProviderSystemEvent(providerKey);
  const sourceIssueKind = runtimeSource.last_issue_kind || "";
  const issueMessage = runtimeSource.last_issue_message || latestEvent?.message || provider.target_label;

  if (isConfirmedActiveConnection(runtimeConnection)) {
    container.hidden = false;
    container.innerHTML = `
      <p><span class="provider-state runtime_connected">${t("common.active")}</span></p>
      <p>${escapeHtml(runtimeConnection.channel_display_name || provider.target_label)}</p>
      <p class="provider-scopes">${escapeHtml(t("settings.provider.feedbackActive", {
        title: runtimeConnection.title || t("settings.provider.noTitle"),
        count: runtimeConnection.message_count
      }))}</p>
    `;
    return;
  }

  if (runtimeSource.status === "error" || sourceIssueKind === "source_error") {
    container.hidden = false;
    container.innerHTML = `
      <p><span class="provider-state error">${t("common.error")}</span></p>
      <p class="provider-error">${escapeHtml(issueMessage || t("settings.provider.startFailed"))}</p>
    `;
    return;
  }

  if (runtimeConnection?.live_status === "offline" || sourceIssueKind === "stream_ended") {
    container.hidden = false;
    container.innerHTML = `
      <p><span class="provider-state error">${t("common.offline")}</span></p>
      <p>${escapeHtml(runtimeConnection?.channel_display_name || provider.target_label)}</p>
      <p class="provider-scopes">${escapeHtml(issueMessage || t("settings.provider.liveEnded"))}</p>
    `;
    return;
  }

  if (runtimeSource.status === "disconnected" || sourceIssueKind === "source_disconnected") {
    container.hidden = false;
    container.innerHTML = `
      <p><span class="provider-state info">${t("common.disconnected")}</span></p>
      <p class="provider-scopes">${escapeHtml(issueMessage)}</p>
    `;
    return;
  }

  if (runtimeSource.status === "connecting") {
    container.hidden = false;
    container.innerHTML = `
      <p><span class="provider-state info">${t("common.connecting")}</span></p>
      <p>${escapeHtml(provider.target_label)}</p>
    `;
    return;
  }

  if (isPendingLiveConnection(runtimeConnection)) {
    container.hidden = false;
    container.innerHTML = `
      <p><span class="provider-state info">${t("common.pendingLive")}</span></p>
      <p>${escapeHtml(runtimeConnection.channel_display_name || provider.target_label)}</p>
      <p class="provider-scopes">${t("settings.provider.pendingText")}</p>
    `;
    return;
  }
  container.hidden = true;
  container.innerHTML = "";
}

function getProviderHeadline(providerKey, provider, config) {
  if (providerKey === "twitch") {
    return t("settings.provider.headlineTwitch");
  }

  if (providerKey === "youtube") {
    return t("settings.provider.headlineYoutube");
  }

  if (providerKey === "kick") {
    return t("settings.provider.headlineKick");
  }

  if (providerKey === "tiktok") {
    return t("settings.provider.headlineTiktok");
  }

  return PROVIDER_META[providerKey]?.defaultHeadlineKey ? t(PROVIDER_META[providerKey].defaultHeadlineKey) : "";
}

function renderProviderActions(providerKey, provider, config) {
  const container = providerCards[providerKey].actions;
  if (!container) {
    return;
  }

  if (!providerHasTarget(providerKey, config)) {
    container.hidden = true;
    container.innerHTML = "";
    return;
  }

  const sourceState = getProviderSourceState(providerKey);
  const primaryLabel = config.enabled ? t("settings.provider.pause") : t("settings.provider.resume");
  const canReconnect = !config.enabled || sourceState.status === "error" || sourceState.status === "disconnected";

  container.hidden = false;
  container.innerHTML = `
    <button type="button" class="action tiny ghost" data-source-action="toggle" data-provider-action="${providerKey}">${primaryLabel}</button>
    ${canReconnect ? `<button type="button" class="action tiny ghost" data-source-action="reconnect" data-provider-action="${providerKey}">${t("settings.provider.reconnect")}</button>` : ""}
    <button type="button" class="action tiny ghost" data-source-action="remove" data-provider-action="${providerKey}">${t("settings.provider.remove")}</button>
  `;
}

function renderProviderCard(providerKey, provider, config) {
  const elements = providerCards[providerKey];
  const runtimeStatus = getRuntimeStatusLabel(providerKey, provider);
  elements.card.style.setProperty("--accent", provider.accent_color);
  elements.copy.textContent = getProviderHeadline(providerKey, provider, config);

  elements.status.className = `provider-state ${runtimeStatus.className}`;
  elements.status.textContent = runtimeStatus.text;

  elements.method.className = `provider-state method-chip ${provider.method_key}`;
  elements.method.textContent = provider.method_label;

  elements.support.textContent = provider.support_label;
  elements.target.textContent = provider.target_label;
  elements.notes.innerHTML = provider.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("");

  renderProviderActions(providerKey, provider, config);
  renderProviderFeedback(providerKey, provider, config);
}

function renderConfigForms(snapshot) {
  const providers = snapshot.settings?.providers || {};
  const overlay = snapshot.settings?.overlay || {};
  const signature = JSON.stringify(providers);

  if (signature !== lastSettingsSignature) {
    applyProviderConfigToForm(providerForms.twitch, providers.twitch);
    applyProviderConfigToForm(providerForms.youtube, providers.youtube);
    applyProviderConfigToForm(providerForms.kick, providers.kick);
    applyProviderConfigToForm(providerForms.tiktok, providers.tiktok);
    applyProviderConfigToForm(providerOfficialForms.youtube, providers.youtube);
    lastSettingsSignature = signature;
  }

  const overlaySignature = JSON.stringify(overlay);
  if (overlaySignature !== lastOverlaySignature) {
    applyOverlayConfigToForm(overlay);
    renderOverlayDisplayOptions(overlay);
    lastOverlaySignature = overlaySignature;
  }
}

function renderOverlayDisplayOptions(config = overlayDraft) {
  if (!overlayDisplaySupport || !overlayDisplaySelect) {
    return;
  }

  if (!overlayDisplayState.supported) {
    overlayDisplaySupport.textContent = overlayDisplayState.reason || t("settings.overlay.displayUnavailable", {}, "Seleção real de monitor indisponível neste ambiente.");
    overlayDisplaySelect.hidden = true;
    overlayIdentifyDisplaysButton.hidden = true;
    overlayTestDisplayButton.hidden = true;
    return;
  }

  overlayDisplaySupport.textContent = t("settings.overlay.displayHelp", {}, "Selecione o monitor, identifique visualmente e teste o overlay antes de salvar.");
  overlayDisplaySelect.hidden = false;
  overlayIdentifyDisplaysButton.hidden = false;
  overlayTestDisplayButton.hidden = false;

  const selectedId = config?.display_id || "primary";
  overlayDisplaySelect.innerHTML = overlayDisplayState.displays.map((display) => `
    <option value="${escapeHtml(display.display_id)}">${escapeHtml(display.label)} · ${display.bounds.width}x${display.bounds.height}${display.primary ? ` · ${t("settings.overlay.primaryDisplay", {}, "principal")}` : ""}</option>
  `).join("");

  if (selectedId === "primary") {
    const primaryDisplay = overlayDisplayState.displays.find((display) => display.primary);
    overlayDisplaySelect.value = primaryDisplay?.display_id || overlayDisplayState.displays[0]?.display_id || "";
    return;
  }

  if (!overlayDisplayState.displays.some((display) => display.display_id === selectedId)) {
    overlayDisplaySelect.insertAdjacentHTML("afterbegin", `<option value="primary">${escapeHtml(t("settings.overlay.autoPrimary"))}</option>`);
  }

  overlayDisplaySelect.value = selectedId;
}

function getOverlayPatchFromForm() {
  const formData = new FormData(overlayConfigForm);
  const patch = {
    enabled: overlayConfigForm.elements.namedItem("enabled").checked,
    display_id: String(formData.get("display_id") || "primary"),
    position: String(formData.get("position") || "top-right"),
    offset_x: Number(formData.get("offset_x")),
    offset_y: Number(formData.get("offset_y")),
    duration_ms: Number(formData.get("duration_ms")),
    max_messages: Number(formData.get("max_messages")),
    font_size_px: Number(formData.get("font_size_px")),
    message_font_weight: String(formData.get("message_font_weight") || "semibold"),
    line_height: Number(formData.get("line_height")),
    card_width_px: Number(formData.get("card_width_px")),
    gap_px: Number(formData.get("gap_px")),
    background_opacity: Number(formData.get("background_opacity")),
    show_platform_badge: overlayConfigForm.elements.namedItem("show_platform_badge").checked,
    show_channel: overlayConfigForm.elements.namedItem("show_channel").checked,
    show_avatar: overlayConfigForm.elements.namedItem("show_avatar").checked,
    animation: String(formData.get("animation") || "fade"),
    filters: {
      messages: overlayConfigForm.elements.namedItem("filter_messages").checked,
      joins: overlayConfigForm.elements.namedItem("filter_joins").checked,
      audience_updates: overlayConfigForm.elements.namedItem("filter_audience_updates").checked,
      technical_events: overlayConfigForm.elements.namedItem("filter_technical_events").checked,
      platforms: Object.fromEntries(OVERLAY_PLATFORM_KEYS.map((key) => [
        key,
        overlayConfigForm.elements.namedItem(`platform_${key}`).checked
      ]))
    }
  };

  return patch;
}

function render(snapshot) {
  latestSnapshot = snapshot;
  renderRuntimeCard(runtimeCard, snapshot);
  renderSettingsProviderStrip(snapshot);
  renderConfigForms(snapshot);
  renderOverlayDisplayOptions(overlayDraft || snapshot.settings?.overlay);
  renderQuickStartContext();
  renderOverlayPreview(overlayDraft || snapshot.settings?.overlay);

  for (const providerKey of providerKeys) {
    renderProviderCard(
      providerKey,
      getProviderSummary(providerKey),
      getProviderConfig(providerKey)
    );
  }

  syncProviderDetailState();
  setOverlayWorkbenchExpanded(overlayWorkbenchExpanded);
  applyTranslations();
}

function normalizeProviderName(value) {
  return value.trim().replace(/^@/, "");
}

function parseIdentityForProvider(providerKey, rawValue, options = {}) {
  const value = normalizeProviderName(rawValue);
  if (!value) {
    throw new Error(t("validation.invalidChannel"));
  }

  if (providerKey === "tiktok") {
    const uniqueId = value.replace(/^@/, "");
    return {
      providerKey,
      rawInput: options.rawInput ?? rawValue,
      targetLabel: options.targetLabel ?? `@${uniqueId}`,
      patch: {
        channel: uniqueId,
        unique_id: uniqueId
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

  return parseIdentityForProvider("twitch", channel, {
    rawInput,
    targetLabel: channel
  });
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
  let channel = "";

  if (segments[0] === "popout" && segments[1]) {
    channel = segments[1];
  } else if (segments[0]) {
    channel = segments[0];
  }

  if (!channel) {
    throw new Error(t("validation.kickUrl"));
  }

  return parseIdentityForProvider("kick", channel, {
    rawInput,
    targetLabel: channel
  });
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

function parseQuickStartInput(rawInput, preferredProvider) {
  const trimmed = rawInput.trim();
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

    if (host.includes("twitch.tv")) {
      return parseTwitchUrl(url, trimmed);
    }
    if (host.includes("youtube.com") || host.includes("youtu.be")) {
      return parseYouTubeUrl(url, trimmed);
    }
    if (host.includes("kick.com")) {
      return parseKickUrl(url, trimmed);
    }
    if (host.includes("tiktok.com")) {
      return parseTikTokUrl(url, trimmed);
    }
  }

  if (trimmed.startsWith("@")) {
    return parseIdentityForProvider("youtube", trimmed);
  }

  if (/^UC[\w-]{10,}$/i.test(trimmed)) {
    return parseIdentityForProvider("youtube", trimmed);
  }

  if (preferredProvider) {
    return parseIdentityForProvider(preferredProvider, trimmed);
  }

  throw new Error(t("validation.unknownPlatformWithCard"));
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
    if (parsed.patch.broadcaster_user_id) {
      patch.broadcaster_user_id = parsed.patch.broadcaster_user_id;
    }
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
    if (parsed.patch.broadcaster_user_id) {
      patch.broadcaster_user_id = parsed.patch.broadcaster_user_id;
    }
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

async function saveOverlayConfig(event) {
  event.preventDefault();
  const payload = getOverlayPatchFromForm();

  const response = await fetchJson("/api/config/overlay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  render(response.snapshot);
  renderOverlayStatus(t("settings.overlay.saved"), t("settings.overlay.savedMessage"), "runtime_connected");
}

async function loadOverlayDisplays() {
  const payload = await fetchJson("/api/overlay/displays");
  overlayDisplayState = {
    supported: Boolean(payload.supported),
    displays: payload.displays || [],
    reason: payload.reason || ""
  };
  renderOverlayDisplayOptions();
}

async function identifyOverlayDisplays() {
  await fetchJson("/api/overlay/identify", {
    method: "POST"
  });
  renderOverlayStatus(t("settings.overlay.identifying"), t("settings.overlay.identifyingMessage"), "info");
}

async function testOverlayDisplay() {
  const payload = getOverlayPatchFromForm();
  const saved = await fetchJson("/api/config/overlay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  render(saved.snapshot);

  await fetchJson("/api/overlay/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ display_id: payload.display_id })
  });
  renderOverlayStatus(t("settings.overlay.testSent"), t("settings.overlay.testSentMessage"), "info");
}

async function resolveTikTokFormTarget() {
  const form = providerForms.tiktok;
  const quickInput = form.elements.namedItem("quick_input")?.value?.trim();
  const uniqueField = form.elements.namedItem("unique_id");
  const uniqueValue = uniqueField?.value?.trim();

  if (!quickInput && !uniqueValue) {
    return null;
  }

  const parsed = quickInput
    ? parseQuickStartInput(quickInput, "tiktok")
    : parseIdentityForProvider("tiktok", uniqueValue, {
        rawInput: uniqueValue,
        targetLabel: `@${normalizeProviderName(uniqueValue)}`
      });

  if (parsed.providerKey !== "tiktok") {
    throw new Error(t("validation.tiktokExpected"));
  }

  if (uniqueField) {
    uniqueField.value = parsed.patch.unique_id || parsed.patch.channel || "";
  }

  return parsed;
}

function getTikTokPatchFromForm() {
  const currentConfig = getProviderConfig("tiktok");
  const patch = normalizeProviderPatch(providerForms.tiktok);
  const uniqueId = normalizeProviderName(patch.unique_id || patch.channel || currentConfig.unique_id || currentConfig.channel || "");

  patch.setup_mode = "compatibility";
  patch.channel = uniqueId;
  patch.unique_id = uniqueId;
  patch.enabled = Boolean(patch.enabled);
  return patch;
}

async function handleTikTokPrepareConnection(event) {
  event.preventDefault();

  let resolved = null;
  try {
    resolved = await resolveTikTokFormTarget();
  } catch (error) {
    showProviderError("tiktok", error.message);
    return;
  }

  const patch = getTikTokPatchFromForm();
  if (!patch.unique_id) {
    showProviderError("tiktok", t("validation.tiktokMissing"));
    return;
  }

  patch.enabled = true;
  if (resolved?.rawInput) {
    patch.quick_input = resolved.rawInput;
  }

  const snapshot = await saveProviderConfig("tiktok", patch);
  render(snapshot);
  showProviderNotice(
    "tiktok",
    t("settings.notice.tiktokConnecting"),
    t("settings.notice.tiktokConnectingMessage", { target: patch.unique_id }),
    "info"
  );
}

async function handleProviderFormSubmit(providerKey, event) {
  event.preventDefault();
  const patch = normalizeProviderPatch(providerForms[providerKey]);
  patch.setup_mode = "advanced";
  const snapshot = await saveProviderConfig(providerKey, patch);
  render(snapshot);
}

async function handleSourceAction(providerKey, action) {
  const config = getProviderConfig(providerKey);
  let patch = {};

  if (action === "toggle") {
    patch = config.enabled
      ? buildProviderPausePatch(providerKey, config)
      : buildProviderReconnectPatch(providerKey, config);
  } else if (action === "reconnect") {
    patch = buildProviderReconnectPatch(providerKey, config);
  } else if (action === "remove") {
    patch = buildProviderRemovePatch(providerKey);
  } else {
    return;
  }

  const snapshot = await saveProviderConfig(providerKey, patch);
  render(snapshot);

  if (action === "remove") {
    showProviderNotice(
      providerKey,
      t("settings.notice.removed"),
      t("settings.notice.removedMessage", { provider: PROVIDER_META[providerKey].label }),
      "info"
    );
    return;
  }

  if (action === "toggle") {
    const provider = PROVIDER_META[providerKey].label;
    showProviderNotice(
      providerKey,
      config.enabled ? t("settings.notice.paused") : t("settings.notice.resuming"),
      config.enabled
        ? t("settings.notice.pauseMessage", { provider })
        : t("settings.notice.resumeMessage", { provider }),
      "info"
    );
    return;
  }

  showProviderNotice(
    providerKey,
    t("settings.notice.reconnecting"),
    t("settings.notice.reconnectMessage", { provider: PROVIDER_META[providerKey].label }),
    "info"
  );
}

async function handleOfficialProviderSubmit(providerKey, event) {
  event.preventDefault();
  const currentConfig = getProviderConfig(providerKey);
  const patch = normalizeProviderPatch(providerOfficialForms[providerKey]);

  if (providerKey === "youtube") {
    const hasTarget = Boolean(
      currentConfig.quick_input
      || currentConfig.channel
      || currentConfig.channel_id
    );
    const hasCredential = Boolean(
      patch.api_key
      || patch.access_token
      || currentConfig.api_key
      || currentConfig.access_token
    );

    if (!hasTarget) {
      throw new Error(t("validation.youtubeTargetFirst"));
    }

    if (!hasCredential) {
      throw new Error(t("validation.youtubeCredentialRequired"));
    }

    if (!patch.api_key && currentConfig.api_key) {
      delete patch.api_key;
    }

    if (!patch.access_token && currentConfig.access_token) {
      delete patch.access_token;
    }
  }

  patch.enabled = true;
  patch.setup_mode = "official";
  const snapshot = await saveProviderConfig(providerKey, patch);
  render(snapshot);
}

async function handleQuickStartSubmit(event) {
  event.preventDefault();

  try {
    const parsed = await maybeResolveQuickStart(
      parseQuickStartInput(quickStartInput.value, quickStartPreferredProvider)
    );
    const patch = buildCompatibilityPatch(parsed.providerKey, parsed);
    const snapshot = await saveProviderConfig(parsed.providerKey, patch);
    render(snapshot);
    if (parsed.providerKey === "twitch") {
      renderQuickStartStatus(t("settings.quick.twitchReady", { target: parsed.targetLabel }));
    } else if (parsed.providerKey === "youtube") {
      const youtubeConnection = getProviderRuntimeConnection("youtube", snapshot);
      const youtubeSource = getProviderSourceState("youtube", snapshot);
      const youtubeAdapter = getProviderAdapterKey("youtube", snapshot);
      const latestEvent = getLatestProviderSystemEvent("youtube", snapshot);
      if (isConfirmedActiveConnection(youtubeConnection) && youtubeAdapter.startsWith("youtube-compat:")) {
        renderQuickStartStatus(t("settings.quick.youtubeConnected", { target: parsed.targetLabel }));
      } else if (isConfirmedActiveConnection(youtubeConnection) && youtubeAdapter.startsWith("youtube:")) {
        renderQuickStartStatus(t("settings.quick.youtubeConnected", { target: parsed.targetLabel }));
      } else if (isPendingLiveConnection(youtubeConnection)) {
        renderQuickStartStatus(t("settings.quick.youtubePending", { target: parsed.targetLabel }), "info");
      } else if (youtubeSource.status === "connecting") {
        renderQuickStartStatus(t("settings.quick.youtubeConnecting", { target: parsed.targetLabel }));
      } else if (youtubeSource.status === "error" && latestEvent) {
        renderQuickStartStatus(latestEvent.message || t("settings.quick.youtubeFailed"), "error");
      } else {
        renderQuickStartStatus(t("settings.quick.youtubeReady", { target: parsed.targetLabel }));
      }
    } else if (parsed.providerKey === "tiktok") {
      renderQuickStartStatus(t("settings.quick.tiktokReady", { target: parsed.targetLabel }), "info");
    } else {
      renderQuickStartStatus(t("settings.quick.providerReady", {
        provider: PROVIDER_META[parsed.providerKey].label,
        target: parsed.targetLabel
      }));
    }
    quickStartPreferredProvider = parsed.providerKey;
    renderQuickStartContext();
  } catch (error) {
    renderQuickStartStatus(error.message, "error");
  }
}

function focusQuickStartForProvider(providerKey) {
  quickStartPreferredProvider = providerKey;
  renderQuickStartContext();
  clearQuickStartStatus();
  quickStartInput.focus();
  quickStartInput.scrollIntoView({ behavior: "smooth", block: "center" });
}

function applyInitialProviderFocus() {
  const params = new URLSearchParams(window.location.search);
  const providerKey = params.get("provider");
  if (!providerKeys.includes(providerKey)) {
    return;
  }

  selectProviderDetail(providerKey);
  if (params.get("focus") === "quickstart") {
    focusQuickStartForProvider(providerKey);
  }
}

function openAdvancedForProvider(providerKey) {
  const details = providerDetails[providerKey];
  details.open = true;
  details.scrollIntoView({ behavior: "smooth", block: "start" });
}

function openOfficialForProvider(providerKey) {
  const details = providerOfficialDetails[providerKey];
  if (!details) {
    return openAdvancedForProvider(providerKey);
  }

  details.open = true;
  details.scrollIntoView({ behavior: "smooth", block: "start" });
}

function showProviderError(providerKey, errorMessage) {
  const container = providerCards[providerKey].feedback;
  container.hidden = false;
  container.innerHTML = `
    <p><span class="provider-state error">${t("settings.provider.fixNeeded")}</span></p>
    <p class="provider-error">${escapeHtml(errorMessage)}</p>
  `;
}

function showProviderNotice(providerKey, label, message, tone = "info") {
  const container = providerCards[providerKey].feedback;
  container.hidden = false;
  container.innerHTML = `
    <p><span class="provider-state ${tone}">${escapeHtml(label)}</span></p>
    <p>${escapeHtml(message)}</p>
  `;
}

async function startTwitchOauth() {
  try {
    const patch = normalizeProviderPatch(providerForms.twitch);
    patch.setup_mode = "advanced";
    const snapshot = await saveProviderConfig("twitch", patch);
    render(snapshot);

    const payload = await fetchJson("/api/providers/twitch/oauth/start", {
      method: "POST"
    });
    window.open(payload.authorization_url, "_blank", "noopener,noreferrer");
  } catch (error) {
    showProviderError("twitch", error.message);
    openAdvancedForProvider("twitch");
  }
}

async function validateTwitchToken() {
  try {
    const payload = await fetchJson("/api/providers/twitch/token/validate", {
      method: "POST"
    });
    render(payload.snapshot);
  } catch (error) {
    showProviderError("twitch", error.message);
  }
}

async function boot() {
  installMessagePartImageFallback();
  setOverlayWorkbenchExpanded(false);
  const initialSnapshot = await fetchSnapshot();
  initI18n(initialSnapshot);
  await loadOverlayDisplays();
  bindLanguageSwitcher({
    onChange: () => {
      if (latestSnapshot) {
        render(latestSnapshot);
      }
    }
  });
  render(initialSnapshot);
  applyInitialProviderFocus();
  createEventStream(render);

  quickStartForm.addEventListener("submit", handleQuickStartSubmit);
  quickStartAutoDetectButton.addEventListener("click", () => {
    quickStartPreferredProvider = "";
    renderQuickStartContext();
    clearQuickStartStatus();
    quickStartInput.focus();
  });

  settingsProviderList?.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-settings-provider-trigger]");
    if (!trigger) {
      return;
    }

    toggleProviderDetail(trigger.dataset.settingsProviderTrigger);
  });

  settingsProviderList?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    const trigger = event.target.closest("[data-settings-provider-trigger]");
    if (!trigger) {
      return;
    }

    event.preventDefault();
    toggleProviderDetail(trigger.dataset.settingsProviderTrigger);
  });

  providerForms.twitch.addEventListener("submit", async (event) => {
    try {
      await handleProviderFormSubmit("twitch", event);
    } catch (error) {
      showProviderError("twitch", error.message);
    }
  });

  providerForms.youtube.addEventListener("submit", async (event) => {
    try {
      await handleProviderFormSubmit("youtube", event);
    } catch (error) {
      showProviderError("youtube", error.message);
    }
  });

  providerOfficialForms.youtube.addEventListener("submit", async (event) => {
    try {
      await handleOfficialProviderSubmit("youtube", event);
    } catch (error) {
      showProviderError("youtube", error.message);
    }
  });

  providerForms.kick.addEventListener("submit", async (event) => {
    try {
      await handleProviderFormSubmit("kick", event);
    } catch (error) {
      showProviderError("kick", error.message);
    }
  });

  providerForms.tiktok.addEventListener("submit", async (event) => {
    try {
      await handleTikTokPrepareConnection(event);
    } catch (error) {
      showProviderError("tiktok", error.message);
    }
  });

  overlayConfigForm.addEventListener("submit", saveOverlayConfig);
  overlayConfigForm.addEventListener("input", () => {
    overlayDraft = getOverlayPatchFromForm();
    renderOverlayPreview(overlayDraft);
  });
  overlayConfigForm.addEventListener("change", () => {
    overlayDraft = getOverlayPatchFromForm();
    renderOverlayPreview(overlayDraft);
  });
  document.querySelector("#twitchValidateButton").addEventListener("click", validateTwitchToken);
  overlayIdentifyDisplaysButton?.addEventListener("click", async () => {
    try {
      await identifyOverlayDisplays();
    } catch (error) {
    renderOverlayStatus(t("common.error"), error.message, "error");
    }
  });
  overlayTestDisplayButton?.addEventListener("click", async () => {
    try {
      await testOverlayDisplay();
    } catch (error) {
      renderOverlayStatus(t("common.error"), error.message, "error");
    }
  });
  overlayWorkbenchToggles.forEach((toggle) => {
    toggle.addEventListener("click", toggleOverlayWorkbench);
  });
  document.querySelector("#tiktokResolveButton").addEventListener("click", async () => {
    try {
      const resolved = await resolveTikTokFormTarget();
      showProviderNotice(
        "tiktok",
        t("settings.notice.tiktokResolved"),
        resolved
          ? t("settings.notice.tiktokResolvedMessage", { target: resolved.targetLabel })
          : t("settings.notice.tiktokResolveMissing"),
        "info"
      );
    } catch (error) {
      showProviderError("tiktok", error.message);
    }
  });
  document.querySelectorAll("[data-provider-connect]").forEach((button) => {
    button.addEventListener("click", startTwitchOauth);
  });
  document.querySelectorAll("[data-provider-quick]").forEach((button) => {
    button.addEventListener("click", () => focusQuickStartForProvider(button.dataset.providerQuick));
  });
  document.querySelectorAll("[data-provider-advanced]").forEach((button) => {
    button.addEventListener("click", () => openAdvancedForProvider(button.dataset.providerAdvanced));
  });
  document.querySelectorAll("[data-provider-official]").forEach((button) => {
    button.addEventListener("click", () => openOfficialForProvider(button.dataset.providerOfficial));
  });

  document.addEventListener("click", (event) => {
    if (!selectedProviderDetail) {
      return;
    }

    if (event.target.closest?.("#settingsProviderList, #platformDetails")) {
      return;
    }

    collapseProviderDetail();
  });

  document.addEventListener("click", async (event) => {
    const actionButton = event.target.closest("[data-source-action]");
    if (!actionButton) {
      return;
    }

    actionButton.disabled = true;
    try {
      await handleSourceAction(actionButton.dataset.providerAction, actionButton.dataset.sourceAction);
    } catch (error) {
      showProviderError(actionButton.dataset.providerAction, error.message);
    } finally {
      setTimeout(() => {
        actionButton.disabled = false;
      }, 300);
    }
  });
}

boot().catch((error) => {
  runtimeCard.innerHTML = `<strong>${t("about.bootFailed")}</strong><span class="runtime-meta">${error.message}</span>`;
});
