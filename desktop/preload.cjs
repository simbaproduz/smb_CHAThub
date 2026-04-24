//        __     __
// _|_   (_ ||\/|__) /\ _ _ _ _|   _
//  |    __)||  |__)/--|_| (_(_||_|/_
//                     |

const { contextBridge, ipcRenderer } = require("electron");

function injectDesktopChrome() {
  if (document.querySelector(".desktop-window-actions")) {
    return;
  }

  document.body.classList.add("is-desktop-app");

  const style = document.createElement("style");
  style.textContent = `
    html {
      background: transparent !important;
    }

    body.is-desktop-app {
      --desktop-shell-opacity: 0.85;
      --panel: rgba(13, 20, 35, 0.9);
      --panel-2: rgba(17, 26, 44, 0.88);
      --panel-3: rgba(23, 33, 54, 0.82);
      height: 100vh;
      min-height: 100vh;
      overflow: hidden;
      background: transparent !important;
    }

    body.is-desktop-app .app-frame {
      height: 100vh;
      min-height: 100vh;
      overflow: hidden;
      border: 1px solid rgba(154, 168, 194, 0.16);
      border-radius: 10px;
      background:
        radial-gradient(circle at 16% 0%, rgba(139, 92, 246, 0.12), transparent 32%),
        radial-gradient(circle at 92% 12%, rgba(236, 72, 153, 0.10), transparent 28%),
        linear-gradient(135deg, rgba(7, 11, 19, var(--desktop-shell-opacity)) 0%, rgba(8, 17, 31, var(--desktop-shell-opacity)) 52%, rgba(7, 9, 18, var(--desktop-shell-opacity)) 100%);
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.42);
    }

    body.is-desktop-app .sidebar {
      top: 0;
      height: 100vh;
      background:
        linear-gradient(180deg, rgba(12, 17, 31, 0.84), rgba(10, 12, 24, 0.84)),
        rgba(10, 15, 27, 0.82);
      backdrop-filter: blur(20px);
    }

    body.is-desktop-app .app-shell {
      min-height: 100vh;
    }

    body.is-desktop-app .page-header {
      padding-right: 104px;
    }

    body.is-desktop-app.page-monitor {
      height: 100vh;
      overflow: hidden;
    }

    body.is-desktop-app.page-monitor .app-frame {
      height: 100vh;
      min-height: 0;
      overflow: hidden;
    }

    body.is-desktop-app.page-monitor .app-shell {
      height: 100vh;
      min-height: 0;
      overflow: hidden;
    }

    body.is-desktop-app:not(.page-monitor) {
      height: 100vh;
      overflow: hidden;
    }

    body.is-desktop-app:not(.page-monitor) .app-frame {
      height: 100vh;
      min-height: 0;
      overflow: hidden;
    }

    body.is-desktop-app:not(.page-monitor) .app-shell {
      height: 100vh;
      min-height: 0;
      overflow-x: hidden;
      overflow-y: auto;
      padding-bottom: 54px;
      scrollbar-gutter: stable;
    }

    .desktop-window-drag-region {
      position: fixed;
      top: 0;
      left: 112px;
      right: 112px;
      z-index: 9998;
      height: 46px;
      -webkit-app-region: drag;
      user-select: none;
    }

    .desktop-window-actions {
      position: fixed;
      top: 10px;
      right: 12px;
      z-index: 10000;
      display: flex;
      gap: 8px;
      -webkit-app-region: no-drag;
    }

    .desktop-window-button {
      width: 38px;
      height: 32px;
      display: grid;
      place-items: center;
      border: 1px solid rgba(154, 168, 194, 0.16);
      border-radius: 8px;
      color: rgba(243, 247, 255, 0.82);
      background: rgba(8, 13, 24, 0.42);
      backdrop-filter: blur(16px);
      box-shadow: 0 12px 28px rgba(0, 0, 0, 0.22);
      cursor: default;
    }

    .desktop-window-button:hover {
      color: #ffffff;
      border-color: rgba(236, 72, 153, 0.42);
      background: rgba(139, 92, 246, 0.24);
    }

    .desktop-window-button.is-close:hover {
      background: rgba(239, 68, 68, 0.88);
    }

    .desktop-window-button svg {
      width: 13px;
      height: 13px;
      fill: currentColor;
    }
  `;
  document.head.appendChild(style);

  const dragRegion = document.createElement("div");
  dragRegion.className = "desktop-window-drag-region";
  dragRegion.setAttribute("aria-hidden", "true");

  const windowActions = document.createElement("div");
  windowActions.className = "desktop-window-actions";
  windowActions.setAttribute("aria-label", "Controles da janela");
  windowActions.innerHTML = `
      <button class="desktop-window-button" type="button" data-window-minimize aria-label="Minimizar">
        <svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="8" width="8" height="1.4" rx="0.7"/></svg>
      </button>
      <button class="desktop-window-button is-close" type="button" data-window-close aria-label="Fechar">
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.1 2.2 6 5.1l2.9-2.9 1 1L7 6.1 10 9l-1 1L6 7.1 3.1 10l-1-1 2.9-2.9-2.9-2.9 1-1Z"/></svg>
      </button>
  `;

  windowActions.querySelector("[data-window-minimize]").addEventListener("click", () => {
    ipcRenderer.invoke("window:minimize");
  });

  windowActions.querySelector("[data-window-close]").addEventListener("click", () => {
    ipcRenderer.invoke("window:close");
  });

  document.body.prepend(dragRegion, windowActions);
}

contextBridge.exposeInMainWorld("chatHubDesktop", {
  isDesktop: true
});

window.addEventListener("DOMContentLoaded", injectDesktopChrome);
