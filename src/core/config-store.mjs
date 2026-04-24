//        __     __                   
// _|_   (_ ||\/|__) /\ _ _ _ _|   _  
//  |    __)||  |__)/--|_| (_(_||_|/_ 
//                     |  

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveBundledRuntimeDir, resolveRuntimeDir } from "./runtime-paths.mjs";

function normalizeProviderSetupMode(providerKey, providerConfig = {}) {
  if (providerKey !== "youtube") {
    return {
      ...providerConfig
    };
  }

  const nextConfig = {
    ...providerConfig
  };

  if (nextConfig.setup_mode === "quick_start") {
    nextConfig.setup_mode = "compatibility";
  }

  return nextConfig;
}

const ALLOWED_SOURCE_FILTERS = new Set(["all", "replay", "twitch", "youtube", "kick", "tiktok"]);
const ALLOWED_UI_LANGUAGES = new Set(["pt-BR", "en", "es"]);
const ALLOWED_OVERLAY_POSITIONS = new Set(["top-left", "top-right", "bottom-left", "bottom-right"]);
const ALLOWED_OVERLAY_ANIMATIONS = new Set(["fade", "none"]);
const ALLOWED_OVERLAY_FONT_WEIGHTS = new Set(["regular", "semibold", "bold"]);
const OVERLAY_PLATFORM_KEYS = ["twitch", "youtube", "kick", "tiktok"];

function normalizeActiveSourceFilter(value) {
  return ALLOWED_SOURCE_FILTERS.has(value) ? value : "all";
}

function normalizeUiLanguage(value) {
  return ALLOWED_UI_LANGUAGES.has(value) ? value : "pt-BR";
}

function normalizeBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function normalizeFloat(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function normalizeOverlayFontWeight(value, fallback) {
  return ALLOWED_OVERLAY_FONT_WEIGHTS.has(value) ? value : fallback;
}

function createDefaultOverlayConfig() {
  return {
    enabled: true,
    display_id: "primary",
    position: "top-right",
    offset_x: 32,
    offset_y: 96,
    duration_ms: 15000,
    max_messages: 6,
    font_size_px: 18,
    message_font_weight: "semibold",
    line_height: 1.25,
    card_width_px: 320,
    gap_px: 6,
    background_opacity: 85,
    show_platform_badge: true,
    show_channel: true,
    show_avatar: false,
    animation: "fade",
    filters: {
      messages: true,
      joins: false,
      audience_updates: false,
      technical_events: false,
      platforms: Object.fromEntries(OVERLAY_PLATFORM_KEYS.map((key) => [key, true]))
    }
  };
}

function normalizeOverlayPlatforms(rawPlatforms = {}) {
  const defaults = createDefaultOverlayConfig().filters.platforms;
  return Object.fromEntries(OVERLAY_PLATFORM_KEYS.map((key) => [
    key,
    typeof rawPlatforms?.[key] === "boolean" ? rawPlatforms[key] : defaults[key]
  ]));
}

function normalizeOverlayConfig(rawOverlay = {}) {
  const defaults = createDefaultOverlayConfig();
  const migratedDurationMs = rawOverlay.duration_ms
    ?? (Number.isFinite(Number(rawOverlay.message_duration_seconds))
      ? Number(rawOverlay.message_duration_seconds) * 1000
      : undefined);

  return {
    enabled: normalizeBoolean(rawOverlay.enabled, defaults.enabled),
    display_id: typeof rawOverlay.display_id === "string" && rawOverlay.display_id.trim()
      ? rawOverlay.display_id.trim()
      : defaults.display_id,
    position: ALLOWED_OVERLAY_POSITIONS.has(rawOverlay.position) ? rawOverlay.position : defaults.position,
    offset_x: normalizeInteger(rawOverlay.offset_x, defaults.offset_x, -4000, 4000),
    offset_y: normalizeInteger(rawOverlay.offset_y, defaults.offset_y, -4000, 4000),
    duration_ms: normalizeInteger(migratedDurationMs, defaults.duration_ms, 1000, 300000),
    max_messages: normalizeInteger(rawOverlay.max_messages, defaults.max_messages, 1, 250),
    font_size_px: normalizeInteger(rawOverlay.font_size_px, defaults.font_size_px, 10, 48),
    message_font_weight: normalizeOverlayFontWeight(rawOverlay.message_font_weight, defaults.message_font_weight),
    line_height: normalizeFloat(rawOverlay.line_height, defaults.line_height, 1, 2.4),
    card_width_px: normalizeInteger(rawOverlay.card_width_px, defaults.card_width_px, 280, 1200),
    gap_px: normalizeInteger(rawOverlay.gap_px, defaults.gap_px, 0, 64),
    background_opacity: normalizeInteger(rawOverlay.background_opacity, defaults.background_opacity, 0, 100),
    show_platform_badge: normalizeBoolean(rawOverlay.show_platform_badge, defaults.show_platform_badge),
    show_channel: normalizeBoolean(rawOverlay.show_channel, defaults.show_channel),
    show_avatar: normalizeBoolean(rawOverlay.show_avatar, defaults.show_avatar),
    animation: ALLOWED_OVERLAY_ANIMATIONS.has(rawOverlay.animation) ? rawOverlay.animation : defaults.animation,
    filters: {
      messages: normalizeBoolean(rawOverlay.filters?.messages, defaults.filters.messages),
      joins: normalizeBoolean(rawOverlay.filters?.joins, defaults.filters.joins),
      audience_updates: normalizeBoolean(rawOverlay.filters?.audience_updates, defaults.filters.audience_updates),
      technical_events: normalizeBoolean(rawOverlay.filters?.technical_events, defaults.filters.technical_events),
      platforms: normalizeOverlayPlatforms(rawOverlay.filters?.platforms || {})
    }
  };
}

function normalizeProviders(rawProviders = {}) {
  return {
    twitch: normalizeProviderSetupMode("twitch", rawProviders.twitch || {}),
    youtube: normalizeProviderSetupMode("youtube", rawProviders.youtube || {}),
    kick: normalizeProviderSetupMode("kick", rawProviders.kick || {}),
    tiktok: normalizeProviderSetupMode("tiktok", rawProviders.tiktok || {})
  };
}

function normalizeStoredConfig(rawConfig) {
  if (!rawConfig || typeof rawConfig !== "object") {
    return rawConfig;
  }

  return {
    ...rawConfig,
    overlay: normalizeOverlayConfig(rawConfig.overlay || {}),
    ui: {
      ...(rawConfig.ui || {}),
      active_source_filter: normalizeActiveSourceFilter(rawConfig.ui?.active_source_filter),
      language: normalizeUiLanguage(rawConfig.ui?.language),
      onboarding_seen: rawConfig.ui?.onboarding_seen === true
    },
    providers: normalizeProviders(rawConfig.providers || {})
  };
}

export function createDefaultConfig() {
    return {
      runtime: {
        port: 4310,
        auto_start_demo: false
      },
    overlay: createDefaultOverlayConfig(),
    ui: {
        active_source_filter: "all",
        language: "pt-BR",
        onboarding_seen: false,
        hotkeys: {
          show_all: "Alt+0",
          filter_twitch: "Alt+1",
          filter_youtube: "Alt+2",
          filter_kick: "Alt+3",
          filter_tiktok: "Alt+4",
          start_demo: "Alt+D",
          start_replay: "Alt+R",
          open_overlay: "Botao Abrir Overlay"
        }
    },
    providers: {
      twitch: {
        enabled: false,
        channel: "",
        broadcaster_user_id: "",
        client_id: "",
        client_secret: "",
        redirect_uri: "http://localhost:4310/auth/twitch/callback",
        setup_mode: "",
        quick_input: "",
        access_token: "",
        refresh_token: "",
        scopes: [],
        display_name: "",
        login_name: "",
        token_expires_at: "",
        token_last_validated_at: "",
        auth_status: "idle",
        auth_error: ""
      },
      youtube: {
        enabled: false,
        channel: "",
        channel_id: "",
        api_key: "",
        client_id: "",
        client_secret: "",
        setup_mode: "",
        quick_input: "",
        access_token: "",
        refresh_token: ""
      },
      kick: {
        enabled: false,
        channel: "",
        broadcaster_user_id: "",
        client_id: "",
        client_secret: "",
        setup_mode: "",
        quick_input: "",
        access_token: "",
        refresh_token: "",
        webhook_public_url: ""
      },
      tiktok: {
        enabled: false,
        channel: "",
        unique_id: "",
        quick_input: "",
        setup_mode: ""
      }
    }
  };
}

export class ConfigStore {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.runtimeDir = resolveRuntimeDir(rootDir);
    this.bundledRuntimeDir = resolveBundledRuntimeDir(rootDir);
    this.publicConfigPath = path.join(this.runtimeDir, "monitor-config.json");
    this.bundledPublicConfigPath = path.join(this.bundledRuntimeDir, "monitor-config.json");
    this.localConfigPath = path.join(this.runtimeDir, "monitor-config.local.json");
    this.config = createDefaultConfig();
  }

  async load() {
    await mkdir(this.runtimeDir, { recursive: true });
    const defaults = createDefaultConfig();
    let publicConfig = await this.readConfigFile(this.publicConfigPath);
    if (!publicConfig && this.bundledPublicConfigPath !== this.publicConfigPath) {
      publicConfig = await this.readConfigFile(this.bundledPublicConfigPath);
    }
    let localConfig = await this.readConfigFile(this.localConfigPath);

    if (!publicConfig) {
      publicConfig = defaults;
      await this.writeConfigFile(this.publicConfigPath, defaults);
    }

    const normalizedPublicConfig = normalizeStoredConfig(publicConfig);
    if (publicConfig && JSON.stringify(normalizedPublicConfig) !== JSON.stringify(publicConfig)) {
      publicConfig = normalizedPublicConfig;
      await this.writeConfigFile(this.publicConfigPath, publicConfig);
    }

    const normalizedLocalConfig = normalizeStoredConfig(localConfig);
    if (localConfig && JSON.stringify(normalizedLocalConfig) !== JSON.stringify(localConfig)) {
      localConfig = normalizedLocalConfig;
      await this.writeConfigFile(this.localConfigPath, localConfig);
    }

    // One-time migration: keep the public config clean and move any existing
    // local/operator-specific state into the private local override file.
    if (!localConfig && this.hasUserOverrides(publicConfig)) {
      localConfig = this.mergeWithDefaults(publicConfig);
      await this.writeConfigFile(this.localConfigPath, localConfig);
      await this.writeConfigFile(this.publicConfigPath, defaults);
      publicConfig = defaults;
    }

    this.config = this.mergeWithDefaults({
      ...publicConfig,
      runtime: {
        ...(publicConfig.runtime || {}),
        ...(localConfig?.runtime || {})
      },
      overlay: {
        ...normalizeOverlayConfig(publicConfig.overlay || {}),
        ...normalizeOverlayConfig(localConfig?.overlay || {})
      },
      ui: {
        ...(publicConfig.ui || {}),
        ...(localConfig?.ui || {}),
        hotkeys: {
          ...(publicConfig.ui?.hotkeys || {}),
          ...(localConfig?.ui?.hotkeys || {})
        }
      },
      providers: {
        twitch: {
          ...(publicConfig.providers?.twitch || {}),
          ...(localConfig?.providers?.twitch || {})
        },
        youtube: {
          ...(publicConfig.providers?.youtube || {}),
          ...(localConfig?.providers?.youtube || {})
        },
        kick: {
          ...(publicConfig.providers?.kick || {}),
          ...(localConfig?.providers?.kick || {})
        },
        tiktok: {
          ...(publicConfig.providers?.tiktok || {}),
          ...(localConfig?.providers?.tiktok || {})
        }
      }
    });

    return this.getConfig();
  }

  async readConfigFile(filePath) {
    try {
      const raw = await readFile(filePath, "utf8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async writeConfigFile(filePath, payload) {
    await writeFile(filePath, JSON.stringify(payload, null, 2));
  }

  hasUserOverrides(rawConfig = {}) {
    const normalized = this.mergeWithDefaults(rawConfig);
    return JSON.stringify(normalized) !== JSON.stringify(createDefaultConfig());
  }

  mergeWithDefaults(rawConfig) {
    const defaults = createDefaultConfig();
    const normalizedProviders = normalizeProviders(rawConfig.providers || {});

    return {
      ...defaults,
      ...rawConfig,
      runtime: {
        ...defaults.runtime,
        ...(rawConfig.runtime || {})
      },
      overlay: {
        ...defaults.overlay,
        ...normalizeOverlayConfig(rawConfig.overlay || {})
      },
      ui: {
        ...defaults.ui,
        ...(rawConfig.ui || {}),
        active_source_filter: normalizeActiveSourceFilter(rawConfig.ui?.active_source_filter),
        language: normalizeUiLanguage(rawConfig.ui?.language),
        onboarding_seen: rawConfig.ui?.onboarding_seen === true,
        hotkeys: {
          ...defaults.ui.hotkeys,
          ...(rawConfig.ui?.hotkeys || {})
        }
      },
      providers: {
        twitch: {
          ...defaults.providers.twitch,
          ...normalizedProviders.twitch
        },
        youtube: {
          ...defaults.providers.youtube,
          ...normalizedProviders.youtube
        },
        kick: {
          ...defaults.providers.kick,
          ...normalizedProviders.kick
        },
        tiktok: {
          ...defaults.providers.tiktok,
          ...normalizedProviders.tiktok
        }
      }
    };
  }

  async save(nextConfig = this.config) {
    this.config = this.mergeWithDefaults(nextConfig);
    await mkdir(this.runtimeDir, { recursive: true });
    await this.writeConfigFile(this.localConfigPath, this.config);
    const publicConfig = await this.readConfigFile(this.publicConfigPath);
    if (!publicConfig) {
      await this.writeConfigFile(this.publicConfigPath, createDefaultConfig());
    }
    return this.getConfig();
  }

  getConfigPaths() {
    return {
      public: this.publicConfigPath,
      local: this.localConfigPath
    };
  }

  getConfig() {
    return structuredClone(this.config);
  }

  getProviderConfig(providerKey) {
    return structuredClone(this.config.providers?.[providerKey] || {});
  }

  async updateProviderConfig(providerKey, patch) {
    this.config = this.getConfig();
    this.config.providers[providerKey] = {
      ...this.config.providers[providerKey],
      ...patch
    };
    return this.save(this.config);
  }

  async updateUiConfig(patch) {
    this.config = this.getConfig();
    this.config.ui = {
      ...this.config.ui,
      ...patch
    };
    return this.save(this.config);
  }

  async updateRuntimeConfig(patch) {
    this.config = this.getConfig();
    this.config.runtime = {
      ...this.config.runtime,
      ...patch
    };
    return this.save(this.config);
  }

  async updateOverlayConfig(patch) {
    this.config = this.getConfig();
    this.config.overlay = {
      ...this.config.overlay,
      ...patch
    };
    return this.save(this.config);
  }
}
