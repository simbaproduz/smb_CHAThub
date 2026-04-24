#        __     __                   
# _|_   (_ ||\/|__) /\ _ _ _ _|   _  
#  |    __)||  |__)/--|_| (_(_||_|/_ 
#                     |  

param()

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$package = Get-Content -Raw (Join-Path $root "package.json") | ConvertFrom-Json
$version = $package.version
$releaseRoot = Join-Path $root "output\release"
$stageDir = Join-Path $releaseRoot "Live-Control-CHAThub-$version"
$zipPath = "$stageDir.zip"

if (Test-Path $stageDir) {
  Remove-Item -LiteralPath $stageDir -Recurse -Force
}

if (Test-Path $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

New-Item -ItemType Directory -Force -Path $stageDir | Out-Null

$itemsToCopy = @(
  "package.json",
  "package-lock.json",
  ".gitignore",
  "LICENSE",
  "README.md",
  "README.en.md",
  "README.es.md",
  "contracts",
  "desktop",
  "docs",
  "src",
  "tools",
  "fixtures",
  "icon"
)

foreach ($item in $itemsToCopy) {
  Copy-Item -LiteralPath (Join-Path $root $item) -Destination $stageDir -Recurse -Force
}

$cleanConfig = @'
{
  "runtime": {
    "port": 4310,
    "auto_start_demo": false
  },
  "overlay": {
    "enabled": true,
    "display_id": "primary",
    "position": "top-right",
    "offset_x": 32,
    "offset_y": 96,
    "duration_ms": 15000,
    "max_messages": 6,
    "font_size_px": 18,
    "message_font_weight": "semibold",
    "line_height": 1.25,
    "card_width_px": 320,
    "gap_px": 6,
    "background_opacity": 85,
    "show_platform_badge": true,
    "show_channel": true,
    "show_avatar": false,
    "animation": "fade",
    "filters": {
      "messages": true,
      "joins": false,
      "audience_updates": false,
      "technical_events": false,
      "platforms": {
        "twitch": true,
        "youtube": true,
        "kick": true,
        "tiktok": true
      }
    }
  },
  "ui": {
    "active_source_filter": "all",
    "language": "pt-BR",
    "onboarding_seen": false,
    "hotkeys": {
      "show_all": "Alt+0",
      "filter_twitch": "Alt+1",
      "filter_youtube": "Alt+2",
      "filter_kick": "Alt+3",
      "filter_tiktok": "Alt+4",
      "start_demo": "Alt+D",
      "start_replay": "Alt+R",
      "open_overlay": "Botao Abrir Overlay"
    }
  },
  "providers": {
    "twitch": {
      "enabled": false,
      "channel": "",
      "broadcaster_user_id": "",
      "client_id": "",
      "client_secret": "",
      "redirect_uri": "http://localhost:4310/auth/twitch/callback",
      "setup_mode": "",
      "quick_input": "",
      "access_token": "",
      "refresh_token": "",
      "scopes": [],
      "display_name": "",
      "login_name": "",
      "token_expires_at": "",
      "token_last_validated_at": "",
      "auth_status": "idle",
      "auth_error": ""
    },
    "youtube": {
      "enabled": false,
      "channel": "",
      "channel_id": "",
      "api_key": "",
      "client_id": "",
      "client_secret": "",
      "setup_mode": "",
      "quick_input": "",
      "access_token": "",
      "refresh_token": ""
    },
    "kick": {
      "enabled": false,
      "channel": "",
      "broadcaster_user_id": "",
      "client_id": "",
      "client_secret": "",
      "setup_mode": "",
      "quick_input": "",
      "access_token": "",
      "refresh_token": "",
      "webhook_public_url": ""
    },
    "tiktok": {
      "enabled": false,
      "channel": "",
      "unique_id": "",
      "quick_input": "",
      "setup_mode": ""
    }
  }
}
'@

$runtimeDir = Join-Path $stageDir "runtime"
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
Set-Content -LiteralPath (Join-Path $runtimeDir "monitor-config.json") -Value $cleanConfig -Encoding UTF8
$logDir = Join-Path $runtimeDir "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$launcher = @'
@echo off
::        __     __
:: _|_   (_ ||\/|__) /\ _ _ _ _|   _
::  |    __)||  |__)/--|_| (_(_||_|/_
::                     |

cd /d %~dp0
npm start
'@
Set-Content -LiteralPath (Join-Path $stageDir "start-live-control-chathub.cmd") -Value $launcher -Encoding ASCII

Compress-Archive -Path "$stageDir\*" -DestinationPath $zipPath -Force
Write-Output $zipPath
