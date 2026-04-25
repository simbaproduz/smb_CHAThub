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
$stageDir = Join-Path $releaseRoot "Live-Control-CHAThub-$version-SOURCE-DEV"
$zipPath = "$stageDir.zip"

function Remove-IfExists {
  param([string]$Path)

  if (Test-Path $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
}

Remove-IfExists $stageDir
Remove-IfExists $zipPath

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
  "icon",
  "start-live-control-chathub.cmd"
)

foreach ($item in $itemsToCopy) {
  Copy-Item -LiteralPath (Join-Path $root $item) -Destination $stageDir -Recurse -Force
}

$runtimeDir = Join-Path $stageDir "runtime"
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
Copy-Item -LiteralPath (Join-Path $root "runtime\monitor-config.json") -Destination (Join-Path $runtimeDir "monitor-config.json") -Force
New-Item -ItemType Directory -Force -Path (Join-Path $runtimeDir "logs") | Out-Null

$warning = @"
ATENCAO: ESTE ZIP E PARA DESENVOLVEDORES

Se voce so quer usar o CHAT HUB, nao baixe este pacote.
Baixe o arquivo CHAT-HUB-$version-Windows-x64.exe ou CHAT-HUB-$version-USUARIO-FINAL.zip na release.

Este pacote SOURCE-DEV precisa de:
- Node.js 20 ou superior
- npm install
- conhecimentos basicos de terminal
"@
Set-Content -LiteralPath (Join-Path $stageDir "NAO-E-PARA-INSTALAR.txt") -Value $warning -Encoding ASCII

Compress-Archive -Path "$stageDir\*" -DestinationPath $zipPath -Force
Write-Output "Pacote de desenvolvedor pronto:"
Write-Output $zipPath
