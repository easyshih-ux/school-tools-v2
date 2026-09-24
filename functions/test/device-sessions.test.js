"use strict";

const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const {
  DEVICE_SESSION_ABSOLUTE_MS,
  DEVICE_SESSION_IDLE_MS,
  DeviceSessionError,
  MemoryDeviceSessions,
  hashValue
} = require("../src/device-sessions");

const NOW = 2_000_000_000_000;
const VERSION = "gate-5-5-v1";

describe("Gate 5.5 device session state", () => {
  test("creates a cryptographically random credential and stores hash only", async () => {
    const sessions = new MemoryDeviceSessions();
    const created = await sessions.create({ sessionVersion: VERSION, nowMs: NOW });
    assert.match(created.credential, /^[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{43}$/);
    assert.match(created.sessionKey, /^[a-f0-9]{64}$/);
    const record = sessions.snapshot(created.sessionKey);
    assert.equal(record.credentialHash, hashValue(created.credential));
    assert.equal(JSON.stringify(record).includes(created.credential), false);
    assert.equal(Object.hasOwn(record, "credential"), false);
    assert.equal(record.generation, 0);
    assert.equal(record.sessionVersion, VERSION);
    assert.equal(record.expiresAt.getTime(), NOW + DEVICE_SESSION_ABSOLUTE_MS);
  });

  test("refresh rotates immediately, increments generation, and preserves absolute expiry", async () => {
    const sessions = new MemoryDeviceSessions();
    const created = await sessions.create({ sessionVersion: VERSION, nowMs: NOW });
    const originalExpiry = sessions.snapshot(created.sessionKey).expiresAt.getTime();
    const refreshed = await sessions.refresh({
      credential: created.credential,
      sessionVersion: VERSION,
      nowMs: NOW + 1000
    });
    assert.notEqual(refreshed.credential, created.credential);
    const record = sessions.snapshot(created.sessionKey);
    assert.equal(record.generation, 1);
    assert.equal(record.lastUsedAt.getTime(), NOW + 1000);
    assert.equal(record.expiresAt.getTime(), originalExpiry);
    assert.equal(record.credentialHash, hashValue(refreshed.credential));
    assert.ok(record.retiredCredentialHashes.includes(hashValue(created.credential)));
  });

  test("old credential reuse revokes the whole device session", async () => {
    const sessions = new MemoryDeviceSessions();
    const created = await sessions.create({ sessionVersion: VERSION, nowMs: NOW });
    const refreshed = await sessions.refresh({
      credential: created.credential,
      sessionVersion: VERSION,
      nowMs: NOW + 1000
    });
    await assert.rejects(
      sessions.refresh({ credential: created.credential, sessionVersion: VERSION, nowMs: NOW + 2000 }),
      (error) => error instanceof DeviceSessionError && error.code === "device_credential_reused"
    );
    assert.equal(sessions.snapshot(created.sessionKey).status, "revoked");
    assert.equal(await sessions.assertAccess({
      sessionKey: refreshed.sessionKey,
      sessionVersion: VERSION,
      nowMs: NOW + 3000
    }), false);
  });

  test("90-day absolute expiry cannot be extended by refresh", async () => {
    const sessions = new MemoryDeviceSessions();
    const created = await sessions.create({ sessionVersion: VERSION, nowMs: NOW });
    const record = sessions.snapshot(created.sessionKey);
    record.lastUsedAt = new Date(NOW + DEVICE_SESSION_ABSOLUTE_MS - 1000);
    await assert.rejects(
      sessions.refresh({
        credential: created.credential,
        sessionVersion: VERSION,
        nowMs: NOW + DEVICE_SESSION_ABSOLUTE_MS
      }),
      (error) => error.code === "device_session_expired"
    );
  });

  test("30-day idle expiry is enforced", async () => {
    const sessions = new MemoryDeviceSessions();
    const created = await sessions.create({ sessionVersion: VERSION, nowMs: NOW });
    await assert.rejects(
      sessions.refresh({
        credential: created.credential,
        sessionVersion: VERSION,
        nowMs: NOW + DEVICE_SESSION_IDLE_MS
      }),
      (error) => error.code === "device_session_idle_expired"
    );
  });

  test("logout revokes the current session", async () => {
    const sessions = new MemoryDeviceSessions();
    const created = await sessions.create({ sessionVersion: VERSION, nowMs: NOW });
    await sessions.revoke({ credential: created.credential, nowMs: NOW + 1000 });
    assert.equal(sessions.snapshot(created.sessionKey).status, "revoked");
    assert.equal(await sessions.assertAccess({
      sessionKey: created.sessionKey,
      sessionVersion: VERSION,
      nowMs: NOW + 2000
    }), false);
  });

  test("malformed server-side session state fails closed", async () => {
    const sessions = new MemoryDeviceSessions();
    const created = await sessions.create({ sessionVersion: VERSION, nowMs: NOW });
    sessions.snapshot(created.sessionKey).expiresAt = null;
    assert.equal(await sessions.assertAccess({
      sessionKey: created.sessionKey,
      sessionVersion: VERSION,
      nowMs: NOW + 1000
    }), false);
  });
  test("session version bump invalidates access and refresh", async () => {
    const sessions = new MemoryDeviceSessions();
    const created = await sessions.create({ sessionVersion: VERSION, nowMs: NOW });
    assert.equal(await sessions.assertAccess({
      sessionKey: created.sessionKey,
      sessionVersion: "gate-5-5-v2",
      nowMs: NOW + 1000
    }), false);
    await assert.rejects(
      sessions.refresh({
        credential: created.credential,
        sessionVersion: "gate-5-5-v2",
        nowMs: NOW + 1000
      }),
      (error) => error.code === "session_version_mismatch"
    );
  });
});
