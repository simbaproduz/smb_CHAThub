//        __     __                   
// _|_   (_ ||\/|__) /\ _ _ _ _|   _  
//  |    __)||  |__)/--|_| (_(_||_|/_ 
//                     |  

import { randomUUID } from "node:crypto";
import { getPlatformDef, buildConnectionId } from "../core/platforms.mjs";

function nowIso() {
  return new Date().toISOString();
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
  const platform = getPlatformDef("twitch");
  return {
    id: randomUUID(),
    version: "system-event.v0",
    source: "twitch",
    channel,
    connection_id: buildConnectionId({ source: "twitch", channel, streamId }),
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
  channel,
  streamId,
  author,
  text,
  parts,
  rawRef
}) {
  const platform = getPlatformDef("twitch");
  const messageParts = normalizeMessageParts(parts, text);
  return {
    id: randomUUID(),
    version: "chat-event.v0",
    source: "twitch",
    channel,
    connection_id: buildConnectionId({ source: "twitch", channel, streamId }),
    stream_id: streamId,
    channel_display_name: channel,
    kind: "message",
    time: nowIso(),
    author,
    text,
    parts: messageParts,
    accent_color: platform.accentColor,
    raw_ref: rawRef
  };
}

function normalizeMessageParts(parts, fallbackText = "") {
  if (Array.isArray(parts) && parts.length > 0) {
    return parts;
  }

  return [{ type: "text", value: fallbackText }];
}

function decodeTagValue(value = "") {
  return value
    .replaceAll("\\s", " ")
    .replaceAll("\\:", ";")
    .replaceAll("\\r", "\r")
    .replaceAll("\\n", "\n")
    .replaceAll("\\\\", "\\");
}

function parseTags(rawTagSection = "") {
  const tags = {};
  if (!rawTagSection) {
    return tags;
  }

  for (const entry of rawTagSection.split(";")) {
    const [rawKey, ...rest] = entry.split("=");
    tags[rawKey] = decodeTagValue(rest.join("="));
  }

  return tags;
}

function parseBadgeSet(rawBadges = "") {
  return new Set(
    rawBadges
      .split(",")
      .map((entry) => entry.split("/")[0])
      .filter(Boolean)
  );
}

function buildAuthor(tags, nick) {
  const badges = parseBadgeSet(tags.badges);
  const roles = [];

  if (badges.has("broadcaster")) roles.push("streamer");
  if (tags.mod === "1" || badges.has("moderator")) roles.push("mod");
  if (badges.has("vip")) roles.push("vip");
  if (tags.subscriber === "1" || badges.has("subscriber")) roles.push("subscriber");

  if (roles.length === 0) {
    roles.push("viewer");
  }

  return {
    id: tags["user-id"] || "",
    name: tags["display-name"] || nick,
    color: tags.color || "",
    roles
  };
}

function parseTwitchEmoteRanges(rawEmotes = "") {
  const ranges = [];
  if (!rawEmotes) {
    return ranges;
  }

  for (const emoteGroup of rawEmotes.split("/")) {
    const [emoteId, rawRanges = ""] = emoteGroup.split(":");
    if (!emoteId || !rawRanges) {
      continue;
    }

    for (const rawRange of rawRanges.split(",")) {
      const [start, end] = rawRange.split("-").map((value) => Number(value));
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
        continue;
      }

      ranges.push({ emoteId, start, end });
    }
  }

  return ranges.sort((a, b) => a.start - b.start);
}

function buildTwitchMessageParts(text = "", tags = {}) {
  const ranges = parseTwitchEmoteRanges(tags.emotes);
  if (ranges.length === 0) {
    return [{ type: "text", value: text }];
  }

  const parts = [];
  let cursor = 0;

  for (const range of ranges) {
    if (range.start < cursor || range.start >= text.length) {
      continue;
    }

    if (range.start > cursor) {
      parts.push({ type: "text", value: text.slice(cursor, range.start) });
    }

    const value = text.slice(range.start, range.end + 1);
    parts.push({
      type: "emote",
      value,
      alt: value,
      id: range.emoteId,
      provider: "twitch",
      src: `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(range.emoteId)}/default/dark/2.0`
    });
    cursor = range.end + 1;
  }

  if (cursor < text.length) {
    parts.push({ type: "text", value: text.slice(cursor) });
  }

  return parts.length > 0 ? parts : [{ type: "text", value: text }];
}

function parseIrcLine(line) {
  let cursor = line;
  let tags = {};

  if (cursor.startsWith("@")) {
    const splitIndex = cursor.indexOf(" ");
    tags = parseTags(cursor.slice(1, splitIndex));
    cursor = cursor.slice(splitIndex + 1);
  }

  if (cursor.startsWith(":")) {
    const splitIndex = cursor.indexOf(" ");
    const prefix = cursor.slice(1, splitIndex);
    cursor = cursor.slice(splitIndex + 1);
    const commandEnd = cursor.indexOf(" ");
    const command = commandEnd === -1 ? cursor : cursor.slice(0, commandEnd);
    const params = commandEnd === -1 ? "" : cursor.slice(commandEnd + 1);
    return { tags, prefix, command, params };
  }

  const commandEnd = cursor.indexOf(" ");
  const command = commandEnd === -1 ? cursor : cursor.slice(0, commandEnd);
  const params = commandEnd === -1 ? "" : cursor.slice(commandEnd + 1);
  return { tags, prefix: "", command, params };
}

