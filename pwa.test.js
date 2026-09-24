"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const { describe, test } = require("node:test");

const ROOT = __dirname;
const BASELINE = "11228e5ca975893706b9c9de8b570b46d5441f57";

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

describe("Gate 5 service worker safety", () => {
  const worker = read("sw.js");

  test("明確版本 cache 且 activate 刪除舊版本", () => {
    assert.match(worker, /CACHE_VERSION = "school-tools-v2-shell-v1"/);
    assert.match(worker, /key !== CACHE_VERSION/);
    assert.match(worker, /caches\.delete\(key\)/);
  });

  test("API、跨 origin、非 GET request 完全 bypass", () => {
    assert.match(worker, /request\.method !== "GET"\) return/);
    assert.match(worker, /url\.origin !== self\.location\.origin \|\| isSensitiveApiPath/);
    assert.match(worker, /"\/auth\/session"/);
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
  test("API、認證、Sheets、token、rate limit、schema 與前端資料邏輯未變", () => {
    childProcess.execFileSync("git", [
      "diff", "--exit-code", BASELINE, "--",
      "functions", "app.js", "api-client.js", "config.js", "mock-data.js", "firebase.json"
    ], { cwd: ROOT, stdio: "pipe" });
  });

  test("Pages workflow 只加入 PWA 靜態資產", () => {
    const workflow = read(".github/workflows/pages.yml");
    for (const asset of ["pwa.js", "sw.js", "manifest.webmanifest", "icons"]) {
      assert.match(workflow, new RegExp(asset.replace(".", "\\.")));
    }
    assert.doesNotMatch(workflow, /functions\/|\.env|secret/i);
  });
});
