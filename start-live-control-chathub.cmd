@echo off
setlocal

::        __     __
:: _|_   (_ ||\/|__) /\ _ _ _ _|   _
::  |    __)||  |__)/--|_| (_(_||_|/_
::                     |

cd /d %~dp0

echo.
echo CHAT HUB - modo codigo-fonte
echo.
echo Para uso normal, baixe o arquivo CHAT-HUB-...Windows-x64.exe na release.
echo Este atalho existe para quem baixou o ZIP de codigo e tem Node.js instalado.
echo.

where node >nul 2>nul
if errorlevel 1 goto missing_node

where npm >nul 2>nul
if errorlevel 1 goto missing_node

if not exist "node_modules\tiktok-live-connector" (
  echo Instalando componentes locais na primeira abertura...
  call npm install --omit=dev
  if errorlevel 1 goto install_failed
)

echo Abrindo CHAT HUB em http://127.0.0.1:4310
start "" "http://127.0.0.1:4310"
call npm start
if errorlevel 1 goto start_failed
goto done

:missing_node
echo.
echo Nao encontrei Node.js/npm neste Windows.
echo.
echo Caminho mais simples:
echo 1. Volte na pagina de release.
echo 2. Baixe o arquivo CHAT-HUB-...Windows-x64.exe.
echo 3. Abra esse arquivo.
echo.
echo Para rodar este ZIP de codigo, instale Node.js 20 ou superior.
pause
exit /b 1

:install_failed
echo.
echo Nao consegui instalar os componentes do ZIP de codigo.
echo Use o arquivo CHAT-HUB-...Windows-x64.exe da release para evitar essa etapa.
pause
exit /b 1

:start_failed
echo.
echo O servidor local nao abriu corretamente.
echo Tente usar o arquivo CHAT-HUB-...Windows-x64.exe da release.
pause
exit /b 1

:done
