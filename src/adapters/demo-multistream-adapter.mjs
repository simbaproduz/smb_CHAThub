//        __     __                   
// _|_   (_ ||\/|__) /\ _ _ _ _|   _  
//  |    __)||  |__)/--|_| (_(_||_|/_ 
//                     |  

import { randomUUID } from "node:crypto";
import { buildConnectionId, getPlatformDef } from "../core/platforms.mjs";

function isoOffset(ms) {
  return new Date(Date.now() + ms).toISOString();
}

function messageParts(text) {
  return [{ type: "text", value: text }];
}

function createSystemEvent({
  source,
  channel,
  streamId,
  kind,
  level = "info",
  title,
  message,
  metadata,
  offsetMs = 0
}) {
  const platform = getPlatformDef(source);
  return {
    id: randomUUID(),
    version: "system-event.v0",
    source,
    channel,
    connection_id: buildConnectionId({ source, channel, streamId }),
    stream_id: streamId,
    kind,
    level,
    time: isoOffset(offsetMs),
    title,
    message,
    recoverable: true,
    accent_color: platform.accentColor,
    metadata
  };
}

function createChatEvent({
  source,
  channel,
  streamId,
  authorName,
  authorRoles = ["viewer"],
  text,
  kind = "message",
  offsetMs = 0
}) {
  const platform = getPlatformDef(source);
  return {
    id: randomUUID(),
    version: "chat-event.v0",
    source,
    channel,
    connection_id: buildConnectionId({ source, channel, streamId }),
    stream_id: streamId,
    channel_display_name: channel,
    kind,
    time: isoOffset(offsetMs),
    author: {
      name: authorName,
      roles: authorRoles
    },
    text,
    parts: messageParts(text),
    accent_color: platform.accentColor
  };
}

export class DemoMultiStreamAdapter {
  constructor({ onEvent }) {
    this.onEvent = onEvent;
    this.timers = [];
    this.running = false;
    this.connections = [
      {
        source: "twitch",
        channel: "demo_twitch",
        streamId: "tw-live-001",
        title: "Night Shift Ops",
        authors: [
          { name: "purple_mod", roles: ["mod"] },
          { name: "raid_scout", roles: ["viewer"] },
          { name: "bits_runner", roles: ["subscriber"] }
        ],
        messages: [
          "overlay ou janela normal, essa leitura aqui ja resolve demais",
          "chat da twitch entrou primeiro, latencia boa",
          "agregador unico faz muito mais sentido em live simultanea"
        ]
      },
      {
        source: "youtube",
        channel: "simba_live",
        streamId: "yt-live-001",
        title: "Build Stream Diario",
        authors: [
          { name: "yt_architect", roles: ["viewer"] },
          { name: "red_member", roles: ["member"] },
          { name: "release_watch", roles: ["viewer"] }
        ],
        messages: [
          "youtube aparecendo em vermelho ficou legivel",
          "isso aqui com superchat separado vai ficar forte",
          "mesma janela, tres plataformas, esse e o produto"
        ]
      },
      {
        source: "kick",
        channel: "simba_kick",
        streamId: "kick-live-001",
        title: "Cross Chat Command Center",
        authors: [
          { name: "green_mod", roles: ["mod"] },
          { name: "kick_runner", roles: ["viewer"] },
          { name: "drop_alert", roles: ["subscriber"] }
        ],
        messages: [
          "kick em verde ja bate o olho e sabe a origem",
          "quando ligar webhook oficial isso aqui encaixa",
          "multi-live simultaneo ficou natural nessa surface"
        ]
      }
    ];
  }

  async start() {
    if (this.running) return;
    this.running = true;

    let cursor = 0;
    for (const connection of this.connections) {
      this.schedule(
        createSystemEvent({
          ...connection,
          kind: "source_connecting",
          title: `${connection.source} conectando`,
          message: `Preparando sessao ${connection.channel}`,
          offsetMs: cursor
        }),
        cursor
      );
      this.schedule(
        createSystemEvent({
          ...connection,
          kind: "source_connected",
          title: `${connection.source} conectado`,
          message: `Sessao ${connection.channel} pronta`,
          offsetMs: cursor + 250
        }),
        cursor + 250
      );
      this.schedule(
        createSystemEvent({
          ...connection,
          kind: "stream_started",
          title: "live detectada",
          message: `${connection.channel} entrou ao vivo`,
          metadata: { title: connection.title },
          offsetMs: cursor + 500
        }),
        cursor + 500
      );
      this.schedule(
        createSystemEvent({
          ...connection,
          kind: "livestream_metadata_updated",
          title: "metadata sincronizada",
          message: `${connection.channel} publicou titulo`,
          metadata: { title: connection.title },
          offsetMs: cursor + 650
        }),
        cursor + 650
      );

      connection.messages.forEach((text, index) => {
        const author = connection.authors[index % connection.authors.length];
        this.schedule(
          createChatEvent({
            ...connection,
            authorName: author.name,
            authorRoles: author.roles,
            text,
            offsetMs: cursor + 1000 + index * 450
          }),
          cursor + 1000 + index * 450
        );
      });

      const interval = setInterval(() => {
        if (!this.running) return;
        const author = connection.authors[Math.floor(Math.random() * connection.authors.length)];
        const text = connection.messages[Math.floor(Math.random() * connection.messages.length)];
        this.onEvent(createChatEvent({
          ...connection,
          authorName: author.name,
          authorRoles: author.roles,
          text
        }));
      }, 5000);

      this.timers.push(interval);
      cursor += 900;
    }
  }

  schedule(event, delayMs) {
    const timer = setTimeout(() => {
      if (!this.running) return;
      this.onEvent(event);
    }, delayMs);
    this.timers.push(timer);
  }

  async stop() {
    if (!this.running) return;
    this.running = false;
    for (const timer of this.timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    this.timers = [];

    for (const connection of this.connections) {
      this.onEvent(createSystemEvent({
        ...connection,
        kind: "stream_ended",
        title: "live encerrada",
        message: `${connection.channel} saiu do ar`,
        offsetMs: 0
      }));
      this.onEvent(createSystemEvent({
        ...connection,
        kind: "source_disconnected",
        title: `${connection.source} desconectado`,
        message: `${connection.channel} finalizado`,
        offsetMs: 50
      }));
    }
  }
}
