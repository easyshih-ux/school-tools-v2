"use strict";

const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const { createApi } = require("../src/app");
const { MemoryRateLimiter } = require("../src/rate-limit");
const { issueToken } = require("../src/security");
const { createTeacherUpdateSimulation } = require("../src/teacher-update");

const NOW_MS = 2_000_000_000_000;
const SIGNING_KEY = "fictional-signing-key-for-gate-4a-tests-only";
const RATE_KEY = "fictional-rate-key-for-gate-4a-tests-only";
const ACCESS_PASSWORD = "fictional-password-for-gate-4a-tests-only";

function responseMock() {
  return {
    statusCode: 200, headers: {}, body: "",
    setHeader(name, value) { this.headers[name.toLowerCase()] = String(value); },
    end(value = "") { this.body = String(value); }
  };
}
function requestMock({ method = "POST", headers = {}, body, ip = "192.0.2.44" } = {}) {
  return { method, path: "/teachers", url: "/teachers", headers, body, ip, socket: { remoteAddress: ip } };
}
async function invoke(handler, request) {
  const response = responseMock();
  await handler(request, response);
  return response;
}
function parsed(response) {
  return JSON.parse(response.body);
}
function token(options = {}) {
  return issueToken({ signingKey: SIGNING_KEY, nowSeconds: Math.floor(NOW_MS / 1000), ...options });
}
function fixture(overrides = {}) {
  return {
    office: "測試處", title: "測試教師", name: "王範例", lineName: "測試帳號01",
    subject: "測試科目", ext: "T-001", inSmallGroup: "已加入", ...overrides
  };
}
function setup() {
  const simulation = createTeacherUpdateSimulation([fixture()]);
  const handler = createApi({
    getAccessPassword: () => ACCESS_PASSWORD,
    getSigningKey: () => SIGNING_KEY,
    getRateLimitKey: () => RATE_KEY,
    allowedOrigins: ["https://easyshih-ux.github.io"],
    rateLimiter: new MemoryRateLimiter(),
    simulateTeacherUpdate: (payload) => simulation.apply(payload),
    now: () => NOW_MS
  });
  return { handler, simulation };
}
function authorizedRequest(body, options = {}) {
  return requestMock({
    body,
    headers: { authorization: `Bearer ${token(options.tokenOptions)}` },
    ip: options.ip
  });
}

describe("Gate 4A simulated POST /teachers contract", () => {
  test("no token 回傳 401 且不變更 fixture", async () => {
    const { handler, simulation } = setup();
    const before = simulation.snapshot();
    const response = await invoke(handler, requestMock({ body: fixture({ name: "新範例" }) }));
    assert.equal(response.statusCode, 401);
    assert.deepEqual(simulation.snapshot(), before);
  });
  test("invalid token 回傳 401", async () => {
    const { handler } = setup();
    const response = await invoke(handler, requestMock({
      body: fixture(), headers: { authorization: "Bearer malformed" }
    }));
    assert.equal(response.statusCode, 401);
  });
  test("expired token 回傳 401", async () => {
    const { handler } = setup();
    const expired = issueToken({ signingKey: SIGNING_KEY, nowSeconds: Math.floor(NOW_MS / 1000) - 1900 });
    const response = await invoke(handler, requestMock({
      body: fixture(), headers: { authorization: `Bearer ${expired}` }
    }));
    assert.equal(response.statusCode, 401);
  });
  test("wrong audience 回傳 401", async () => {
    const { handler } = setup();
    const response = await invoke(handler, authorizedRequest(fixture(), { tokenOptions: { audience: "wrong" } }));
    assert.equal(response.statusCode, 401);
  });
  test("PUT/PATCH/DELETE 皆為 405", async () => {
    const { handler } = setup();
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      const response = await invoke(handler, requestMock({ method }));
      assert.equal(response.statusCode, 405);
      assert.equal(response.headers.allow, "GET, POST, OPTIONS");
    }
  });
  test("missing name、malformed 及 unknown field 回傳 400", async () => {
    const { handler } = setup();
    for (const body of [{}, "not-json", { name: "王範例", row: 2 }, { name: "王範例", spreadsheetId: "x" }]) {
      const response = await invoke(handler, authorizedRequest(body));
      assert.equal(response.statusCode, 400);
      assert.equal(parsed(response).error, "validation_failed");
    }
  });
  test("合法 insert 回傳舊 UI 相容 add，不暴露 row/range/record", async () => {
    const { handler, simulation } = setup();
    const response = await invoke(handler, authorizedRequest(fixture({ name: "李範例" })));
    const body = parsed(response);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(Object.keys(body).sort(), ["action", "message", "persisted", "simulated", "success"]);
    assert.equal(body.action, "add");
    assert.equal(body.persisted, false);
    assert.equal(simulation.snapshot().length, 2);
  });
  test("合法 update 回傳 update 且只改虛構 adapter", async () => {
    const { handler, simulation } = setup();
    const response = await invoke(handler, authorizedRequest({ name: "王範例", lineName: "測試帳號02" }));
    assert.equal(response.statusCode, 200);
    assert.equal(parsed(response).action, "update");
    assert.equal(simulation.snapshot()[0].lineName, "測試帳號02");
  });
  test("simulation POST 有 rate limit", async () => {
    const { handler } = setup();
    let response;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      response = await invoke(handler, authorizedRequest({ name: "王範例" }, { ip: "192.0.2.99" }));
    }
    assert.equal(response.statusCode, 429);
    assert.ok(Number(response.headers["retry-after"]) > 0);
  });
  test("未注入 simulation adapter 時 POST 維持 405", async () => {
    const handler = createApi({
      getAccessPassword: () => ACCESS_PASSWORD,
      getSigningKey: () => SIGNING_KEY,
      getRateLimitKey: () => RATE_KEY,
      allowedOrigins: ["https://easyshih-ux.github.io"],
      rateLimiter: new MemoryRateLimiter(),
      now: () => NOW_MS
    });
    const response = await invoke(handler, authorizedRequest(fixture()));
    assert.equal(response.statusCode, 405);
    assert.equal(response.headers.allow, "GET, OPTIONS");
  });
});
