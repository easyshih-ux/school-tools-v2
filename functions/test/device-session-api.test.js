"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { beforeEach, describe, test } = require("node:test");
const { createApi } = require("../src/app");
const { MemoryDeviceSessions } = require("../src/device-sessions");
const { MemoryRateLimiter } = require("../src/rate-limit");
const { issueToken } = require("../src/security");

const ORIGIN = "https://easyshih-ux.github.io";
const NOW = 2_000_000_000_000;

function secret(label) {
  return `${label}-${crypto.randomBytes(48).toString("base64url")}`;
}

function responseMock() {
  return {
    statusCode: 200, headers: {}, body: "",
    setHeader(name, value) { this.headers[name.toLowerCase()] = String(value); },
    end(value = "") { this.body = String(value); }
  };
}

function request(path, { method = "POST", body, headers = {} } = {}) {
  return {
    method, path, url: path,
    headers: { origin: ORIGIN, ...headers },
    body, ip: "192.0.2.80", socket: { remoteAddress: "192.0.2.80" }
  };
}

async function invoke(handler, input) {
  const response = responseMock();
  await handler(input, response);
  return response;
}

function body(response) {
  return JSON.parse(response.body);
}

function claims(token) {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}

describe("Gate 5.5 device session API", () => {
  let password;
  let signingKey;
  let rateKey;
  let version;
  let nowMs;
  let sessions;
  let handler;

  beforeEach(() => {
    password = secret("password");
    signingKey = secret("signing");
    rateKey = secret("rate");
    version = "v1";
    nowMs = NOW;
    sessions = new MemoryDeviceSessions();
    handler = createApi({
      getAccessPassword: () => password,
      getSigningKey: () => signingKey,
      getRateLimitKey: () => rateKey,
      getSessionVersion: () => version,
      deviceSessions: sessions,
      allowedOrigins: [ORIGIN],
      rateLimiter: new MemoryRateLimiter(),
      loadSheetData: async () => ({ teachers: [], summary: {} }),
      now: () => nowMs
    });
  });

  async function login() {
    return invoke(handler, request("/auth/session", { body: { password } }));
  }

  test("password login returns access and device credentials with no-store", async () => {
    const response = await login();
    const result = body(response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.match(result.deviceCredential, /^[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{43}$/);
    const payload = claims(result.token);
    assert.equal(payload.sv, version);
    assert.match(payload.sid, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(payload).includes(password), false);
  });

  test("refresh rotates credentials and returns a fresh 30-minute access token", async () => {
    const initial = body(await login());
    nowMs += 1000;
    const response = await invoke(handler, request("/auth/refresh", {
      body: { deviceCredential: initial.deviceCredential }
    }));
    const refreshed = body(response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.notEqual(refreshed.deviceCredential, initial.deviceCredential);
    assert.equal(refreshed.expiresIn, 1800);
    assert.equal(claims(refreshed.token).sv, version);
  });

  test("old credential reuse returns 401 and revokes current access", async () => {
    const initial = body(await login());
    nowMs += 1000;
    const refreshed = body(await invoke(handler, request("/auth/refresh", {
      body: { deviceCredential: initial.deviceCredential }
    })));
    nowMs += 1000;
    const reuse = await invoke(handler, request("/auth/refresh", {
      body: { deviceCredential: initial.deviceCredential }
    }));
    assert.equal(reuse.statusCode, 401);
    assert.deepEqual(body(reuse), { error: "device_session_invalid" });
    const teachers = await invoke(handler, request("/teachers", {
      method: "GET",
      headers: { authorization: `Bearer ${refreshed.token}` }
    }));
    assert.equal(teachers.statusCode, 401);
  });

  test("sessionVersion bump invalidates both access and refresh", async () => {
    const initial = body(await login());
    version = "v2";
    const teachers = await invoke(handler, request("/teachers", {
      method: "GET",
      headers: { authorization: `Bearer ${initial.token}` }
    }));
    assert.equal(teachers.statusCode, 401);
    const refresh = await invoke(handler, request("/auth/refresh", {
      body: { deviceCredential: initial.deviceCredential }
    }));
    assert.equal(refresh.statusCode, 401);
  });

  test("wrong token sv is rejected even with an active device session", async () => {
    const initial = body(await login());
    const payload = claims(initial.token);
    const wrong = issueToken({
      signingKey,
      nowSeconds: Math.floor(nowMs / 1000),
      sessionVersion: "wrong",
      sessionKey: payload.sid
    });
    const teachers = await invoke(handler, request("/teachers", {
      method: "GET",
      headers: { authorization: `Bearer ${wrong}` }
    }));
    assert.equal(teachers.statusCode, 401);
  });

  test("logout revokes current device session", async () => {
    const initial = body(await login());
    const logout = await invoke(handler, request("/auth/logout", {
      body: { deviceCredential: initial.deviceCredential }
    }));
    assert.equal(logout.statusCode, 200);
    assert.equal(logout.headers["cache-control"], "no-store");
    const refresh = await invoke(handler, request("/auth/refresh", {
      body: { deviceCredential: initial.deviceCredential }
    }));
    assert.equal(refresh.statusCode, 401);
  });

  test("auth endpoints reject disallowed methods", async () => {
    for (const path of ["/auth/session", "/auth/refresh", "/auth/logout"]) {
      const response = await invoke(handler, request(path, { method: "GET" }));
      assert.equal(response.statusCode, 405);
    }
  });
});
