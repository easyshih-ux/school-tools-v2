"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { describe, test } = require("node:test");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "..", "api-client.js"), "utf8");

function httpResponse(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

function client(shared, responses = [], { readFails = false, writeFails = false } = {}) {
  const calls = [];
  const queue = [...responses];
  const context = vm.createContext({
    window: { SCHOOL_TOOLS_CONFIG: { mode: "api", apiBaseUrl: "https://example.invalid/api" } },
    navigator: {
      locks: {
        request: async (_name, operation) => operation()
      }
    },
    getDeviceCredential: async () => {
      if (readFails) throw new Error("fixture read failure");
      return shared.credential;
    },
    saveDeviceCredential: async (value) => {
      if (writeFails) throw new Error("fixture write failure");
      shared.credential = value;
      shared.writes.push(value);
    },
    clearDeviceCredential: async () => {
      shared.credential = null;
      shared.clears += 1;
    },
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (!queue.length) throw new Error("unexpected fetch");
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return next;
    }
  });
  vm.runInContext(SOURCE, context, { filename: "api-client.js" });
  return {
    calls,
    create: (password) => vm.runInContext(`createSession(${JSON.stringify(password)})`, context),
    restore: () => vm.runInContext("restoreSession()", context),
    logout: () => vm.runInContext("logoutSession()", context),
    token: () => vm.runInContext("apiSession.token", context)
  };
}

function state(credential = null) {
  return { credential, writes: [], clears: 0 };
}

describe("Gate 5.5 frontend restore flow", () => {
  test("first password login persists only the device credential", async () => {
    const shared = state();
    const app = client(shared, [httpResponse(200, {
      token: "memory-access",
      expiresIn: 1800,
      deviceCredential: "device-credential-1"
    })]);
    const result = await app.create("fixture-password");
    assert.equal(result.remembered, true);
    assert.equal(app.token(), "memory-access");
    assert.equal(shared.credential, "device-credential-1");
    assert.deepEqual(shared.writes, ["device-credential-1"]);
    assert.doesNotMatch(JSON.stringify(shared), /fixture-password|memory-access/);
  });

  test("reload and browser restart restore from the same IndexedDB credential", async () => {
    const shared = state("device-credential-1");
    const reloaded = client(shared, [httpResponse(200, {
      token: "access-after-reload",
      expiresIn: 1800,
      deviceCredential: "device-credential-2"
    })]);
    assert.equal(await reloaded.restore(), true);
    assert.equal(reloaded.token(), "access-after-reload");
    assert.equal(shared.credential, "device-credential-2");

    const restarted = client(shared, [httpResponse(200, {
      token: "access-after-restart",
      expiresIn: 1800,
      deviceCredential: "device-credential-3"
    })]);
    assert.equal(await restarted.restore(), true);
    assert.equal(restarted.token(), "access-after-restart");
    assert.equal(shared.credential, "device-credential-3");
  });

  test("refresh failure clears local credential and does not loop", async () => {
    const shared = state("invalid-device-credential");
    const app = client(shared, [httpResponse(401, { error: "device_session_invalid" })]);
    assert.equal(await app.restore(), false);
    assert.equal(shared.credential, null);
    assert.equal(shared.clears, 1);
    assert.equal(app.calls.length, 1);
  });

  test("concurrent restore in one context sends only one refresh", async () => {
    const shared = state("device-credential-1");
    const app = client(shared, [httpResponse(200, {
      token: "access",
      expiresIn: 1800,
      deviceCredential: "device-credential-2"
    })]);
    const [first, second] = await Promise.all([app.restore(), app.restore()]);
    assert.equal(first, true);
    assert.equal(second, true);
    assert.equal(app.calls.length, 1);
  });

  test("IndexedDB failure safely falls back to password login", async () => {
    const shared = state("unreadable");
    const app = client(shared, [], { readFails: true });
    assert.equal(await app.restore(), false);
    assert.equal(app.token(), null);
    assert.equal(app.calls.length, 0);
  });

  test("credential write failure keeps access in memory but does not persist secrets", async () => {
    const shared = state();
    const app = client(shared, [httpResponse(200, {
      token: "memory-only-access",
      expiresIn: 1800,
      deviceCredential: "device-credential"
    })], { writeFails: true });
    const result = await app.create("fixture-password");
    assert.equal(result.remembered, false);
    assert.equal(app.token(), "memory-only-access");
    assert.equal(shared.credential, null);
  });

  test("logout clears IndexedDB even when API call fails", async () => {
    const shared = state("device-credential");
    const app = client(shared, [new Error("offline")]);
    await assert.rejects(app.logout());
    assert.equal(shared.credential, null);
    assert.equal(app.token(), null);
  });

  test("source never persists password, access token, or teacher data", () => {
    assert.doesNotMatch(SOURCE, /localStorage|sessionStorage/);
    const persistedArgument = SOURCE.match(/saveDeviceCredential\(([^)]+)\)/g) || [];
    assert.ok(persistedArgument.length >= 1);
    assert.ok(persistedArgument.every((call) => /deviceCredential|credential/.test(call)));
    const storeSource = fs.readFileSync(path.join(__dirname, "..", "..", "device-session-store.js"), "utf8");
    assert.doesNotMatch(storeSource, /password|accessToken|teachers|lineName/);
  });
});
