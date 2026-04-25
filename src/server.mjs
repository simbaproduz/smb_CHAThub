//        __     __                   
// _|_   (_ ||\/|__) /\ _ _ _ _|   _  
//  |    __)||  |__)/--|_| (_(_||_|/_ 
//                     |  

import { createReadStream } from "node:fs";
import { stat, readFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TwitchAuthManager } from "./adapters/twitch-auth.mjs";
import { MonitorRuntime } from "./core/monitor-runtime.mjs";
import { resolveQuickStartInput } from "./core/quick-start-resolver.mjs";
import { resolveRuntimeDir } from "./core/runtime-paths.mjs";

const ROOT_DIR = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const UI_DIR = path.join(ROOT_DIR, "src", "ui");
const ICON_DIR = path.join(ROOT_DIR, "icon");
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

const runtime = new MonitorRuntime(ROOT_DIR);
const twitchAuth = new TwitchAuthManager();
const sseClients = new Set();
const httpSockets = new Set();
const childProcesses = new Set();
let overlayProcess = null;
let overlayStderr = "";
let overlayReadyTimeout = null;

const OVERLAY_READY_TIMEOUT_MS = 12000;

let overlayState = {
  status: "closed",
  pid: null,
  monitor: null,
  bounds: null,
  error: null,
  openedAt: null
};

function trackChildProcess(child) {
  childProcesses.add(child);
  const forget = () => {
    childProcesses.delete(child);
  };
  child.on("exit", forget);
  child.on("close", forget);
  child.on("error", forget);
  return child;
}

function killProcessTree(child) {
  if (!child || child.killed || child.exitCode !== null || !child.pid) {
    return;
  }

  try {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore"
    });
  } catch {
    try {
      child.kill();
    } catch {
      // processo ja pode ter saido
    }
  }
}

function killTrackedChildProcesses() {
  for (const child of [...childProcesses]) {
    killProcessTree(child);
  }
  childProcesses.clear();
}

function runPowershellFile(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const child = trackChildProcess(spawn("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      ...args
    ], {
      cwd: ROOT_DIR,
      windowsHide: true
    }));

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `PowerShell script failed (${code}).`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

function sendSse(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const response of sseClients) {
    response.write(data);
  }
}

function sendHtml(response, statusCode, html) {
  response.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8" });
  response.end(html);
}

async function readJsonBody(request, { maxBytes = 1_048_576 } = {}) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      throw new Error("Payload muito grande.");
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function redirect(response, location) {
  response.writeHead(302, { Location: location });
  response.end();
}

function buildCallbackHtml({ ok, title, body }) {
  const accent = ok ? "#16a34a" : "#dc2626";
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #f8f5ee;
        color: #0f172a;
        font-family: Aptos, Segoe UI, sans-serif;
      }
      article {
        max-width: 620px;
        padding: 28px;
        border-radius: 24px;
        background: white;
        border: 1px solid rgba(15, 23, 42, 0.08);
        box-shadow: 0 24px 60px rgba(15, 23, 42, 0.12);
      }
      h1 {
        margin: 0 0 10px;
        font-size: 2rem;
      }
      p {
        line-height: 1.6;
      }
      strong {
        color: ${accent};
      }
    </style>
  </head>
  <body>
    <article>
      <h1>${title}</h1>
      <p>${body}</p>
      <p><strong>Voce pode fechar esta aba e voltar para o monitor.</strong></p>
    </article>
  </body>
