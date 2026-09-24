"use strict";

const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const { createApi } = require("../src/app");
const { MemoryRateLimiter } = require("../src/rate-limit");
const { issueToken } = require("../src/security");
const { SheetsWriteError } = require("../src/sheets-writer");

const NOW_MS = 2_000_000_000_000;
const SIGNING_KEY = "fictional-signing-key-for-gate-4b-tests-only";
const RATE_KEY = "fictional-rate-key-for-gate-4b-tests-only";

function responseMock() {
  return {
    statusCode: 200, headers: {}, body: "",
    setHeader(name, value) { this.headers[name.toLowerCase()] = String(value); },
    end(value = "") { this.body = String(value); }
  };
}
function requestMock({ method = "POST", headers = {}, body } = {}) {
  return { method, path: "/teachers", url: "/teachers", headers, body, ip: "192.0.2.55", socket: { remoteAddress: "192.0.2.55" } };
}
async function invoke(handler, request) {
  const response = responseMock();
  await handler(request, response);
  return response;
}
function makeHandler(writeTeacher) {
  return createApi({
    getAccessPassword: () => "fictional-password-for-gate-4b-tests-only",
    getSigningKey: () => SIGNING_KEY,
    getRateLimitKey: () => RATE_KEY,
    allowedOrigins: ["https://easyshih-ux.github.io"],
    rateLimiter: new MemoryRateLimiter(),
    writeTeacher,
    now: () => NOW_MS
  });
}
function authorization() {
  const value = issueToken({ signingKey: SIGNING_KEY, nowSeconds: Math.floor(NOW_MS / 1000) });
  return { authorization: `Bearer ${value}` };
}

describe("Gate 4B write API wiring", () => {
  test("未授權不呼叫 writer", async () => {
    let called = false;
    const response = await invoke(makeHandler(async () => { called = true; }), requestMock({ body: { name: "王範例" } }));
    assert.equal(response.statusCode, 401);
    assert.equal(called, false);
  });

  test("授權成功只傳 payload 與不可逆 request hash", async () => {
    let received;
    const handler = makeHandler(async (payload, context) => {
      received = { payload, context };
      return { action: "update", message: "成功更新測試資料", validation: { valid: true, errors: [] } };
    });
    const response = await invoke(handler, requestMock({
      headers: authorization(),
      body: { name: "王範例", lineName: "測試帳號02" }
    }));
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 200);
    assert.equal(body.persisted, true);
    assert.equal(body.simulated, false);
    assert.equal(body.message, "資料已成功更新。");
    assert.doesNotMatch(body.message, /王範例/);
    assert.deepEqual(received.payload, { name: "王範例", lineName: "測試帳號02" });
    assert.match(received.context.requestHash, /^[a-f0-9]{64}$/);
  });

  test("正式第一階段 insert disabled 映射為 409", async () => {
    const handler = makeHandler(async () => { throw new SheetsWriteError("insert_not_enabled"); });
    const response = await invoke(handler, requestMock({ headers: authorization(), body: { name: "新範例" } }));
    assert.equal(response.statusCode, 409);
    assert.deepEqual(JSON.parse(response.body), { error: "insert_not_enabled" });
  });

  test("writer POST 共用 distributed rate limiter 並回傳 429", async () => {
    const handler = makeHandler(async () => ({
      action: "update", message: "ok", validation: { valid: true, errors: [] }
    }));
    let response;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      response = await invoke(handler, requestMock({ headers: authorization(), body: { name: "王範例" } }));
    }
    assert.equal(response.statusCode, 429);
    assert.ok(Number(response.headers["retry-after"]) > 0);
  });

  test("permission/API failure 安全映射且不回傳 upstream details", async () => {
    const handler = makeHandler(async () => {
      throw new SheetsWriteError("sheet_write_permission_denied", new Error("sensitive upstream detail"));
    });
    const response = await invoke(handler, requestMock({ headers: authorization(), body: { name: "王範例" } }));
    assert.equal(response.statusCode, 502);
    assert.deepEqual(JSON.parse(response.body), { error: "sheet_write_permission_denied" });
    assert.equal(response.body.includes("sensitive"), false);
  });
});
