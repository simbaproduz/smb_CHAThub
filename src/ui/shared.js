//        __     __                   
// _|_   (_ ||\/|__) /\ _ _ _ _|   _  
//  |    __)||  |__)/--|_| (_(_||_|/_ 
//                     |  

import {
  getCurrentLocale,
  t
} from "./i18n.js";

export const PUBLIC_PROVIDER_KEYS = ["twitch", "youtube", "kick", "tiktok"];
const PUBLIC_PROVIDER_LABELS = {
  twitch: "Twitch",
  youtube: "YouTube",
  kick: "Kick",
  tiktok: "TikTok"
};

export function isPublicProviderKey(providerKey) {
  return PUBLIC_PROVIDER_KEYS.includes(providerKey);
}

function isPublicAdapterKey(adapterKey) {
  return adapterKey === "demo"
    || adapterKey === "replay"
    || PUBLIC_PROVIDER_KEYS.some((providerKey) => (
      providerKey === "youtube"
        ? adapterKey.startsWith("youtube:")
          || adapterKey.startsWith("youtube-compat:")
        : adapterKey.startsWith(`${providerKey}:`)
    ));
}

export function isConfirmedActiveConnection(connection) {
  return Boolean(
    connection
    && connection.status === "connected"
    && connection.live_status !== "offline"
    && (
      connection.live_status === "live"
      || Number(connection.message_count || 0) > 0
    )
  );
}

export function isPendingLiveConnection(connection) {
  return Boolean(
    connection
    && connection.status === "connected"
    && connection.live_status !== "offline"
    && !isConfirmedActiveConnection(connection)
  );
}

export async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || t("common.errorFallback"));
  }
  return payload;
}

export async function fetchSnapshot() {
  const payload = await fetchJson("/api/snapshot");
  return payload.snapshot;
}

export async function postAction(action) {
  await fetchJson(`/api/actions/${action}`, { method: "POST" });
}

