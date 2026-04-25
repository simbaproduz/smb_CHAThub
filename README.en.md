[//]: # (       __     __                   )
[//]: # (_|_   (_ ||\/|__) /\ _ _ _ _|   _  )
[//]: # ( |    __)||  |__)/--|_| (_(_||_|/_ )
[//]: # (                    |  )

<p align="center">
  <img src="docs/assets/banner2.png" alt="Live Control - CHAThub" width="100%">
</p>

<h1 align="center">Live Control - CHAThub</h1>

<p align="center">
  A premium local dashboard that unifies Twitch, YouTube, Kick and TikTok live chats, with a real overlay window for streamers.
</p>

<p align="center">
  <a href="./README.md">Português</a>
  ·
  <a href="./README.es.md">Español</a>
  ·
  <a href="https://discord.simbaproduz.com">SIMBAproduz Discord</a>
</p>

## Download for Normal Use

If you only want to use CHAT HUB, go to **Releases** and download one of these files:

- `CHAT-HUB-1.0.2-Windows-x64.exe`
- `CHAT-HUB-1.0.2-USUARIO-FINAL.zip`

The easiest path is to download the `.exe` and open it with a double-click. If your browser or antivirus blocks the `.exe`, download the `USUARIO-FINAL` ZIP, extract it, and open the `.exe` inside.

| File | Who should use it | What to do |
| --- | --- | --- |
| `CHAT-HUB-1.0.2-Windows-x64.exe` | Normal users | Download and open. |
| `CHAT-HUB-1.0.2-USUARIO-FINAL.zip` | Normal users who prefer a ZIP | Extract first, then open the `.exe`. |
| `Source code.zip` | Developers | Do not use this to install the app. |
| `Source code.tar.gz` | Developers | Do not use this to install the app. |

Important: GitHub's green **Code** button downloads source code. It does not install the app. To use CHAT HUB, always use the files under **Releases**.

## What It Is

**Live Control - CHAThub** is a local live chat control center. It runs on Windows as a desktop app and combines multiple live chat sources into one operational feed.

The overlay opens as a separate window designed to stay above the game, OBS, or another monitor.

## Features

- Unified chat for Twitch, YouTube, Kick and TikTok.
- Real always-on-top overlay window.
- Visual overlay preview.
- Platform and event filters.
- Smart source status, drop detection and reconnection visibility.
- Emote/media rendering when platforms provide media.
- Premium dark dashboard UI.
- Interface languages: PT-BR, EN and ES.
- Local persistent configuration.
- Full close behavior: the X button closes the app, local server and overlay together.

## Screenshots

![Monitor](docs/assets/screenshots/en/monitor.png)

![Settings](docs/assets/screenshots/en/settings.png)

![How to use](docs/assets/screenshots/en/about.png)

## Quick Start

### For Users

1. Download `CHAT-HUB-1.0.2-Windows-x64.exe` or `CHAT-HUB-1.0.2-USUARIO-FINAL.zip`.
2. If you downloaded the ZIP, extract it first.
3. Open `CHAT-HUB-1.0.2-Windows-x64.exe`.
4. If Windows shows a security warning, choose **More info** and then **Run anyway**.
5. To close, click the app **X** button. This also stops the local server and overlay.

You do not need Node.js, npm or any library installation.

### If You Downloaded the Wrong File

If you downloaded `Source code.zip`, `Source code.tar.gz`, or used the green **Code** button, delete that file and download the `.exe` or the `USUARIO-FINAL` ZIP from the release page. Source code requires Node.js and libraries, so it is not the right package for non-technical users.

### For Developers

Desktop app:

```bash
npm install
npm run desktop
```

Local browser server:

```bash
npm install
npm start
```

Open:

```text
http://127.0.0.1:4310
```

## Overlay

The overlay is a separate local window. You can use it on top of a game with one monitor, or place it on a second screen.

You can tune monitor target, corner, font size, opacity, card width, message duration and filters.

## Desktop Build

The desktop app uses Electron to open **CHAT HUB** in its own window, with a custom titlebar, `simba.ico` icon and local runtime started automatically.

```bash
npm run package:release
```

End-user artifacts are written to:

```text
output/release/CHAT-HUB-1.0.2-Windows-x64.exe
output/release/CHAT-HUB-1.0.2-USUARIO-FINAL.zip
```

Use `npm run package:source-dev` only when you need a developer source ZIP. Generated `.exe` files, logs, caches and build output do not belong in Git. Release binaries should be published through **GitHub Releases**.

## Privacy

Private local state belongs in:

```text
runtime/monitor-config.local.json
```

This file is ignored by Git. Do not publish tokens, logs or local operator data.

## License

MIT. See [LICENSE](LICENSE).
