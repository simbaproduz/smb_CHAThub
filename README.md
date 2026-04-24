[//]: # (       __     __                   )
[//]: # (_|_   (_ ||\/|__) /\ _ _ _ _|   _  )
[//]: # ( |    __)||  |__)/--|_| (_(_||_|/_ )
[//]: # (                    |  )

<p align="center">
  <img src="docs/assets/banner2.png" alt="Live Control - CHAThub" width="100%">
</p>

<h1 align="center">Live Control - CHAThub</h1>

<p align="center">
  Um painel local premium para unir chats ao vivo de Twitch, YouTube, Kick e TikTok, com overlay real para streamers acompanharem tudo sem trocar de tela.
</p>

<p align="center">
  <a href="./README.en.md">English</a>
  ·
  <a href="./README.es.md">Español</a>
  ·
  <a href="https://discord.simbaproduz.com">Discord SIMBAproduz</a>
</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-1.0.0-8B5CF6?style=for-the-badge">
  <img alt="Status" src="https://img.shields.io/badge/status-stable-22C55E?style=for-the-badge">
  <img alt="Windows" src="https://img.shields.io/badge/platform-Windows-3B82F6?style=for-the-badge&logo=windows">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-EC4899?style=for-the-badge">
  <a href="https://discord.simbaproduz.com"><img alt="Discord" src="https://img.shields.io/badge/Discord-SIMBAproduz-5865F2?style=for-the-badge&logo=discord&logoColor=white"></a>
</p>

<p align="center">
  <img alt="Twitch" src="https://img.shields.io/badge/Twitch-supported-9146FF?style=flat-square&logo=twitch&logoColor=white">
  <img alt="YouTube" src="https://img.shields.io/badge/YouTube-supported-FF0000?style=flat-square&logo=youtube&logoColor=white">
  <img alt="Kick" src="https://img.shields.io/badge/Kick-supported-53FC18?style=flat-square">
  <img alt="TikTok" src="https://img.shields.io/badge/TikTok-supported-111827?style=flat-square&logo=tiktok&logoColor=white">
</p>

## O que é

**Live Control - CHAThub** é uma central local de chat para lives. A aplicação roda no seu Windows, abre como app desktop e conecta múltiplas plataformas em um único feed operacional.

O objetivo é simples: permitir que o streamer leia o chat em tempo real enquanto joga, transmite ou opera o OBS. O overlay abre em uma janela separada, feita para ficar por cima do jogo, por cima do OBS ou em outro monitor.

## Recursos

- Chat unificado para Twitch, YouTube, Kick e TikTok.
- Overlay real com janela separada sempre por cima.
- Preview visual do overlay antes de salvar.
- Filtros por plataforma e por tipo de evento.
- Status inteligente de fontes ativas, quedas, erros e reconexões.
- Emotes e imagens de chat renderizados quando a plataforma fornece mídia.
- Interface dark premium com sidebar, cards compactos e fluxo operacional.
- Idiomas de interface: PT-BR, EN e ES.
- Configuração local persistente, sem enviar credenciais para servidor externo.
- Testes locais de replay e regressão de status.

## Plataformas suportadas

| Plataforma | Status | Observação |
| --- | --- | --- |
| Twitch | Suportada | Canal público, chat ao vivo e emotes quando disponíveis. |
| YouTube | Suportada | Compatibilidade pública primeiro, fallback oficial opcional com credencial local. |
| Kick | Suportada | Canal público e eventos de chat ao vivo. |
| TikTok | Suportada | Leitura por URL pública da live ou `@handle`. |

## Screenshots

### Monitor

![Monitor do Live Control - CHAThub](docs/assets/screenshots/monitor.png)

### Configuração

![Configuração do Live Control - CHAThub](docs/assets/screenshots/settings.png)

### Como usar

![Como usar o Live Control - CHAThub](docs/assets/screenshots/about.png)

## Como usar

### Requisitos

- Windows 10 ou Windows 11.
- Node.js 20+ recomendado.
- PowerShell disponível no sistema.
- Lives públicas nas plataformas que você deseja conectar.

### Instalação local

Para abrir como app desktop durante o desenvolvimento:

```bash
npm install
npm run desktop
```

Para rodar como servidor local no navegador:

```bash
npm install
npm start
```

Depois abra:

```text
http://127.0.0.1:4310
```

Também existe um atalho local:

```text
start-live-control-chathub.cmd
```

### Fluxo recomendado

1. Abra **CONFIGURAÇÃO**.
2. Cole a URL da live, canal ou `@handle`.
3. Confirme os cards de plataforma.
4. Volte para **Monitor** para acompanhar o chat unificado.
5. Clique em **Abrir Overlay** quando quiser o chat por cima do jogo/OBS.
6. Ajuste posição, tamanho, transparência e filtros em **CONFIGURAÇÃO**.

## Configuração do overlay

O overlay é uma janela local independente. Ele pode ser usado em um único monitor, sobreposto ao jogo, ou em uma segunda tela.

Você pode configurar:

- monitor de destino;
- canto da tela;
- tamanho da fonte;
- tempo de permanência das mensagens;
- transparência do fundo;
- largura do card;
- filtros por plataforma;
- filtros por mensagens, entradas, audiência e eventos técnicos.

O preview da página **CONFIGURAÇÃO** é a referência visual do overlay real.

## Idiomas

A interface suporta:

- Português do Brasil;
- English;
- Español.

A troca é instantânea dentro do app e fica salva localmente.

## Privacidade

O app roda localmente. Configurações privadas do operador ficam em:

```text
runtime/monitor-config.local.json
```

Esse arquivo é ignorado pelo Git. Credenciais, tokens, logs e histórico local não devem ser publicados.

## Scripts

```bash
npm start
npm run desktop
npm run build:desktop
npm run check:status
npm run check:replay
npm run package:release
```

## Build desktop

O app desktop usa Electron para abrir o **CHAT HUB** em janela própria, com titlebar custom, ícone `simba.ico` e runtime local iniciado automaticamente.

```bash
npm run build:desktop
```

Os artefatos gerados saem em:

```text
output/desktop/
```

Arquivos `.exe`, logs, cache e builds gerados não entram no Git. O executável final deve ser publicado em **GitHub Releases**, não versionado no código-fonte.

## Roadmap

- Assinatura digital do executável Windows para reduzir alertas do SmartScreen.
- Criar perfis de overlay por cena ou jogo.
- Ampliar testes de longa duração com múltiplas lives.
- Refinar documentação para usuários não técnicos.

## Contribuição

Contribuições são bem-vindas. Antes de abrir um PR:

1. Rode `npm run check:status`.
2. Rode `npm run check:replay`.
3. Não inclua `runtime/monitor-config.local.json`, logs, tokens ou arquivos temporários.
4. Mantenha o escopo público da V1 em Twitch, YouTube, Kick e TikTok.

Discussões e feedback da comunidade ficam no Discord:

https://discord.simbaproduz.com

## Licença

Distribuído sob a licença MIT. Veja [LICENSE](LICENSE).