export async function saveProviderConfig(providerKey, patch) {
  const payload = await fetchJson(`/api/config/providers/${providerKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  });
  return payload.snapshot;
}

export function createEventStream(onSnapshot) {
  const eventSource = new EventSource("/api/stream");
  eventSource.onmessage = (event) => {
    onSnapshot(JSON.parse(event.data));
  };
  return eventSource;
}

export function formatTimestamp(value) {
  if (!value) return "--:--";
  return new Date(value).toLocaleTimeString(getCurrentLocale(), {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

export function normalizeProviderPatch(formElement) {
  const formData = new FormData(formElement);
  const patch = {};
  for (const [key, value] of formData.entries()) {
    patch[key] = typeof value === "string" ? value.trim() : value;
  }
  const enabledCheckbox = formElement.querySelector('input[name="enabled"]');
  if (enabledCheckbox) {
    patch.enabled = enabledCheckbox.checked;
  }
  return patch;
}

export function applyProviderConfigToForm(form, config) {
  if (!form || !config) return;
  form.reset();
  for (const [key, value] of Object.entries(config)) {
    const field = form.elements.namedItem(key);
    if (!field) continue;
    if (field.type === "checkbox") {
      field.checked = Boolean(value);
    } else if (typeof value === "string" || typeof value === "number") {
      field.value = value ?? "";
    }
  }
}

export function renderRuntimeCard(container, snapshot) {
  const publicAdapters = (snapshot.runtime.active_adapters || []).filter(isPublicAdapterKey);
  const activeConnections = Object.values(snapshot.state.connections || {})
    .filter((connection) => isPublicProviderKey(connection.source));
  const connectedConnections = activeConnections.filter((connection) => connection.status === "connected");
  const liveConnections = connectedConnections.filter(isConfirmedActiveConnection);
  const connectingConnections = activeConnections.filter((connection) => connection.status === "connecting");
  const failedSources = new Set(Object.entries(snapshot.state.sources || {})
    .filter(([source, sourceState]) => isPublicProviderKey(source) && sourceState?.status === "error")
    .map(([source]) => source));
  let runtimeTruth = {
    label: t("runtime.offline"),
    note: t("runtime.awaitingRealSource"),
    tone: "info"
  };
  const connectedLabels = [...new Set(liveConnections.map((connection) => connection.platform_label))];
  const activeSummary = connectedLabels.join(" · ") || t("runtime.noSource");
  const liveSources = new Set(liveConnections.map((connection) => connection.source));
  const issueSources = new Set();
  for (const [source, sourceState] of Object.entries(snapshot.state.sources || {})) {
    if (!isPublicProviderKey(source)) continue;
    if (liveSources.has(source)) continue;
    if (
      sourceState?.status === "error"
      || sourceState?.status === "disconnected"
      || sourceState?.last_issue_kind
    ) {
      issueSources.add(source);
    }
  }
  for (const connection of activeConnections) {
    if (connection.live_status === "offline") {
      issueSources.add(connection.source);
    }
  }
  const issueLabels = [...issueSources].map((source) => {
    const connection = activeConnections.find((item) => item.source === source);
    return connection?.platform_label || PUBLIC_PROVIDER_LABELS[source] || source;
  });
  const issueSummary = issueLabels.length > 0 ? issueLabels.join(" · ") : t("runtime.noActiveError");

  if (publicAdapters.includes("demo")) {
    runtimeTruth = {
      label: t("runtime.demo"),
      note: t("runtime.demoNote"),
      tone: "info"
    };
  } else if (publicAdapters.includes("replay")) {
    runtimeTruth = {
      label: t("runtime.replay"),
      note: t("runtime.replayNote"),
      tone: "info"
    };
  } else if (liveConnections.length > 0) {
    runtimeTruth = {
      label: t("runtime.realConnected"),
      note: t("runtime.liveSources", { count: liveConnections.length }),
      tone: "live"
    };
  } else if (connectingConnections.length > 0) {
    runtimeTruth = {
      label: t("runtime.connecting"),
      note: t("runtime.startingSources", { count: connectingConnections.length }),
      tone: "info"
    };
  } else if (failedSources.size > 0 || issueSources.size > 0) {
    runtimeTruth = {
      label: t("runtime.attention"),
      note: t("runtime.needsAttention", { count: issueSources.size || failedSources.size }),
      tone: "error"
    };
  } else if (publicAdapters.length > 0) {
    runtimeTruth = {
      label: t("runtime.initializing"),
      note: t("runtime.adapterActive"),
      tone: "info"
    };
  }

  container.innerHTML = `
    <div class="runtime-block runtime-truth ${runtimeTruth.tone}">
      <span class="runtime-label">${t("runtime.status")}</span>
      <strong>${runtimeTruth.label}</strong>
      <span class="runtime-meta">${runtimeTruth.note}</span>
    </div>
    <div class="runtime-block">
      <span class="runtime-label">${t("runtime.activeSources")}</span>
      <strong>${liveConnections.length}</strong>
      <span class="runtime-meta">${activeSummary}</span>
    </div>
    <div class="runtime-block">
      <span class="runtime-label">${t("runtime.attentions")}</span>
      <strong>${issueSources.size}</strong>
      <span class="runtime-meta">${issueSummary}</span>
    </div>
  `;
}

export function bindGlobalActionButtons({
  onError
} = {}) {
  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await postAction(button.dataset.action);
      } catch (error) {
        onError?.(error);
      } finally {
        setTimeout(() => {
          button.disabled = false;
        }, 300);
      }
    });
  });
}

export function renderHotkeysList(container, hotkeys = {}) {
  const entries = [
    { key: hotkeys.show_all, action: t("hotkeys.show_all") },
    { key: hotkeys.filter_twitch, action: t("hotkeys.filter_twitch") },
    { key: hotkeys.filter_youtube, action: t("hotkeys.filter_youtube") },
    { key: hotkeys.filter_kick, action: t("hotkeys.filter_kick") },
    { key: hotkeys.filter_tiktok, action: t("hotkeys.filter_tiktok") }
  ].filter((entry) => entry.key);

  container.innerHTML = entries.map((entry) => `
    <div class="hotkey-row">
      <kbd>${entry.key}</kbd>
      <span>${entry.action}</span>
    </div>
  `).join("");
}