function extractPrivMsgPayload(parsed) {
  const match = parsed.params.match(/^#([^ ]+) :([\s\S]*)$/);
  if (!match) {
    return null;
  }

  const nick = parsed.prefix.split("!")[0] || parsed.tags["display-name"] || "";
  return {
    channel: match[1],
    text: match[2],
    parts: buildTwitchMessageParts(match[2], parsed.tags),
    author: buildAuthor(parsed.tags, nick)
  };
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseChannelMetadata(html, fallbackChannel) {
  const scriptMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
  const payload = scriptMatch ? safeJsonParse(scriptMatch[1]) : null;
  const video = payload?.["@graph"]?.find((entry) => entry?.["@type"] === "VideoObject") || null;

  const titleMeta = html.match(/<meta property="og:description" content="([^"]*)"/i)?.[1] || "";
  const channelTitle = html.match(/<meta property="og:title" content="([^"]*)"/i)?.[1] || `${fallbackChannel} - Twitch`;
  const isLive = Boolean(video?.publication?.isLiveBroadcast);

  return {
    is_live: isLive,
    title: video?.description || titleMeta || "",
    channel_display_name: channelTitle.replace(/\s*-\s*Twitch$/i, ""),
    started_at: video?.uploadDate || video?.publication?.startDate || ""
  };
}

export class TwitchChatAdapter {
  constructor({
    channel,
    onEvent,
    metadataRefreshMs = 60000,
    reconnectBaseDelayMs = 2000,
    reconnectMaxDelayMs = 30000,
    onLog = () => {}
  }) {
    this.channel = channel;
    this.onEvent = onEvent;
    this.metadataRefreshMs = metadataRefreshMs;
    this.reconnectBaseDelayMs = reconnectBaseDelayMs;
    this.reconnectMaxDelayMs = reconnectMaxDelayMs;
    this.onLog = onLog;
    this.streamId = "live";
    this.socket = null;
    this.running = false;
    this.connected = false;
    this.liveSeen = false;
    this.currentTitle = "";
    this.metadataTimer = null;
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
    this.manualStop = false;
  }

  async start() {
    if (this.running) return;
    if (!this.channel) {
      throw new Error("Twitch adapter precisa de channel.");
    }

    this.running = true;
    this.manualStop = false;
    await this.startConnectionAttempt({ initial: true });

    this.metadataTimer = setInterval(() => {
      this.refreshMetadata()
        .then((nextMetadata) => {
          if (nextMetadata) {
            this.applyMetadata(nextMetadata);
          }
        })
        .catch((error) => {
          this.onEvent(createSystemEvent({
            channel: this.channel,
            streamId: this.streamId,
            kind: "source_error",
            level: "warning",
            title: "metadata twitch falhou",
            message: error.message
          }));
        });
    }, this.metadataRefreshMs);
  }