</html>`;
}

async function serveStatic(response, requestPath) {
  const normalizedPath = requestPath === "/" ? "/index.html" : requestPath;
  const isIconRequest = normalizedPath.startsWith("/icon/");
  const baseDir = isIconRequest ? ICON_DIR : UI_DIR;
  const safePath = normalizedPath
    .replace(isIconRequest ? /^\/icon\/+/ : /^\/+/, "");
  const filePath = path.join(baseDir, safePath);
  const relativePath = path.relative(baseDir, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    sendJson(response, 403, { ok: false, error: "forbidden" });
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      sendJson(response, 404, { ok: false, error: "not_found" });
      return;
    }
  } catch {
    sendJson(response, 404, { ok: false, error: "not_found" });
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream"
  });
  createReadStream(filePath).pipe(response);
}

async function handleAction(action) {
  if (action === "demo:start") {
    return runtime.startDemo();
  }
  if (action === "replay:start") {
    return runtime.startReplay();
  }
  if (action === "runtime:reset") {
    return runtime.reset();
  }
  if (action === "twitch:drop_connection") {
    return runtime.forceTwitchDropConnection();
  }

  throw new Error(`Acao desconhecida: ${action}`);
}

function isProcessAlive() {
  return Boolean(overlayProcess && !overlayProcess.killed && overlayProcess.exitCode === null);
}

function setOverlayState(patch) {
  overlayState = { ...overlayState, ...patch };
  const sseData = `event: overlay\ndata: ${JSON.stringify(overlayState)}\n\n`;
  for (const res of sseClients) {
    res.write(sseData);
  }
}

function getOverlayStatus() {
  return {
    ...overlayState,
    running: overlayState.status === "open" || overlayState.status === "opening",
    pid: isProcessAlive() ? overlayProcess.pid : overlayState.pid
  };
}

const ALLOWED_OVERLAY_CORNERS = new Set(["top-left", "top-right", "bottom-left", "bottom-right"]);

function computeOverlayHeight(overlayConfig) {
  const fontLine = overlayConfig.font_size_px * overlayConfig.line_height;
  const cardWidth = Number.isFinite(Number(overlayConfig.card_width_px)) ? Number(overlayConfig.card_width_px) : 320;
  const widthDensity = cardWidth <= 360 ? 2.05 : cardWidth <= 420 ? 1.85 : 1.65;
  const hasMeta = Boolean(overlayConfig.show_platform_badge || overlayConfig.show_channel);
  const authorLine = Math.max(12, overlayConfig.font_size_px * 0.76) * 1.25;
  const metaLine = hasMeta ? 26 : 0;
  const metaGap = hasMeta ? 6 : 0;
  const bodyBlock = fontLine * widthDensity;
  const avatarFloor = overlayConfig.show_avatar ? 53 : 0;
  const cardHeight = Math.max(58, avatarFloor, 25 + metaLine + metaGap + authorLine + 6 + bodyBlock);
  const slotHeight = Math.round(cardHeight + overlayConfig.gap_px);
  return Math.round(Math.max(260, Math.min(1200, 12 + (overlayConfig.max_messages * slotHeight))));
}

function toPowershellBool(value) {
  return value ? "1" : "0";
}

function openOverlay({
  corner = "top-right",
  displayId = "",
  ignoreEnabled = false
} = {}) {
  const overlayConfig = runtime.getConfig().overlay || {};
  const normalizedCorner = ALLOWED_OVERLAY_CORNERS.has(corner)
    ? corner
    : ALLOWED_OVERLAY_CORNERS.has(overlayConfig.position)
      ? overlayConfig.position
      : "top-right";

  if (!ignoreEnabled && overlayConfig.enabled === false) {
    throw new Error("Overlay desativado nas configuracoes.");
  }

  if (isProcessAlive()) {
    closeOverlay();
  }

  clearTimeout(overlayReadyTimeout);
  overlayStderr = "";

  const scriptPath = path.join(ROOT_DIR, "tools", "overlay-runtime-window.ps1");
  const runtimeUrl = `http://localhost:${runtime.port}`;
  const width = Number.isFinite(Number(overlayConfig.card_width_px)) ? Number(overlayConfig.card_width_px) : 320;
  const height = computeOverlayHeight(overlayConfig);
  const displayTarget = displayId || overlayConfig.display_id || "primary";

  overlayProcess = trackChildProcess(spawn("powershell.exe", [
    "-NoProfile",
    "-STA",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    "-RuntimeUrl",
    runtimeUrl,
    "-Width",
    String(width),
    "-Height",
    String(height),
    "-Position",
    normalizedCorner,
    "-DisplayId",
    String(displayTarget),
    "-OffsetX",
    String(overlayConfig.offset_x ?? 32),
    "-OffsetY",
    String(overlayConfig.offset_y ?? 96),
    "-DurationMs",
    String(overlayConfig.duration_ms ?? 15000),
    "-MaxMessages",
    String(overlayConfig.max_messages ?? 6),
    "-FontSizePx",
    String(overlayConfig.font_size_px ?? 18),
    "-MessageFontWeight",
    String(overlayConfig.message_font_weight || "semibold"),
    "-LineHeight",
    String(overlayConfig.line_height ?? 1.25),
    "-GapPx",
    String(overlayConfig.gap_px ?? 6),
    "-BackgroundOpacity",
    String(overlayConfig.background_opacity ?? 80),
    "-ShowPlatformBadge",
    toPowershellBool(Boolean(overlayConfig.show_platform_badge)),
    "-ShowChannel",
    toPowershellBool(Boolean(overlayConfig.show_channel)),
    "-ShowAvatar",
    toPowershellBool(Boolean(overlayConfig.show_avatar)),
    "-Animation",
    String(overlayConfig.animation || "fade"),
    "-FilterMessages",
    toPowershellBool(Boolean(overlayConfig.filters?.messages)),
    "-FilterJoins",
    toPowershellBool(Boolean(overlayConfig.filters?.joins)),
    "-FilterAudienceUpdates",
    toPowershellBool(Boolean(overlayConfig.filters?.audience_updates)),
    "-FilterTechnicalEvents",
    toPowershellBool(Boolean(overlayConfig.filters?.technical_events)),
    "-PlatformsJson",
    JSON.stringify(overlayConfig.filters?.platforms || {})
  ], {
    cwd: ROOT_DIR,
    windowsHide: false,
    stdio: ["ignore", "ignore", "pipe"]
  }));

  overlayProcess.stderr.on("data", (chunk) => {
    overlayStderr += chunk.toString();
    if (overlayStderr.length > 2048) {
      overlayStderr = overlayStderr.slice(-2048);
    }
  });

  setOverlayState({
    status: "opening",
    pid: overlayProcess.pid,
    monitor: displayTarget,
    bounds: null,
    error: null,
    openedAt: new Date().toISOString()
  });

  overlayReadyTimeout = setTimeout(() => {
    if (overlayState.status === "opening") {
      setOverlayState({
        status: "failed",
        error: overlayStderr.trim() || "Timeout: overlay nao confirmou abertura em 12s."
      });
    }
  }, OVERLAY_READY_TIMEOUT_MS);

  const registeredProcess = overlayProcess;
  registeredProcess.on("exit", (code) => {
    if (overlayProcess !== registeredProcess) return;
    clearTimeout(overlayReadyTimeout);
    overlayProcess = null;
    const prevStatus = overlayState.status;
    if (prevStatus === "opening") {
      const err = overlayStderr.trim()
        || (code !== 0
          ? `Processo encerrou com codigo ${code} antes de confirmar abertura.`
          : "Processo encerrou sem confirmar abertura da janela.");
      setOverlayState({ status: "failed", pid: null, error: err });
    } else if (prevStatus === "open") {
      const err = code !== 0
        ? (overlayStderr.trim() || `Overlay encerrou inesperadamente (codigo ${code}).`)
        : null;
      setOverlayState({
        status: code !== 0 ? "failed" : "closed",
        pid: null,
        bounds: code !== 0 ? overlayState.bounds : null,
        error: err
      });
    } else {
      setOverlayState({ status: "closed", pid: null, bounds: null });
    }
  });

  return getOverlayStatus();
}

