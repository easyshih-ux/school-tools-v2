"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const { describe, test } = require("node:test");

const ROOT = __dirname;
const BASELINE = "11228e5ca975893706b9c9de8b570b46d5441f57";
const GATE_55_BASELINE = "2c81cad038e266045c15e5f7772a11572ed058c5";
const {
  canonicalInstallUrl,
  classifyInstallEnvironment,
  installGuideFor,
  shouldShowInstallButton
} = require("./pwa.js");

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function pngDimensions(file) {
  const data = fs.readFileSync(path.join(ROOT, file));
  assert.equal(data.subarray(1, 4).toString("ascii"), "PNG");
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

describe("Gate 5 PWA manifest and metadata", () => {
  test("manifest 使用 staging scope/start URL 與指定品牌色", () => {
    const manifest = JSON.parse(read("manifest.webmanifest"));
    assert.equal(manifest.name, "義學 LINE 查詢");
    assert.equal(manifest.short_name, "義學LINE");
    assert.equal(manifest.start_url, "/school-tools-v2/");
    assert.equal(manifest.scope, "/school-tools-v2/");
    assert.equal(manifest.display, "standalone");
    assert.equal(manifest.theme_color, "#02773c");
    assert.equal(manifest.background_color, "#ffffff");
    assert.deepEqual(manifest.icons.map((icon) => [icon.src, icon.sizes, icon.purpose]), [
      ["icons/icon-192.png", "192x192", "any"],
      ["icons/icon-512.png", "512x512", "any"],
      ["icons/icon-maskable-192.png", "192x192", "maskable"],
      ["icons/icon-maskable-512.png", "512x512", "maskable"]
    ]);
  });

  test("五個 PNG 尺寸正確", () => {
    for (const [file, size] of [
      ["icons/icon-192.png", 192],
      ["icons/icon-512.png", 512],
      ["icons/icon-maskable-192.png", 192],
      ["icons/icon-maskable-512.png", 512],
      ["icons/apple-touch-icon.png", 180]
    ]) {
      assert.deepEqual(pngDimensions(file), { width: size, height: size });
    }
  });

  test("HTML 含 manifest、Android/iOS metadata、viewport-fit 與唯一品牌 Footer", () => {
    const html = read("index.html");
    assert.match(html, /rel="manifest" href="manifest\.webmanifest"/);
    assert.match(html, /apple-mobile-web-app-capable" content="yes"/);
    assert.match(html, /apple-mobile-web-app-status-bar-style" content="default"/);
    assert.match(html, /apple-mobile-web-app-title" content="義學LINE"/);
    assert.match(html, /rel="apple-touch-icon" sizes="180x180"/);
    assert.match(html, /viewport-fit=cover/);
    assert.equal((html.match(/Made by WenYi/g) || []).length, 1);
  });
});

describe("Gate 5 Header branding", () => {
  test("使用既有正式 App icon 且不再顯示通訊錄 icon", () => {
    const html = read("index.html");
    assert.match(html, /<img class="logo-icon" src="icons\/icon-192\.png"/);
    assert.doesNotMatch(html, /fa-address-book/);
    assert.match(html, /義學國中 LINE 帳號查詢/);
    assert.match(html, /安裝義學 LINE 查詢/);
  });
});
describe("Gate 5 visible install experience", () => {
  const androidChrome = classifyInstallEnvironment({
    userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36",
    vendor: "Google Inc."
  });
  const iphoneSafari = classifyInstallEnvironment({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
    vendor: "Apple Computer, Inc."
  });

  test("Header 含安裝按鈕、icon、引導 dialog 與 staging canonical URL", () => {
    const html = read("index.html");
    assert.match(html, /id="btnInstallApp"[^>]*hidden/);
    assert.match(html, /fa-solid fa-download/);
    assert.match(html, />\s*安裝義學 LINE 查詢\s*</);
    assert.match(html, /id="installOverlay"/);
    assert.match(html, /id="btnCopyInstallUrl"/);
    assert.match(html, /rel="canonical" href="https:\/\/easyshih-ux\.github\.io\/school-tools-v2\/"/);
  });

  test("Android Chrome 有 native prompt 時直接安裝，尚無 event 時仍提供說明", () => {
    assert.equal(androidChrome.kind, "android-chrome");
    assert.equal(shouldShowInstallButton(androidChrome, true, false), true);
    assert.equal(shouldShowInstallButton(androidChrome, false, false), true);
    assert.match(installGuideFor(androidChrome), /Chrome.*安裝應用程式|Chrome.*加到主畫面/);
    const script = read("pwa.js");
    assert.match(script, /beforeinstallprompt/);
    assert.match(script, /await prompt\.prompt\(\)/);
  });

  test("iPhone Safari 顯示指定加入主畫面教學", () => {
    assert.equal(iphoneSafari.kind, "ios-safari");
    assert.equal(shouldShowInstallButton(iphoneSafari, false, false), true);
    assert.equal(installGuideFor(iphoneSafari), "點選 Safari「分享」→「加入主畫面」");
  });

  test("LINE/in-app browser 顯示平台引導及複製 staging URL", () => {
    const androidLine = classifyInstallEnvironment({
      userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36 Line/15.0.0",
      vendor: "Google Inc."
    });
    const iosLine = classifyInstallEnvironment({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Line/15.0.0"
    });
    assert.equal(androidLine.kind, "in-app");
    assert.equal(iosLine.kind, "in-app");
    assert.match(installGuideFor(androidLine), /Chrome/);
    assert.match(installGuideFor(iosLine), /Safari/);
    assert.equal(canonicalInstallUrl({ origin: "https://easyshih-ux.github.io" }), "https://easyshih-ux.github.io/school-tools-v2/");
    assert.match(read("pwa.js"), /navigatorObject\.clipboard\.writeText\(url\)/);
  });

  test("standalone 隱藏；desktop 僅在瀏覽器提供 native prompt 時顯示", () => {
    const desktop = classifyInstallEnvironment({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
      vendor: "Google Inc."
    });
    assert.equal(desktop.kind, "desktop-or-unsupported");
    assert.equal(shouldShowInstallButton(androidChrome, true, true), false);
    assert.equal(shouldShowInstallButton(desktop, false, false), false);
    assert.equal(shouldShowInstallButton(desktop, true, false), true);
  });
});
describe("Gate 5 service worker safety", () => {
  const worker = read("sw.js");

  test("明確版本 cache 且 activate 刪除舊版本", () => {
    assert.match(worker, /CACHE_VERSION = "school-tools-v2-shell-v3"/);
    assert.match(worker, /key !== CACHE_VERSION/);
    assert.match(worker, /caches\.delete\(key\)/);
  });

  test("API、跨 origin、非 GET request 完全 bypass", () => {
    assert.match(worker, /request\.method !== "GET"\) return/);
    assert.match(worker, /url\.origin !== self\.location\.origin \|\| isSensitiveApiPath/);
    assert.match(worker, /"\/auth\/session"/);
    assert.match(worker, /"\/auth\/refresh"/);
    assert.match(worker, /"\/auth\/logout"/);
    assert.match(worker, /"\/teachers"/);
    const staticBlock = worker.slice(worker.indexOf("const STATIC_ASSETS"), worker.indexOf("]);", worker.indexOf("const STATIC_ASSETS")) + 3);
    assert.doesNotMatch(staticBlock, /auth\/session|teachers|cloudfunctions/);
  });

  test("只 cache 明列公開 shell 且 network-first no-cache", () => {
    assert.match(worker, /STATIC_ASSETS\.includes\(url\.pathname\)/);
    assert.match(worker, /fetch\(request, \{ cache: "no-cache" \}\)/);
    const staticBlock = worker.slice(worker.indexOf("const STATIC_ASSETS"), worker.indexOf("]);", worker.indexOf("const STATIC_ASSETS")) + 3);
    assert.doesNotMatch(staticBlock, /apiSession|Authorization|Bearer|teacher/);
  });
});

describe("Gate 5 frozen boundary and Pages artifact", () => {
  test("Gate 4 Sheets/schema/write lock 與 Gate 5 manifest/icons/install UI 維持凍結", () => {
    childProcess.execFileSync("git", [
      "diff", "--exit-code", GATE_55_BASELINE, "--",
      "functions/src/sheets-mapper.js", "functions/src/sheets-reader.js", "functions/src/sheets-writer.js",
      "functions/src/teacher-update.js", "functions/src/teachers.js", "functions/src/write-lock.js",
      "mock-data.js", "manifest.webmanifest", "icons", "styles.css", "pwa.js"
    ], { cwd: ROOT, stdio: "pipe" });
  });

  test("Pages workflow 只加入 PWA 靜態資產", () => {
    const workflow = read(".github/workflows/pages.yml");
    for (const asset of ["device-session-store.js", "pwa.js", "sw.js", "manifest.webmanifest", "icons"]) {
      assert.match(workflow, new RegExp(asset.replace(".", "\\.")));
    }
    assert.doesNotMatch(workflow, /functions\/|\.env|secret/i);
  });
});