  async startConnectionAttempt({ initial = false } = {}) {
    if (!this.running) return;

    const message = initial
      ? `Preparando sessao ${this.channel}`
      : `Reconectando ${this.channel} (tentativa ${this.reconnectAttempt})`;

    this.onEvent(createSystemEvent({
      channel: this.channel,
      streamId: this.streamId,
      kind: "source_connecting",
      title: initial ? "twitch conectando" : "twitch reconectando",
      message
    }));
    this.onLog("info", "twitch_connecting", message, {
      channel: this.channel,
      reconnect_attempt: this.reconnectAttempt,
      initial
    });

    try {
      const metadata = await this.refreshMetadata();
      if (metadata) {
        this.applyMetadata(metadata);
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
        title: "twitch falhou",
        message: error.message
      }));
      this.onLog("warning", "twitch_connect_failed", error.message, {
        channel: this.channel,
        reconnect_attempt: this.reconnectAttempt
      });
      this.scheduleReconnect(error.message);
    }
  }

  async refreshMetadata() {
    const response = await fetch(`https://www.twitch.tv/${encodeURIComponent(this.channel)}`, {
      headers: {
        "User-Agent": "Live-Control-CHAThub/1.0"
      }
    });

    if (!response.ok) {
      throw new Error(`Nao foi possivel abrir a pagina publica da Twitch (${response.status}).`);
    }

    const html = await response.text();
    return parseChannelMetadata(html, this.channel);
  }

  applyMetadata(metadata) {
    if (metadata.title && metadata.title !== this.currentTitle) {
      this.currentTitle = metadata.title;
      this.onEvent(createSystemEvent({
        channel: this.channel,
        streamId: this.streamId,
        kind: "livestream_metadata_updated",
        title: "metadata sincronizada",
        message: `${this.channel} publicou titulo`,
        metadata: { title: metadata.title }
      }));
      this.onLog("info", "twitch_metadata_updated", metadata.title, {
        channel: this.channel
      });
    }

    if (metadata.is_live && !this.liveSeen) {
      this.liveSeen = true;
      this.onEvent(createSystemEvent({
        channel: this.channel,
        streamId: this.streamId,
        kind: "stream_started",
        title: "live detectada",
        message: `${this.channel} entrou ao vivo`,
        metadata: { title: metadata.title, started_at: metadata.started_at || "" }
      }));
      this.onLog("info", "twitch_stream_started", "Live detectada", {
        channel: this.channel,
        title: metadata.title,
        started_at: metadata.started_at || ""
      });
    }

    if (!metadata.is_live && this.liveSeen) {
      this.liveSeen = false;
      this.onEvent(createSystemEvent({
        channel: this.channel,
        streamId: this.streamId,
        kind: "stream_ended",
        title: "live encerrada",
        message: `${this.channel} saiu do ar`
      }));
      this.onLog("warning", "twitch_stream_ended", "Live saiu do ar", {
        channel: this.channel
      });
    }
  }

  openSocket() {
    return new Promise((resolve, reject) => {
      const nick = `justinfan${Math.floor(Math.random() * 100000)}`;
      const socket = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
      this.socket = socket;
      let settled = false;
      let socketErrorMessage = "";

      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          reject(new Error("Timeout ao conectar no IRC da Twitch."));
        }
        socket.close();
      }, 15000);

      const resolveOnce = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        resolve();
      };

      const rejectOnce = (error) => {
        if (settled) return;
        settled = true;
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        reject(error);
      };

      socket.addEventListener("open", () => {
        socket.send("CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership");
        socket.send("PASS SCHMOOPIIE");
        socket.send(`NICK ${nick}`);
        socket.send(`JOIN #${this.channel}`);
      });

      socket.addEventListener("message", (event) => {
        const payload = String(event.data);
        for (const line of payload.split("\r\n")) {
          if (!line) continue;
          if (line.startsWith("PING")) {
            socket.send(line.replace("PING", "PONG"));
            continue;
          }

          const parsed = parseIrcLine(line);

          if (parsed.command === "ROOMSTATE" && !this.connected) {
            this.connected = true;
            settled = true;
            this.onEvent(createSystemEvent({
              channel: this.channel,
              streamId: this.streamId,
              kind: "source_connected",
              title: "twitch conectado",
              message: `Sessao ${this.channel} pronta`
            }));
            this.onLog("info", "twitch_connected", "Sessao conectada", {
              channel: this.channel
            });
            resolveOnce();
            continue;
          }

          if (parsed.command === "PRIVMSG") {
            const chatPayload = extractPrivMsgPayload(parsed);
            if (!chatPayload) continue;
            this.onEvent(createChatEvent({
              channel: this.channel,
              streamId: this.streamId,
              author: chatPayload.author,
              text: chatPayload.text,
              parts: chatPayload.parts,
              rawRef: line
            }));
          }
        }
      });

      socket.addEventListener("error", () => {
        socketErrorMessage = "Falha no socket de chat da Twitch.";
        this.onLog("warning", "twitch_socket_error", socketErrorMessage, {
          channel: this.channel
        });
        if (!this.connected) {
          rejectOnce(new Error(socketErrorMessage));
        }
      });

      socket.addEventListener("close", () => {
        clearTimeout(timeout);
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
            title: "twitch desconectado",
            message: `${this.channel} finalizado`
          }));
          this.onLog("warning", "twitch_disconnected", "Socket fechado", {
            channel: this.channel,
            manual_stop: this.manualStop
          });
          if (!this.manualStop) {
            this.scheduleReconnect("Conexao de chat fechada.");
          }
        } else if (!resolved) {
          rejectOnce(new Error(socketErrorMessage || "Conexao de chat da Twitch fechou antes de confirmar a sessao."));
        }
      });
    });
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
      title: "reconnect agendado",
      message: `${reason || "Reconexao necessaria"} Nova tentativa em ${Math.ceil(delayMs / 1000)}s.`
    }));
    this.onLog("warning", "twitch_reconnect_scheduled", reason || "Reconexao necessaria", {
      channel: this.channel,
      reconnect_attempt: this.reconnectAttempt,
      delay_ms: delayMs
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.startConnectionAttempt().catch(() => {
        // a propria tentativa ja emite estado de erro e agenda novo reconnect
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

    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // socket ja pode estar fechado
      }
      this.socket = null;
    }
  }

  forceDropConnectionForTest() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Nao existe socket Twitch aberto para derrubar.");
    }

    this.onLog("warning", "twitch_forced_drop", "Queda controlada solicitada", {
      channel: this.channel
    });
    this.socket.close(4000, "forced-drop");
  }
}