function closeOverlay() {
  clearTimeout(overlayReadyTimeout);

  if (!isProcessAlive()) {
    overlayProcess = null;
    setOverlayState({ status: "closed", pid: null, bounds: null });
    return getOverlayStatus();
  }

  setOverlayState({ status: "closing" });

  killProcessTree(overlayProcess);

  return getOverlayStatus();
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const { pathname } = url;

  if (request.method === "GET" && pathname === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" && pathname === "/api/snapshot") {
    sendJson(response, 200, { ok: true, snapshot: runtime.getSnapshot() });
    return;
  }

  if (request.method === "POST" && pathname === "/api/cache/chat/clear") {
    try {
      const result = await runtime.clearChatCache();
      sendJson(response, 200, { ok: true, ...result });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "GET" && pathname === "/api/config") {
    sendJson(response, 200, { ok: true, config: runtime.getConfig() });
    return;
  }

  if (request.method === "GET" && pathname === "/api/stream") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    response.write(`data: ${JSON.stringify(runtime.getSnapshot())}\n\n`);
    sseClients.add(response);

    request.on("close", () => {
      sseClients.delete(response);
    });
    return;
  }

  if (request.method === "POST" && pathname.startsWith("/api/actions/")) {
    try {
      const action = pathname.replace("/api/actions/", "").replaceAll("/", ":");
      const snapshot = await handleAction(action);
      sendJson(response, 200, { ok: true, snapshot });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && pathname === "/api/overlay/open") {
    try {
      const body = await readJsonBody(request);
      sendJson(response, 200, {
        ok: true,
        overlay: openOverlay({
          corner: body.corner,
          displayId: body.display_id
        })
      });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && pathname === "/api/overlay/close") {
    sendJson(response, 200, { ok: true, overlay: closeOverlay() });
    return;
  }

  if (request.method === "GET" && pathname === "/api/overlay/status") {
    sendJson(response, 200, { ok: true, overlay: getOverlayStatus() });
    return;
  }

  if (request.method === "POST" && pathname === "/api/overlay/ready") {
    try {
      const body = await readJsonBody(request);
      clearTimeout(overlayReadyTimeout);
      setOverlayState({
        status: "open",
        pid: Number(body.pid) || (isProcessAlive() ? overlayProcess.pid : overlayState.pid),
        bounds: {
          x: Number(body.x) || 0,
          y: Number(body.y) || 0,
          width: Number(body.width) || 0,
          height: Number(body.height) || 0
        },
        monitor: String(body.monitor || overlayState.monitor || ""),
        error: null
      });
      sendJson(response, 200, { ok: true });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "GET" && pathname === "/api/overlay/debug") {
    let logContent = "(sem log — overlay-debug.log ainda nao existe)";
    try {
      const logPath = path.join(resolveRuntimeDir(ROOT_DIR), "overlay-debug.log");
      const raw = await readFile(logPath, "utf8");
      logContent = raw.length > 4000 ? raw.slice(-4000) : raw;
    } catch {
      // arquivo ainda nao foi criado pelo PS1
    }
    sendJson(response, 200, {
      ok: true,
      state: overlayState,
      stderr: overlayStderr || "(sem stderr)",
      process_alive: isProcessAlive(),
      log: logContent
    });
    return;
  }

  if (request.method === "GET" && pathname === "/api/overlay/displays") {
    try {
      const scriptPath = path.join(ROOT_DIR, "tools", "overlay-displays.ps1");
      const output = await runPowershellFile(scriptPath);
      const displays = JSON.parse(output || "[]");
      sendJson(response, 200, { ok: true, supported: true, displays });
    } catch (error) {
      sendJson(response, 200, { ok: true, supported: false, reason: error.message, displays: [] });
    }
    return;
  }

  if (request.method === "POST" && pathname === "/api/overlay/identify") {
    try {
      const scriptPath = path.join(ROOT_DIR, "tools", "overlay-identify-displays.ps1");
      await runPowershellFile(scriptPath);
      sendJson(response, 200, { ok: true });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && pathname === "/api/overlay/test") {
    try {
      const body = await readJsonBody(request);
      sendJson(response, 200, {
        ok: true,
        overlay: openOverlay({
          displayId: body.display_id,
          ignoreEnabled: true
        })
      });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && pathname.startsWith("/api/config/providers/")) {
    try {
      const providerKey = pathname.replace("/api/config/providers/", "");
      const body = await readJsonBody(request);
      const snapshot = await runtime.updateProviderConfig(providerKey, body);
      sendJson(response, 200, { ok: true, snapshot });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && pathname === "/api/config/overlay") {
    try {
      const body = await readJsonBody(request);
      const snapshot = await runtime.updateOverlayConfig(body);
      sendJson(response, 200, { ok: true, snapshot });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && pathname === "/api/config/ui") {
    try {
      const body = await readJsonBody(request);
      const snapshot = await runtime.updateUiConfig(body);
      sendJson(response, 200, { ok: true, snapshot });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && pathname === "/api/quick-start/resolve") {
    try {
      const body = await readJsonBody(request);
      const resolution = await resolveQuickStartInput(body.raw_input);
      sendJson(response, 200, { ok: true, resolution });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && pathname === "/api/providers/twitch/oauth/start") {
    try {
      const config = runtime.getConfig().providers.twitch;
      const auth = twitchAuth.createAuthorizationUrl(config);
      sendJson(response, 200, { ok: true, authorization_url: auth.url, scopes: auth.scopes });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && pathname === "/api/providers/twitch/token/validate") {
    try {
      const config = runtime.getConfig().providers.twitch;
      const { validation, user } = await twitchAuth.validateUserToken(config, config.access_token);
      const patch = twitchAuth.buildProviderPatchFromAuth(
        config,
        {
          access_token: config.access_token,
          refresh_token: config.refresh_token,
          expires_in: config.token_expires_at
            ? Math.max(0, Math.floor((Date.parse(config.token_expires_at) - Date.now()) / 1000))
            : 0,
          scope: config.scopes
        },
        validation,
        user
      );
      const snapshot = await runtime.updateProviderConfig("twitch", patch);
      sendJson(response, 200, { ok: true, snapshot });
    } catch (error) {
      const snapshot = await runtime.updateProviderConfig("twitch", {
        auth_status: "error",
        auth_error: error.message
      });
      sendJson(response, 400, { ok: false, error: error.message, snapshot });
    }
    return;
  }

  if (request.method === "GET" && pathname === "/auth/twitch/callback") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");

    if (error) {
      await runtime.updateProviderConfig("twitch", {
        auth_status: "error",
        auth_error: errorDescription || error
      });
      sendHtml(response, 400, buildCallbackHtml({
        ok: false,
        title: "Twitch nao autorizou",
        body: `A Twitch devolveu o erro: ${errorDescription || error}.`
      }));
      return;
    }

    try {
      twitchAuth.consumeState(state);
      const config = runtime.getConfig().providers.twitch;
      const tokenPayload = await twitchAuth.exchangeCodeForToken(config, code);
      const { validation, user } = await twitchAuth.validateUserToken(config, tokenPayload.access_token);
      const patch = twitchAuth.buildProviderPatchFromAuth(config, tokenPayload, validation, user);
      await runtime.updateProviderConfig("twitch", patch);

      sendHtml(response, 200, buildCallbackHtml({
        ok: true,
        title: "Twitch conectada",
        body: `Conta autenticada como ${user.display_name || user.login}. A base local ja recebeu token e identidade da conta.`
      }));
    } catch (callbackError) {
      await runtime.updateProviderConfig("twitch", {
        auth_status: "error",
        auth_error: callbackError.message
      });
      sendHtml(response, 400, buildCallbackHtml({
        ok: false,
        title: "Falha na conexao Twitch",
        body: callbackError.message
      }));
    }
    return;
  }

  if (request.method === "GET") {
    await serveStatic(response, pathname);
    return;
  }

  sendJson(response, 404, { ok: false, error: "not_found" });
});

server.on("connection", (socket) => {
  httpSockets.add(socket);
  socket.on("close", () => {
    httpSockets.delete(socket);
  });
});

runtime.on("change", (snapshot) => {
  sendSse(snapshot);
});

function closeSseClients() {
  for (const response of sseClients) {
    try {
      response.end();
    } catch {
      // cliente ja pode ter desconectado
    }
  }
  sseClients.clear();
}

function destroyHttpSockets() {
  for (const socket of httpSockets) {
    try {
      socket.destroy();
    } catch {
      // socket ja pode ter fechado
    }
  }
  httpSockets.clear();
}

function closeHttpServer({ force = false, timeoutMs = 2500 } = {}) {
  closeSseClients();

  if (!server.listening) {
    destroyHttpSockets();
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve();
    };

    const timer = setTimeout(() => {
      destroyHttpSockets();
      finish();
    }, timeoutMs);
    timer.unref?.();

    server.close(finish);
    server.closeIdleConnections?.();

    if (force) {
      server.closeAllConnections?.();
      destroyHttpSockets();
    }
  });
}

export async function startChatHubServer({
  forceDemo = false,
  host = "127.0.0.1",
  logStartup = true
} = {}) {
  const snapshot = await runtime.boot({ forceDemo });
  const port = snapshot.runtime.port;
  const url = `http://localhost:${port}`;

  if (!server.listening) {
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };

      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, host);
    });
  }

  if (logStartup) {
    console.log(JSON.stringify({
      ok: true,
      url,
      config_path: snapshot.runtime.config_path,
      active_adapters: snapshot.runtime.active_adapters
    }, null, 2));
  }

  return {
    url,
    port,
    snapshot,
    runtime_dir: resolveRuntimeDir(ROOT_DIR)
  };
}

export async function stopChatHubServer({ exitCode = null, force = false } = {}) {
  clearTimeout(overlayReadyTimeout);
  closeOverlay();
  killTrackedChildProcesses();
  closeSseClients();
  await runtime.stopAllAdapters();
  await closeHttpServer({ force });

  if (exitCode !== null) {
    process.exit(exitCode);
  }
}

function isMainEntry() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainEntry()) {
  const shutdown = () => {
    stopChatHubServer({ exitCode: 0 });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  startChatHubServer({
    forceDemo: process.argv.includes("--demo")
  }).catch(async (error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    await runtime.stopAllAdapters();
    process.exitCode = 1;
  });
}
