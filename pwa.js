"use strict";

const STAGING_CANONICAL_PATH = "/school-tools-v2/";

function classifyInstallEnvironment({
  userAgent = "",
  vendor = "",
  platform = "",
  maxTouchPoints = 0
} = {}) {
  const ua = String(userAgent);
  const isIos = /iPad|iPhone|iPod/i.test(ua) ||
    (platform === "MacIntel" && Number(maxTouchPoints) > 1);
  const isAndroid = /Android/i.test(ua);
  const isLine = /Line\//i.test(ua);
  const isOtherInApp = /FBAN|FBAV|Instagram|;\s*wv\)|\bwv\b/i.test(ua);
  const isChrome = /Chrome|CriOS/i.test(ua) && !/Edg|OPR|SamsungBrowser/i.test(ua);
  const isSafari = isIos && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);

  if (isLine || isOtherInApp) {
    return { kind: "in-app", isIos, isAndroid };
  }
  if (isIos && isSafari) return { kind: "ios-safari", isIos, isAndroid };
  if (isAndroid && isChrome && /Google Inc\./i.test(vendor)) {
    return { kind: "android-chrome", isIos, isAndroid };
  }
  return { kind: "desktop-or-unsupported", isIos, isAndroid };
}

function shouldShowInstallButton({ kind }, hasPrompt, standalone) {
  if (standalone) return false;
  if (kind === "in-app" || kind === "ios-safari" || kind === "android-chrome") return true;
  return Boolean(hasPrompt);
}

function installGuideFor(environment) {
  if (environment.kind === "ios-safari") {
    return "點選 Safari「分享」→「加入主畫面」";
  }
  if (environment.kind === "in-app" && environment.isIos) {
    return "請先用 Safari 開啟，再點選 Safari「分享」→「加入主畫面」。";
  }
  if (environment.kind === "in-app" && environment.isAndroid) {
    return "請先用 Chrome 開啟，再選擇「安裝應用程式」或「加到主畫面」。";
  }
  if (environment.kind === "in-app") {
    return "請複製網址後，以 Safari 或 Chrome 開啟並加入主畫面。";
  }
  if (environment.kind === "android-chrome") {
    return "若未出現安裝視窗，請開啟 Chrome 選單，選擇「安裝應用程式」或「加到主畫面」。";
  }
  return "此瀏覽器目前未提供安裝功能。";
}

function isStandaloneDisplay(windowObject, navigatorObject) {
  return Boolean(navigatorObject.standalone) ||
    windowObject.matchMedia("(display-mode: standalone)").matches;
}

function canonicalInstallUrl(locationObject) {
  return new URL(STAGING_CANONICAL_PATH, locationObject.origin).href;
}

function initializeInstallUi(windowObject = window, navigatorObject = navigator, documentObject = document) {
  const button = documentObject.getElementById("btnInstallApp");
  const overlay = documentObject.getElementById("installOverlay");
  const guide = documentObject.getElementById("installGuideText");
  const copy = documentObject.getElementById("btnCopyInstallUrl");
  const close = documentObject.getElementById("btnCloseInstallGuide");
  const copyStatus = documentObject.getElementById("installCopyStatus");
  if (!button || !overlay || !guide || !copy || !close || !copyStatus) return;

  const environment = classifyInstallEnvironment(navigatorObject);
  let deferredPrompt = null;

  function standalone() {
    return isStandaloneDisplay(windowObject, navigatorObject);
  }

  function refreshVisibility() {
    button.hidden = !shouldShowInstallButton(environment, Boolean(deferredPrompt), standalone());
  }

  function closeGuide() {
    overlay.classList.remove("active");
    overlay.setAttribute("aria-hidden", "true");
    copyStatus.textContent = "";
    button.focus();
  }

  function showGuide() {
    guide.textContent = installGuideFor(environment);
    copy.hidden = environment.kind !== "in-app";
    copyStatus.textContent = "";
    overlay.classList.add("active");
    overlay.setAttribute("aria-hidden", "false");
    close.focus();
  }

  windowObject.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    refreshVisibility();
  });

  windowObject.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    button.hidden = true;
    closeGuide();
  });

  const displayMode = windowObject.matchMedia("(display-mode: standalone)");
  if (typeof displayMode.addEventListener === "function") {
    displayMode.addEventListener("change", refreshVisibility);
  }

  button.addEventListener("click", async () => {
    if (standalone()) {
      refreshVisibility();
      return;
    }
    if (deferredPrompt) {
      const prompt = deferredPrompt;
      deferredPrompt = null;
      await prompt.prompt();
      await prompt.userChoice.catch(() => null);
      refreshVisibility();
      return;
    }
    showGuide();
  });

  copy.addEventListener("click", async () => {
    const url = canonicalInstallUrl(windowObject.location);
    try {
      await navigatorObject.clipboard.writeText(url);
    } catch {
      const input = documentObject.createElement("input");
      input.value = url;
      documentObject.body.append(input);
      input.select();
      documentObject.execCommand("copy");
      input.remove();
    }
    copyStatus.textContent = "網址已複製";
  });

  close.addEventListener("click", closeGuide);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeGuide();
  });
  documentObject.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && overlay.classList.contains("active")) closeGuide();
  });

  refreshVisibility();
}

function registerServiceWorker(navigatorObject = navigator) {
  if (!("serviceWorker" in navigatorObject)) return Promise.resolve(null);
  return navigatorObject.serviceWorker.register("./sw.js", {
    scope: "./",
    updateViaCache: "none"
  }).then((registration) => {
    registration.update();
    return registration;
  }).catch(() => null);
}

if (typeof window !== "undefined" && typeof navigator !== "undefined" && typeof document !== "undefined") {
  initializeInstallUi();
  window.addEventListener("load", () => registerServiceWorker());
}

if (typeof module !== "undefined") {
  module.exports = {
    STAGING_CANONICAL_PATH,
    canonicalInstallUrl,
    classifyInstallEnvironment,
    installGuideFor,
    isStandaloneDisplay,
    shouldShowInstallButton
  };
}
