"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { beforeEach, describe, test } = require("node:test");
const { createApi } = require("../src/app");
const { MemoryRateLimiter } = require("../src/rate-limit");
const { TOKEN_TTL_SECONDS, issueToken } = require("../src/security");

const ALLOWED_ORIGIN = "https://easyshih-ux.github.io";
const DISALLOWED_ORIGIN = "https://untrusted.invalid";

function secret(label) {
  return `${label}-${crypto.randomBytes(48).toString("base64url")}`;
}

function responseMock() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(name, value) { this.headers[name.toLowerCase()] = String(value); },
    end(value = "") { this.body = String(value); this.ended = true; }
  };
}

function requestMock({ method = "GET", path = "/", headers = {}, body, ip = "192.0.2.10" } = {}) {
  return { method, path, url: path, headers, body, ip, socket: { remoteAddress: ip } };
}

function parsed(response) {
  return response.body ? JSON.parse(response.body) : null;
}

async function invoke(handler, request) {
  const response = responseMock();
  await handler(request, response);
  return response;
}

function decodePayload(token) {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}

describe("Gate 3A API", () => {
  let accessPassword;
  let signingKey;
  let rateKey;
  let nowMs;
  let handler;

  beforeEach(() => {
    accessPassword = secret("test-password");
    signingKey = secret("signing-key");
    rateKey = secret("rate-key");
    nowMs = 2_000_000_000_000;
    handler = createApi({
      getAccessPassword: () => accessPassword,
      getSigningKey: () => signingKey,
      getRateLimitKey: () => rateKey,
      allowedOrigins: [ALLOWED_ORIGIN, "http://127.0.0.1:4173"],
      rateLimiter: new MemoryRateLimiter(),
      now: () => nowMs
    });
  });

  async function authenticate(origin = ALLOWED_ORIGIN) {
    return invoke(handler, requestMock({
      method: "POST",
      path: "/auth/session",
      headers: { origin, "content-type": "application/json" },
      body: { password: accessPassword }
    }));
  }

  test("無密碼回傳 400", async () => {
    const response = await invoke(handler, requestMock({ method: "POST", path: "/auth/session", body: {} }));
    assert.equal(response.statusCode, 400);
  });

  test("錯誤密碼回傳 401", async () => {
    const response = await invoke(handler, requestMock({ method: "POST", path: "/auth/session", body: { password: "incorrect" } }));
    assert.equal(response.statusCode, 401);
    assert.deepEqual(parsed(response), { error: "invalid_credentials" });
  });

  test("正確測試密碼核發 30 分鐘 token", async () => {
    const response = await authenticate();
    const body = parsed(response);
    assert.equal(response.statusCode, 200);
    assert.equal(body.tokenType, "Bearer");
    assert.equal(body.expiresIn, TOKEN_TTL_SECONDS);
    assert.equal(typeof body.token, "string");
    const payload = decodePayload(body.token);
    assert.equal(payload.exp - payload.iat, 1800);
  });

  test("token 不含密碼或人員資料", async () => {
    const body = parsed(await authenticate());
    const payload = decodePayload(body.token);
    assert.equal(JSON.stringify(payload).includes(accessPassword), false);
    assert.equal(Object.hasOwn(payload, "password"), false);
    assert.equal(Object.hasOwn(payload, "name"), false);
    assert.equal(Object.hasOwn(payload, "lineName"), false);
  });

  test("teachers 無 token 回傳 401", async () => {
    const response = await invoke(handler, requestMock({ path: "/teachers" }));
    assert.equal(response.statusCode, 401);
  });

  test("malformed token 回傳 401", async () => {
    const response = await invoke(handler, requestMock({ path: "/teachers", headers: { authorization: "Bearer malformed" } }));
    assert.equal(response.statusCode, 401);
  });

  test("tampered token 回傳 401", async () => {
    const token = parsed(await authenticate()).token;
    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
    const response = await invoke(handler, requestMock({ path: "/teachers", headers: { authorization: `Bearer ${tampered}` } }));
    assert.equal(response.statusCode, 401);
  });

  test("expired token 回傳 401", async () => {
    const token = issueToken({ signingKey, nowSeconds: Math.floor(nowMs / 1000) - 1900 });
    const response = await invoke(handler, requestMock({ path: "/teachers", headers: { authorization: `Bearer ${token}` } }));
    assert.equal(response.statusCode, 401);
  });

  test("wrong audience token 回傳 401", async () => {
    const token = issueToken({ signingKey, nowSeconds: Math.floor(nowMs / 1000), audience: "wrong-audience" });
    const response = await invoke(handler, requestMock({ path: "/teachers", headers: { authorization: `Bearer ${token}` } }));
    assert.equal(response.statusCode, 401);
  });

  test("valid token 回傳虛構 teacher schema", async () => {
    const token = parsed(await authenticate()).token;
    const response = await invoke(handler, requestMock({ path: "/teachers", headers: { authorization: `Bearer ${token}` } }));
    const body = parsed(response);
    assert.equal(response.statusCode, 200);
    assert.equal(body.teachers.length, 10);
    assert.deepEqual(Object.keys(body.teachers[0]).sort(), ["ext", "id", "inSmallGroup", "lineName", "name", "office", "subject", "title"]);
    assert.ok(body.teachers.every((teacher) => teacher.id.startsWith("mock-") && teacher.lineName.startsWith("測試帳號")));
  });

  test("teachers 不接受寫入 method", async () => {
    const response = await invoke(handler, requestMock({ method: "POST", path: "/teachers", body: {} }));
    assert.equal(response.statusCode, 405);
    assert.equal(response.headers.allow, "GET, OPTIONS");
  });

  test("allowed origin 取得精確 CORS permission", async () => {
    const response = await authenticate();
    assert.equal(response.headers["access-control-allow-origin"], ALLOWED_ORIGIN);
    assert.equal(response.headers.vary, "Origin");
  });

  test("非 allowed origin 不取得 CORS permission", async () => {
    const response = await authenticate(DISALLOWED_ORIGIN);
    assert.equal(response.statusCode, 403);
    assert.equal(response.headers["access-control-allow-origin"], undefined);
  });

  test("OPTIONS preflight 正常", async () => {
    const response = await invoke(handler, requestMock({ method: "OPTIONS", path: "/teachers", headers: { origin: ALLOWED_ORIGIN } }));
    assert.equal(response.statusCode, 204);
    assert.equal(response.headers["access-control-allow-origin"], ALLOWED_ORIGIN);
    assert.match(response.headers["access-control-allow-headers"], /Authorization/);
  });

  test("response cache headers 正確", async () => {
    const auth = await authenticate();
    assert.equal(auth.headers["cache-control"], "no-store");
    const token = parsed(auth).token;
    const teachers = await invoke(handler, requestMock({ path: "/teachers", headers: { authorization: `Bearer ${token}` } }));
    assert.equal(teachers.headers["cache-control"], "private, no-store");
  });

  test("auth endpoint 限制高速猜測", async () => {
    let response;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      response = await invoke(handler, requestMock({ method: "POST", path: "/auth/session", body: { password: "incorrect" }, ip: "192.0.2.99" }));
    }
    assert.equal(response.statusCode, 429);
    assert.ok(Number(response.headers["retry-after"]) > 0);
  });
});
