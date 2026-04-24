//        __     __                   
// _|_   (_ ||\/|__) /\ _ _ _ _|   _  
//  |    __)||  |__)/--|_| (_(_||_|/_ 
//                     |  

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { ConfigStore } from "./config-store.mjs";
import { MonitorStore } from "./monitor-store.mjs";
import { ReleaseLogger } from "./release-logger.mjs";
import { getProviderSummary } from "../adapters/provider-scaffolds.mjs";
import { DemoMultiStreamAdapter } from "../adapters/demo-multistream-adapter.mjs";
import { ReplayAdapter } from "../adapters/replay-adapter.mjs";
import { TwitchChatAdapter } from "../adapters/twitch-chat-adapter.mjs";
import { YouTubeCompatAdapter, canStartYouTubeCompatibility } from "../adapters/youtube-compat-adapter.mjs";
import { YouTubeLiveAdapter, canStartYouTubeRealtime } from "../adapters/youtube-live-adapter.mjs";
import { KickChatAdapter, canStartKickCompatibility, normalizeKickChannelInput } from "../adapters/kick-chat-adapter.mjs";
import { TikTokChatAdapter, canStartTikTokCompatibility } from "../adapters/tiktok-chat-adapter.mjs";

export class MonitorRuntime extends EventEmitter {
  constructor(rootDir) {
    super();
    this.rootDir = rootDir;
    this.store = new MonitorStore();
    this.configStore = new ConfigStore(rootDir);
    this.logger = new ReleaseLogger(rootDir);
    this.adapters = new Map();
    this.port = 4310;

    this.store.on("change", () => {
      this.emit("change", this.getSnapshot());
    });
  }

  async boot({ forceDemo = false } = {}) {
    const config = await this.configStore.load();
    this.port = config.runtime?.port || 4310;

    if (forceDemo || config.runtime?.auto_start_demo) {
      await this.startDemo();
    } else {
      await this.syncConfiguredProviders();
    }

    await this.logger.info("runtime_boot", "Runtime inicializado", {
      port: this.port,
      active_adapters: [...this.adapters.keys()]
    });

    return this.getSnapshot();
  }

  getRuntimeInfo() {
    const configPaths = this.configStore.getConfigPaths();
    return {
      port: this.port,
      config_path: configPaths.local,
      config_public_path: configPaths.public,
      active_adapters: [...this.adapters.keys()]
    };
  }

  getProviderSummaries() {
    const config = this.configStore.getConfig();
    return Object.entries(config.providers).map(([providerKey, providerConfig]) => (
      getProviderSummary(providerKey, providerConfig)
    ));
  }

  getConfig() {
    return this.configStore.getConfig();
  }

  async updateProviderConfig(providerKey, patch) {
    await this.configStore.updateProviderConfig(providerKey, patch);
    await this.syncConfiguredProviders();
    this.emit("change", this.getSnapshot());
    return this.getSnapshot();
  }

  async updateOverlayConfig(patch) {
    const currentOverlay = this.configStore.getConfig().overlay || {};
    const normalizedPatch = {
      ...patch
    };

    if (patch.filters) {
      normalizedPatch.filters = {
        ...(currentOverlay.filters || {}),
        ...(patch.filters || {}),
        platforms: {
          ...(currentOverlay.filters?.platforms || {}),
          ...(patch.filters?.platforms || {})
        }
      };
    }

    await this.configStore.updateOverlayConfig({
      ...currentOverlay,
      ...normalizedPatch
    });
    this.emit("change", this.getSnapshot());
    return this.getSnapshot();
  }

  async updateUiConfig(patch) {
    const allowedFilters = new Set(["all", "replay", "twitch", "youtube", "kick", "tiktok"]);
    const normalizedPatch = {};

    if (patch.active_source_filter && allowedFilters.has(patch.active_source_filter)) {
      normalizedPatch.active_source_filter = patch.active_source_filter;
    }

    const allowedLanguages = new Set(["pt-BR", "en", "es"]);
    if (patch.language && allowedLanguages.has(patch.language)) {
      normalizedPatch.language = patch.language;
    }

    if (typeof patch.onboarding_seen === "boolean") {
      normalizedPatch.onboarding_seen = patch.onboarding_seen;
    }

    await this.configStore.updateUiConfig(normalizedPatch);
    this.emit("change", this.getSnapshot());
    return this.getSnapshot();
  }

  getSnapshot() {
    const config = this.configStore.getConfig();
    return {
      runtime: this.getRuntimeInfo(),
      providers: this.getProviderSummaries(),
      settings: {
        ui: config.ui,
        overlay: config.overlay,
        providers: config.providers
      },
      state: this.store.getState()
    };
  }

  async stopAllAdapters() {
    for (const adapter of this.adapters.values()) {
      await adapter.stop();
    }
    this.adapters.clear();
  }

  async reset() {
    await this.stopAllAdapters();
    this.store.reset();
    this.store.setMode("offline");
    await this.logger.info("runtime_reset", "Runtime resetado");
    return this.getSnapshot();
  }

