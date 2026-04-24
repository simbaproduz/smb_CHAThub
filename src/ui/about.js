//        __     __                   
// _|_   (_ ||\/|__) /\ _ _ _ _|   _  
//  |    __)||  |__)/--|_| (_(_||_|/_ 
//                     |  

import {
  createEventStream,
  fetchJson,
  fetchSnapshot,
  renderHotkeysList,
  renderRuntimeCard
} from "./shared.js";
import {
  applyTranslations,
  initI18n,
  t
} from "./i18n.js";

const runtimeCard = document.querySelector("#runtimeCard");
const hotkeysList = document.querySelector("#hotkeysList");
const onboardingStartButton = document.querySelector("#onboardingStartButton");
let onboardingCtaReady = false;

async function markOnboardingSeen() {
  try {
    await fetchJson("/api/config/ui", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onboarding_seen: true })
    });
  } catch {
    try {
      localStorage.setItem("chat-hub-onboarding-seen", "true");
    } catch {
      // Local storage is only a browser fallback.
    }
  }
}

function render(snapshot) {
  if (runtimeCard) {
    renderRuntimeCard(runtimeCard, snapshot);
  }
  if (hotkeysList) {
    renderHotkeysList(hotkeysList, snapshot.settings?.ui?.hotkeys || {});
  }
  applyTranslations();
}

async function boot() {
  const initialSnapshot = await fetchSnapshot();
  initI18n(initialSnapshot);
  render(initialSnapshot);
  createEventStream(render);
  setTimeout(() => {
    onboardingCtaReady = true;
  }, 900);

  onboardingStartButton?.addEventListener("click", async () => {
    if (!onboardingCtaReady) {
      return;
    }
    onboardingStartButton.disabled = true;
    await markOnboardingSeen();
    window.location.href = "/settings.html?provider=twitch&focus=quickstart";
  });
}

boot().catch((error) => {
  if (runtimeCard) {
    runtimeCard.innerHTML = `<strong>${t("about.bootFailed")}</strong><span class="runtime-meta">${error.message}</span>`;
  }
});
