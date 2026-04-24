[//]: # (       __     __                   )
[//]: # (_|_   (_ ||\/|__) /\ _ _ _ _|   _  )
[//]: # ( |    __)||  |__)/--|_| (_(_||_|/_ )
[//]: # (                    |  )

# TikTok - Proximo Corte de Hardening

## Status

- provider implementado em UI/config/runtime
- rota atual: conector local read-only por `@handle` ou URL da live
- release-alvo atual inclui TikTok junto de Twitch, YouTube e Kick
- a superficie publica da V1 fica travada nesses quatro providers

## Proximo corte seguro

1. usar esta base travada para polish final de HUD/interface e UX
2. revalidar TikTok apenas se surgir regressao objetiva no runtime atual
3. manter docs e pacote coerentes com a superficie publica de quatro providers
4. abrir Git apenas com boundary limpo, sem lixo de estado operacional

## Fora do escopo deste corte

- novas plataformas
- envio de mensagem para TikTok
- cookies/sessao/webview proprio
- signer proprio ou servico externo dedicado