  async clearChatCache() {
    const clearedMessages = this.store.clearMessages();
    await this.logger.info("chat_cache_cleared", "Buffer de mensagens limpo", {
      cleared_messages: clearedMessages
    });
    return {
      snapshot: this.getSnapshot(),
      cleared_messages: clearedMessages
    };
  }

  shouldStartTwitchRealtime(config) {
    return Boolean(
      config?.enabled
      && config.channel
      && (config.setup_mode === "compatibility" || !config.setup_mode || config.quick_input)
    );
  }

  shouldStartYouTubeRealtime(config) {
    return canStartYouTubeRealtime(config);
  }

  shouldStartYouTubeCompatibility(config) {
    return canStartYouTubeCompatibility(config);
  }

  shouldStartKickCompatibility(config) {
    return canStartKickCompatibility(config);
  }

  shouldStartTikTokCompatibility(config) {
    return canStartTikTokCompatibility(config);
  }

  async syncConfiguredProviders() {
    await this.stopAllAdapters();
    this.store.reset();

    const config = this.configStore.getConfig();
    const activeStarts = [];

    if (this.shouldStartTwitchRealtime(config.providers?.twitch)) {
      const adapterKey = `twitch:${config.providers.twitch.channel}`;
      const adapter = new TwitchChatAdapter({
        channel: config.providers.twitch.channel,
        onEvent: (event) => this.store.applyEvent(event),
        onLog: (level, event, message, metadata) => {
          if (level === "error") return this.logger.error(event, message, metadata);
          if (level === "warning") return this.logger.warn(event, message, metadata);
          return this.logger.info(event, message, metadata);
        }
      });
      this.adapters.set(adapterKey, adapter);
      activeStarts.push(
        adapter.start().catch((error) => {
          this.adapters.delete(adapterKey);
          this.logger.error("twitch_adapter_start_failed", error.message, {
            channel: config.providers.twitch.channel
          });
          this.store.applyEvent({
            id: randomUUID(),
            version: "system-event.v0",
            source: "twitch",
            channel: config.providers.twitch.channel,
            connection_id: `twitch:${config.providers.twitch.channel}:live`,
            stream_id: "live",
            kind: "source_error",
            level: "error",
            time: new Date().toISOString(),
            title: "twitch falhou",
            message: error.message,
            recoverable: true,
            accent_color: "#9146ff"
          });
        })
      );
    }

    const youtubeConfig = config.providers?.youtube;
    if (
      this.shouldStartYouTubeCompatibility(youtubeConfig)
      || this.shouldStartYouTubeRealtime(youtubeConfig)
    ) {
      activeStarts.push((async () => {
        const youtubeTarget = youtubeConfig.channel
          || youtubeConfig.channel_id
          || (youtubeConfig.quick_input ? "quick-input" : "target");
        const logAdapterEvent = (level, event, message, metadata) => {
          if (level === "error") return this.logger.error(event, message, metadata);
          if (level === "warning") return this.logger.warn(event, message, metadata);
          return this.logger.info(event, message, metadata);
        };

        const officialEligible = this.shouldStartYouTubeRealtime(youtubeConfig);
        const compatEligible = this.shouldStartYouTubeCompatibility(youtubeConfig);

        if (compatEligible) {
          const compatKey = `youtube-compat:${youtubeTarget}`;
          const compatAdapter = new YouTubeCompatAdapter({
            config: youtubeConfig,
            onEvent: (event) => this.store.applyEvent(event),
            onLog: logAdapterEvent
          });
          this.adapters.set(compatKey, compatAdapter);

          try {
            await compatAdapter.start();
            return;
          } catch (error) {
            this.adapters.delete(compatKey);
            this.store.removeConnection(compatAdapter.buildConnectionId(), { emitChange: false });
            await this.logger.warn("youtube_compat_adapter_failed", error.message, {
              channel: youtubeConfig.channel,
              channel_id: youtubeConfig.channel_id,
              quick_input: youtubeConfig.quick_input
            });
          }
        }

        if (!officialEligible) {
          return;
        }

        const officialKey = `youtube:${youtubeTarget}`;
        const officialAdapter = new YouTubeLiveAdapter({
          config: youtubeConfig,
          onEvent: (event) => this.store.applyEvent(event),
          onLog: logAdapterEvent
        });
        this.adapters.set(officialKey, officialAdapter);

        try {
          await officialAdapter.start();
        } catch (error) {
          this.adapters.delete(officialKey);
          this.logger.error("youtube_adapter_start_failed", error.message, {
            channel: youtubeConfig.channel,
            channel_id: youtubeConfig.channel_id
          });
          const officialConnectionId = officialAdapter.buildConnectionId();
          this.store.applyEvent({
            id: randomUUID(),
            version: "system-event.v0",
            source: "youtube",
            channel: youtubeConfig.channel || youtubeConfig.channel_id || "youtube",
            connection_id: officialConnectionId,
            stream_id: "live",
            kind: "source_error",
            level: "error",
            time: new Date().toISOString(),
            title: "youtube falhou",
            message: error.message,
            recoverable: true,
            accent_color: "#ff3131",
            metadata: {
              ingestion_method: "official"
            }
          });
          this.store.removeConnection(officialConnectionId, { emitChange: false });
        }
      })());
    }

    const kickConfig = config.providers?.kick;
    if (this.shouldStartKickCompatibility(kickConfig)) {
      const kickTarget = normalizeKickChannelInput(
        kickConfig.channel
        || kickConfig.quick_input
        || kickConfig.broadcaster_user_id
      );
      const adapterKey = `kick:${kickTarget}`;
      const adapter = new KickChatAdapter({
        channel: kickTarget,
        onEvent: (event) => this.store.applyEvent(event),
        onLog: (level, event, message, metadata) => {
          if (level === "error") return this.logger.error(event, message, metadata);
          if (level === "warning") return this.logger.warn(event, message, metadata);
          return this.logger.info(event, message, metadata);
        }
      });
      this.adapters.set(adapterKey, adapter);
      activeStarts.push(
        adapter.start().catch((error) => {
          this.adapters.delete(adapterKey);
          this.logger.error("kick_adapter_start_failed", error.message, {
            channel: kickTarget
          });
          this.store.applyEvent({
            id: randomUUID(),
            version: "system-event.v0",
            source: "kick",
            channel: kickTarget,
            connection_id: `kick:${kickTarget}:live`,
            stream_id: "live",
            kind: "source_error",
            level: "error",
            time: new Date().toISOString(),
            title: "kick falhou",
            message: error.message,
            recoverable: true,
            accent_color: "#53fc18",
            metadata: {
              ingestion_method: "compatibility"
            }
          });
          this.store.removeConnection(adapter.buildConnectionId(), { emitChange: false });
        })
      );
    }

    const tiktokConfig = config.providers?.tiktok;
    if (this.shouldStartTikTokCompatibility(tiktokConfig)) {
      const tiktokTarget = tiktokConfig.unique_id
        || tiktokConfig.channel
        || tiktokConfig.quick_input
        || "tiktok";
      const adapterKey = `tiktok:${tiktokTarget}`;
      const adapter = new TikTokChatAdapter({
        config: tiktokConfig,
        onEvent: (event) => this.store.applyEvent(event),
        onLog: (level, event, message, metadata) => {
          if (level === "error") return this.logger.error(event, message, metadata);
          if (level === "warning") return this.logger.warn(event, message, metadata);
          return this.logger.info(event, message, metadata);
        }
      });
      this.adapters.set(adapterKey, adapter);
      activeStarts.push(
        adapter.start().catch((error) => {
          this.adapters.delete(adapterKey);
          this.logger.error("tiktok_adapter_start_failed", error.message, {
            target: tiktokTarget
          });
          this.store.applyEvent({
            id: randomUUID(),
            version: "system-event.v0",
            source: "tiktok",
            channel: tiktokTarget,
            connection_id: adapter.buildConnectionId(),
            stream_id: tiktokTarget,
            kind: "source_error",
            level: "error",
            time: new Date().toISOString(),
            title: "tiktok falhou",
            message: error.message,
            recoverable: true,
            accent_color: "#ff0050",
            metadata: {
              ingestion_method: "compatibility"
            }
          });
          this.store.removeConnection(adapter.buildConnectionId(), { emitChange: false });
        })
      );
    }

    this.store.setMode(this.adapters.size > 0 ? "live" : "offline");
    await Promise.all(activeStarts);
    this.store.setMode(this.adapters.size > 0 ? "live" : "offline");
    await this.logger.info("runtime_sync", "Providers sincronizados", {
      mode: this.store.getState().mode,
      active_adapters: [...this.adapters.keys()]
    });
    return this.getSnapshot();
  }

  async forceTwitchDropConnection() {
    const adapter = [...this.adapters.entries()].find(([key]) => key.startsWith("twitch:"))?.[1];
    if (!adapter) {
      throw new Error("Nenhum adapter Twitch ativo para teste de reconnect.");
    }

    adapter.forceDropConnectionForTest();
    await this.logger.warn("twitch_forced_drop_request", "Queda controlada disparada");
    return this.getSnapshot();
  }

  async startDemo() {
    await this.stopAllAdapters();
    this.store.reset();
    this.store.setMode("demo");

    const adapter = new DemoMultiStreamAdapter({
      onEvent: (event) => this.store.applyEvent(event)
    });

    this.adapters.set("demo", adapter);
    await adapter.start();
    await this.logger.info("runtime_demo", "Demo iniciada");
    return this.getSnapshot();
  }

  async startReplay() {
    await this.stopAllAdapters();
    this.store.reset();
    this.store.setMode("replay");

    const adapter = new ReplayAdapter({
      rootDir: this.rootDir,
      onEvent: (event) => this.store.applyEvent(event)
    });

    this.adapters.set("replay", adapter);
    await adapter.start();
    await this.logger.info("runtime_replay", "Replay iniciado");
    return this.getSnapshot();
  }
}
