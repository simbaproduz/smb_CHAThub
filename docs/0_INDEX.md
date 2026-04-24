[//]: # (       __     __                   )
[//]: # (_|_   (_ ||\/|__) /\ _ _ _ _|   _  )
[//]: # ( |    __)||  |__)/--|_| (_(_||_|/_ )
[//]: # (                    |  )

# Live Control - CHAThub - Docs

Documentacao curta para publicar e manter a V1 coerente com o produto entregue.

## Escopo Publico

- produto: Live Control - CHAThub
- estado: V1 publica `v1.0.1`
- providers publicos: Twitch, YouTube, Kick e TikTok
- overlay: janela local sempre por cima, configurada pela UI
- dados privados: credenciais, tokens, logs e overrides locais nunca devem entrar no Git

## Providers publicos da V1

| Provider | Implementado | UI publica | Persistido | Runtime real |
|----------|--------------|------------|------------|--------------|
| Twitch | sim | sim | sim | sim |
| YouTube | sim | sim | sim | sim |
| Kick | sim | sim | sim | sim |
| TikTok | sim | sim | sim | sim |

## Superficie Do Produto

- Monitor: chat principal, fontes ativas, status operacional e botao de overlay.
- CONFIGURACAO: conexao de canais, controles de overlay e preview vivo.
- COMO USAR: guia rapido para operar com um monitor, segundo monitor ou OBS.
- Overlay: HUD local sobreposto ao jogo, ao OBS ou a outra janela.

## Dados Locais

- `runtime/monitor-config.json` e a base publica limpa.
- `runtime/monitor-config.local.json` e override privado do operador e deve continuar ignorado.
- `runtime/logs/`, `temp/`, `output/`, `refs/`, `node_modules/` e `.playwright-cli/` nao entram em release publica.
- tokens, API keys, client secrets e historico operacional pertencem apenas ao operador local.

## Validacao

Antes de abrir release publica, rodar pelo menos:

```bash
npm start
npm run check:replay
node --check src/server.mjs
powershell -ExecutionPolicy Bypass -File tools/overlay-window-probe.ps1 -AutoTest
powershell -ExecutionPolicy Bypass -File tools/overlay-real-usage-validation.ps1 -AutoTest -DurationSeconds 120
powershell -ExecutionPolicy Bypass -File tools/overlay-focus-mitigation-probe.ps1 -AutoTest -DurationSeconds 20
powershell -ExecutionPolicy Bypass -File tools/ui-minima-local-replay.ps1 -AutoTest -DurationSeconds 8
```

## Regra De Publicacao

Se um arquivo expuser caminho local, estado do operador, token, log, snapshot bruto, arquivo de agente ou escopo fora da V1, ele deve ser limpo ou ficar fora do Git/release.
