#        __     __
# _|_   (_ ||\/|__) /\ _ _ _ _|   _
#  |    __)||  |__)/--|_| (_(_||_|/_
#                     |

param(
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$package = Get-Content -Raw (Join-Path $root "package.json") | ConvertFrom-Json
$version = $package.version
$desktopRoot = Join-Path $root "output\desktop"
$releaseRoot = Join-Path $root "output\release"
$userDir = Join-Path $releaseRoot "CHAT-HUB-$version-USUARIO-FINAL"
$userZip = "$userDir.zip"
$sourceHintPath = Join-Path $releaseRoot "NAO-USE-SOURCE-CODE-ZIP.txt"

function Invoke-Npm {
  param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
  )

  & npm.cmd @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "npm $($Arguments -join ' ') falhou com codigo $LASTEXITCODE."
  }
}

function Remove-IfExists {
  param([string]$Path)

  if (Test-Path $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
}

New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null

foreach ($pattern in @(
  "CHAT-HUB-*-Windows-*.exe",
  "CHAT-HUB-*-USUARIO-FINAL",
  "CHAT-HUB-*-USUARIO-FINAL.zip",
  "Live-Control-CHAThub-*",
  "Live-Control-CHAThub-*.zip"
)) {
  Get-ChildItem -LiteralPath $releaseRoot -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like $pattern } |
    Remove-Item -Recurse -Force
}

Remove-IfExists $userDir
Remove-IfExists $userZip
Remove-IfExists $sourceHintPath

Push-Location $root
try {
  if (-not (Test-Path (Join-Path $root "node_modules\electron-builder"))) {
    Write-Output "Dependencias de build ausentes. Rodando npm install..."
    Invoke-Npm install
  }

  if (-not $SkipBuild) {
    Write-Output "Gerando executavel Windows para usuario final..."
    Invoke-Npm run build:desktop
  }
} finally {
  Pop-Location
}

$exe = Get-ChildItem -LiteralPath $desktopRoot -File -Filter "CHAT-HUB-$version-*.exe" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $exe) {
  throw "Nao encontrei o executavel do CHAT HUB em $desktopRoot. Rode npm run build:desktop."
}

New-Item -ItemType Directory -Force -Path $userDir | Out-Null
$finalExeName = "CHAT-HUB-$version-Windows-x64.exe"
Copy-Item -LiteralPath $exe.FullName -Destination (Join-Path $userDir $finalExeName) -Force

$readmePtBr = @"
CHAT HUB - LEIA PRIMEIRO

Este pacote e para usuario final.

Como abrir:
1. Extraia este ZIP.
2. De dois cliques em $finalExeName.
3. Se o Windows mostrar um aviso de seguranca, clique em Mais informacoes e depois em Executar assim mesmo.

Voce nao precisa instalar Node.js.
Voce nao precisa rodar npm install.
Voce nao precisa baixar bibliotecas.

Nao use os arquivos "Source code.zip" ou "Source code.tar.gz" do GitHub para instalar o app.
Esses arquivos sao apenas para desenvolvedores.

Se algo nao abrir:
- confirme que voce esta no Windows 10 ou Windows 11;
- extraia o ZIP antes de abrir;
- tente mover a pasta para a Area de Trabalho;
- evite rodar direto de dentro do ZIP.
"@
Set-Content -LiteralPath (Join-Path $userDir "LEIA-ME-PRIMEIRO-PTBR.txt") -Value $readmePtBr -Encoding ASCII

$readmeEn = @"
CHAT HUB - READ FIRST

This package is for normal users.

How to open:
1. Extract this ZIP first.
2. Double-click $finalExeName.
3. If Windows shows a security warning, click More info and then Run anyway.

You do not need to install Node.js.
You do not need to run npm install.
You do not need to download libraries.

Do not use "Source code.zip" or "Source code.tar.gz" from GitHub to install the app.
Those files are for developers only.

If it does not open:
- confirm you are on Windows 10 or Windows 11;
- extract the ZIP before opening;
- try moving the folder to the Desktop;
- do not run the app from inside the ZIP preview.
"@
Set-Content -LiteralPath (Join-Path $userDir "README-FIRST-EN.txt") -Value $readmeEn -Encoding ASCII

$readmeEs = @"
CHAT HUB - LEE ESTO PRIMERO

Este paquete es para usuarios finales.

Como abrir:
1. Extrae este ZIP primero.
2. Haz doble clic en $finalExeName.
3. Si Windows muestra una alerta de seguridad, haz clic en Mas informacion y luego en Ejecutar de todos modos.

No necesitas instalar Node.js.
No necesitas ejecutar npm install.
No necesitas descargar bibliotecas.

No uses "Source code.zip" o "Source code.tar.gz" de GitHub para instalar la app.
Esos archivos son solo para desarrolladores.

Si no abre:
- confirma que usas Windows 10 o Windows 11;
- extrae el ZIP antes de abrir;
- intenta mover la carpeta al Escritorio;
- evita ejecutar la app desde la vista previa del ZIP.
"@
Set-Content -LiteralPath (Join-Path $userDir "LEE-ME-PRIMERO-ES.txt") -Value $readmeEs -Encoding ASCII

$releaseHint = @"
UPLOAD RECOMENDADO PARA GITHUB RELEASE

Para usuarios leigos, publique somente estes artefatos:
- CHAT-HUB-$version-USUARIO-FINAL.zip
- ou $finalExeName

Nao publique o pacote SOURCE-DEV para usuarios finais.
Evite destacar Source code.zip / Source code.tar.gz.
Eles sao gerados automaticamente pelo GitHub e exigem Node.js + npm install.
"@
Set-Content -LiteralPath $sourceHintPath -Value $releaseHint -Encoding ASCII

Compress-Archive -Path "$userDir\*" -DestinationPath $userZip -Force
Copy-Item -LiteralPath (Join-Path $userDir $finalExeName) -Destination (Join-Path $releaseRoot $finalExeName) -Force

Write-Output "Release de usuario final pronto:"
Write-Output $userZip
Write-Output (Join-Path $releaseRoot $finalExeName)
