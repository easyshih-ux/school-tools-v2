"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { describe, test } = require("node:test");

function httpResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body
  };
}

function loadAdapter(responses = []) {
  const calls = [];
  const queue = [...responses];
  const context = vm.createContext({
    window: { SCHOOL_TOOLS_CONFIG: { mode: "api", apiBaseUrl: "https://example.invalid/api" } },
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (!queue.length) throw new Error("unexpected fetch");
      return queue.shift();
    }
  });
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "api-client.js"), "utf8");
  vm.runInContext(source, context, { filename: "api-client.js" });
  return {
    setToken: (token) => vm.runInContext(`apiSession.token = ${JSON.stringify(token)}`, context),
    token: () => vm.runInContext("apiSession.token", context),
    update: (payload) => vm.runInContext(`updateTeacher(${JSON.stringify(payload)})`, context),
    calls
  };
}

describe("Gate 4B-2 frontend authenticated update adapter", () => {
  test("沒有 memory token 時不發出 POST", async () => {
    const adapter = loadAdapter();
    await assert.rejects(adapter.update({ name: "測試姓名" }), { name: "AuthRequiredError" });
    assert.equal(adapter.calls.length, 0);
  });

  test("使用既有 memory Bearer token POST 固定七欄並 trim", async () => {
    const adapter = loadAdapter([httpResponse(200, {
      success: true,
      action: "update",
      message: "資料已成功更新。",
      persisted: true
    })]);
    adapter.setToken("memory-token");
    const result = await adapter.update({ name: " 測試姓名 ", lineName: " 測試帳號 ", extra: "blocked" });
    assert.equal(result.action, "update");
    assert.equal(adapter.calls.length, 1);
    const call = adapter.calls[0];
    assert.equal(call.url, "https://example.invalid/api/teachers");
    assert.equal(call.options.method, "POST");
    assert.equal(call.options.cache, "no-store");
    assert.equal(call.options.headers.Authorization, "Bearer memory-token");
    assert.deepEqual(Object.keys(JSON.parse(call.options.body)), [
      "office", "title", "name", "lineName", "subject", "ext", "inSmallGroup"
    ]);
    assert.equal(JSON.parse(call.options.body).name, "測試姓名");
    assert.equal(JSON.parse(call.options.body).lineName, "測試帳號");
  });

  test("401 清除 memory token 並要求重新驗證", async () => {
    const adapter = loadAdapter([httpResponse(401, { error: "unauthorized" })]);
    adapter.setToken("expired-token");
    await assert.rejects(adapter.update({ name: "測試姓名" }), { name: "AuthRequiredError" });
    assert.equal(adapter.token(), null);
  });

  test("400 validation error 保留安全 status/code/details", async () => {
    const adapter = loadAdapter([httpResponse(400, {
      error: "validation_failed",
      details: [{ field: "name", code: "required" }]
    })]);
    adapter.setToken("memory-token");
    await assert.rejects(adapter.update({ name: "" }), (error) => {
      assert.equal(error.name, "ApiRequestError");
      assert.equal(error.status, 400);
      assert.equal(error.code, "validation_failed");
      assert.equal(error.details[0].field, "name");
      return true;
    });
  });

  test("429 不會自行重試", async () => {
    const adapter = loadAdapter([httpResponse(429, { error: "too_many_attempts" })]);
    adapter.setToken("memory-token");
    await assert.rejects(adapter.update({ name: "測試姓名" }), { status: 429 });
    assert.equal(adapter.calls.length, 1);
  });

  test("token 不使用 localStorage 或 sessionStorage", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "..", "api-client.js"), "utf8");
    assert.doesNotMatch(source, /localStorage|sessionStorage/);
  });
});

describe("Gate 4B-2 frontend success flow wiring", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "..", "app.js"), "utf8");

  test("成功 POST 後重新 GET 並 render，不以 local state 假裝成功", () => {
    const submitBlock = appSource.slice(
      appSource.indexOf("async function submitForm"),
      appSource.indexOf("function openAuth")
    );
    assert.match(submitBlock, /await updateTeacher\(payload\)/);
    assert.match(submitBlock, /await refreshTeachers\(\)/);
    assert.doesNotMatch(submitBlock, /state\.teachers\s*=/);
  });

  test("submit 有同步 in-flight guard 與 disabled 防重送", () => {
    assert.match(appSource, /teacherSubmitInFlight \|\|/);
    assert.match(appSource, /teacherSubmitInFlight = true/);
    assert.match(appSource, /elements\.submit\.disabled = true/);
    assert.match(appSource, /finally[\s\S]*teacherSubmitInFlight = false/);
  });
});
