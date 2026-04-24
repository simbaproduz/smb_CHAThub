[//]: # (       __     __                   )
[//]: # (_|_   (_ ||\/|__) /\ _ _ _ _|   _  )
[//]: # ( |    __)||  |__)/--|_| (_(_||_|/_ )
[//]: # (                    |  )

<p align="center">
  <img src="docs/assets/banner2.png" alt="Live Control - CHAThub" width="100%">
</p>

<h1 align="center">Live Control - CHAThub</h1>

<p align="center">
  Un dashboard local premium que une chats en vivo de Twitch, YouTube, Kick y TikTok, con una ventana real de overlay para streamers.
</p>

<p align="center">
  <a href="./README.md">Português</a>
  ·
  <a href="./README.en.md">English</a>
  ·
  <a href="https://discord.simbaproduz.com">Discord SIMBAproduz</a>
</p>

## Qué es

**Live Control - CHAThub** es una central local de chat para lives. Corre en Windows como app de escritorio y combina múltiples fuentes de chat en un único feed operativo.

El overlay abre una ventana separada, pensada para quedar encima del juego, OBS u otro monitor.

## Recursos

- Chat unificado para Twitch, YouTube, Kick y TikTok.
- Ventana real de overlay siempre encima.
- Preview visual del overlay.
- Filtros por plataforma y tipo de evento.
- Estado inteligente de fuentes, caídas y reconexiones.
- Emotes/media cuando la plataforma los entrega.
- Interfaz dark premium.
- Idiomas: PT-BR, EN y ES.
- Configuración persistente local.

## Screenshots

![Monitor](docs/assets/screenshots/es/monitor.png)

![Configuración](docs/assets/screenshots/es/settings.png)

![Cómo usar](docs/assets/screenshots/es/about.png)

## Inicio rápido

App de escritorio:

```bash
npm install
npm run desktop
```

Servidor local en navegador:

```bash
npm install
npm start
```

Abre:

```text
http://127.0.0.1:4310
```

## Overlay

El overlay es una ventana local separada. Puede quedar encima del juego en un solo monitor o ir a una segunda pantalla.

Puedes ajustar monitor, esquina, tamaño de fuente, opacidad, ancho del card, duración de mensajes y filtros.

## Build de escritorio

El app de escritorio usa Electron para abrir **CHAT HUB** en una ventana propia, con titlebar custom, ícono `simba.ico` y runtime local iniciado automáticamente.

```bash
npm run build:desktop
```

Los artefactos generados salen en:

```text
output/desktop/
```

Los `.exe`, logs, cachés y builds generados no van en Git. Los binarios finales deben publicarse en **GitHub Releases**.

## Privacidad

El estado privado local queda en:

```text
runtime/monitor-config.local.json
```

Este archivo está ignorado por Git. No publiques tokens, logs ni datos locales del operador.

## Licencia

MIT. Consulta [LICENSE](LICENSE).
