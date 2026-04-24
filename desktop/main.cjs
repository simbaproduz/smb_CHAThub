//        __     __
// _|_   (_ ||\/|__) /\ _ _ _ _|   _
//  |    __)||  |__)/--|_| (_(_||_|/_
//                     |

const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const APP_NAME = "CHAT HUB";
const APP_ID = "com.simbaproduz.chathub";

let mainWindow = null;
let stopServer = null;
let cleanupStarted = false;

app.setName(APP_NAME);
app.setAppUserModelId(APP_ID);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

function getAppRoot() {
  return app.getAppPath();
}

function getIconPath() {
  return path.join(getAppRoot(), "icon", "simba.ico");
}

function configureRuntimePaths() {
  process.env.CHAT_HUB_DESKTOP = "1";
  process.env.CHAT_HUB_RUNTIME_DIR = process.env.CHAT_HUB_RUNTIME_DIR || path.join(app.getPath("userData"), "runtime");
}

async function startLocalRuntime() {
  configureRuntimePaths();
  const serverModulePath = path.join(getAppRoot(), "src", "server.mjs");
  const serverModule = await import(pathToFileURL(serverModulePath).href);
  stopServer = serverModule.stopChatHubServer;
  return serverModule.startChatHubServer({
    forceDemo: false,
    logStartup: false
  });
}

function getInitialWindowUrl(runtimeInfo) {
  const hasSeenOnboarding = runtimeInfo.snapshot?.settings?.ui?.onboarding_seen === true;
  return hasSeenOnboarding ? runtimeInfo.url : new URL("/about.html", runtimeInfo.url).href;
}

function createMainWindow(runtimeInfo) {
  const baseUrl = runtimeInfo.url;
  const initialUrl = getInitialWindowUrl(runtimeInfo);

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    frame: false,
    titleBarStyle: "hidden",
    autoHideMenuBar: true,
    transparent: true,
    title: APP_NAME,
    backgroundColor: "#00000000",
    icon: getIconPath(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(getAppRoot(), "desktop", "preload.cjs")
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(baseUrl)) {
      return { action: "allow" };
    }

    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(baseUrl)) {
      return;
    }

    event.preventDefault();
    shell.openExternal(url);
  });

  mainWindow.webContents.on("page-title-updated", (event) => {
    event.preventDefault();
    mainWindow?.setTitle(APP_NAME);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.loadURL(initialUrl);
}

async function cleanupAndExit(exitCode = 0) {
  if (cleanupStarted) {
    return;
  }

  cleanupStarted = true;
  try {
    if (stopServer) {
      await stopServer();
    }
  } finally {
    process.exitCode = exitCode;
    app.exit(exitCode);
    setTimeout(() => {
      process.exit(exitCode);
    }, 250).unref();
  }
}

ipcMain.handle("window:minimize", () => {
  mainWindow?.minimize();
});

ipcMain.handle("window:close", () => {
  return cleanupAndExit(0);
});

app.on("second-instance", () => {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.focus();
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", (event) => {
  if (cleanupStarted) {
    return;
  }

  event.preventDefault();
  cleanupAndExit(0);
});

app.whenReady().then(async () => {
  try {
    const runtime = await startLocalRuntime();
    createMainWindow(runtime);
  } catch (error) {
    dialog.showErrorBox(APP_NAME, error?.message || String(error));
    cleanupAndExit(1);
  }
});
