"use strict";

const crypto = require("node:crypto");

const DEVICE_SESSION_ABSOLUTE_MS = 90 * 24 * 60 * 60 * 1000;
const DEVICE_SESSION_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
const COLLECTION_NAME = "schoolToolsV2DeviceSessions";

class DeviceSessionError extends Error {
  constructor(code) {
    super(code);
    this.name = "DeviceSessionError";
    this.code = code;
  }
}

function securePart(bytes) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function hashValue(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function normalizeSessionVersion(value) {
  const version = String(value ?? "").trim();
  if (!version || version.length > 64 || !/^[A-Za-z0-9._-]+$/.test(version)) {
    throw new Error("SESSION_VERSION is invalid");
  }
  return version;
}

function makeCredential() {
  const sessionId = securePart(24);
  const secret = securePart(32);
  return { credential: `${sessionId}.${secret}`, sessionKey: hashValue(sessionId) };
}

function parseCredential(credential) {
  if (typeof credential !== "string" || credential.length > 128) return null;
  const match = credential.match(/^([A-Za-z0-9_-]{32})\.([A-Za-z0-9_-]{43})$/);
  if (!match) return null;
  return { sessionKey: hashValue(match[1]), credentialHash: hashValue(credential) };
}

function millis(value) {
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  if (value && typeof value.toMillis === "function") return value.toMillis();
  return NaN;
}

function publicDates(record) {
  return {
    ...record,
    createdAt: new Date(millis(record.createdAt)),
    lastUsedAt: new Date(millis(record.lastUsedAt)),
    expiresAt: new Date(millis(record.expiresAt)),
    revokedAt: record.revokedAt ? new Date(millis(record.revokedAt)) : null
  };
}

function activeState(record, sessionVersion, nowMs) {
  if (!record || record.status !== "active") return { active: false, code: "device_session_invalid" };
  const expiresAtMs = millis(record.expiresAt);
  const lastUsedAtMs = millis(record.lastUsedAt);
  if (!Number.isFinite(expiresAtMs) || !Number.isFinite(lastUsedAtMs) ||
      typeof record.credentialHash !== "string" || !/^[a-f0-9]{64}$/.test(record.credentialHash) ||
      !Number.isInteger(record.generation) || record.generation < 0) {
    return { active: false, code: "device_session_invalid" };
  }
  if (record.sessionVersion !== sessionVersion) return { active: false, code: "session_version_mismatch" };
  if (expiresAtMs <= nowMs) return { active: false, code: "device_session_expired" };
  if (lastUsedAtMs + DEVICE_SESSION_IDLE_MS <= nowMs) {
    return { active: false, code: "device_session_idle_expired" };
  }
  return { active: true };
}

function refreshTransition(record, suppliedHash, sessionVersion, nowMs, nextHash) {
  const status = activeState(record, sessionVersion, nowMs);
  if (!status.active) {
    if (record && record.status === "active") {
      return {
        ok: false,
        code: status.code,
        record: publicDates({ ...record, status: "revoked", revokedAt: nowMs })
      };
    }
    return { ok: false, code: status.code, record };
  }

  if (record.credentialHash !== suppliedHash) {
    const reused = Array.isArray(record.retiredCredentialHashes) &&
      record.retiredCredentialHashes.includes(suppliedHash);
    if (reused) {
      return {
        ok: false,
        code: "device_credential_reused",
        record: publicDates({ ...record, status: "revoked", revokedAt: nowMs })
      };
    }
    return { ok: false, code: "device_credential_invalid", record };
  }

  const retired = [...(record.retiredCredentialHashes || []), record.credentialHash];
  return {
    ok: true,
    record: publicDates({
      ...record,
      credentialHash: nextHash,
      retiredCredentialHashes: retired,
      generation: Number(record.generation || 0) + 1,
      lastUsedAt: nowMs
    })
  };
}

class MemoryDeviceSessions {
  constructor() {
    this.records = new Map();
  }

  async create({ sessionVersion, nowMs = Date.now() }) {
    const version = normalizeSessionVersion(sessionVersion);
    const generated = makeCredential();
    const record = publicDates({
      credentialHash: hashValue(generated.credential),
      retiredCredentialHashes: [],
      generation: 0,
      sessionVersion: version,
      createdAt: nowMs,
      lastUsedAt: nowMs,
      expiresAt: nowMs + DEVICE_SESSION_ABSOLUTE_MS,
      revokedAt: null,
      status: "active"
    });
    this.records.set(generated.sessionKey, record);
    return { credential: generated.credential, sessionKey: generated.sessionKey };
  }

  async refresh({ credential, sessionVersion, nowMs = Date.now() }) {
    const parsed = parseCredential(credential);
    if (!parsed) throw new DeviceSessionError("device_credential_invalid");
    const version = normalizeSessionVersion(sessionVersion);
    const nextSecret = securePart(32);
    const nextCredential = `${credential.split(".")[0]}.${nextSecret}`;
    const transition = refreshTransition(
      this.records.get(parsed.sessionKey),
      parsed.credentialHash,
      version,
      nowMs,
      hashValue(nextCredential)
    );
    if (transition.record) this.records.set(parsed.sessionKey, transition.record);
    if (!transition.ok) throw new DeviceSessionError(transition.code);
    return { credential: nextCredential, sessionKey: parsed.sessionKey };
  }

  async revoke({ credential, nowMs = Date.now() }) {
    const parsed = parseCredential(credential);
    if (!parsed) return;
    const record = this.records.get(parsed.sessionKey);
    if (!record) return;
    const supplied = parsed.credentialHash;
    const known = record.credentialHash === supplied ||
      (record.retiredCredentialHashes || []).includes(supplied);
    if (known && record.status === "active") {
      this.records.set(parsed.sessionKey, publicDates({ ...record, status: "revoked", revokedAt: nowMs }));
    }
  }

  async assertAccess({ sessionKey, sessionVersion, nowMs = Date.now() }) {
    return activeState(this.records.get(sessionKey), normalizeSessionVersion(sessionVersion), nowMs).active;
  }

  snapshot(sessionKey) {
    return this.records.get(sessionKey);
  }
}

class FirestoreDeviceSessions {
  constructor(firestore, collectionName = COLLECTION_NAME) {
    this.firestore = firestore;
    this.collectionName = collectionName;
  }

  document(sessionKey) {
    return this.firestore.collection(this.collectionName).doc(sessionKey);
  }

  async create({ sessionVersion, nowMs = Date.now() }) {
    const version = normalizeSessionVersion(sessionVersion);
    const generated = makeCredential();
    await this.document(generated.sessionKey).create(publicDates({
      credentialHash: hashValue(generated.credential),
      retiredCredentialHashes: [],
      generation: 0,
      sessionVersion: version,
      createdAt: nowMs,
      lastUsedAt: nowMs,
      expiresAt: nowMs + DEVICE_SESSION_ABSOLUTE_MS,
      revokedAt: null,
      status: "active"
    }));
    return { credential: generated.credential, sessionKey: generated.sessionKey };
  }

  async refresh({ credential, sessionVersion, nowMs = Date.now() }) {
    const parsed = parseCredential(credential);
    if (!parsed) throw new DeviceSessionError("device_credential_invalid");
    const version = normalizeSessionVersion(sessionVersion);
    const sessionId = credential.split(".")[0];
    const outcome = await this.firestore.runTransaction(async (transaction) => {
      const document = this.document(parsed.sessionKey);
      const snapshot = await transaction.get(document);
      const record = snapshot.exists ? snapshot.data() : null;
      let reused = false;
      if (record && record.credentialHash !== parsed.credentialHash) {
        reused = (await transaction.get(
          document.collection("retiredCredentials").doc(parsed.credentialHash)
        )).exists;
      }
      const nextCredential = `${sessionId}.${securePart(32)}`;
      const transitionInput = reused
        ? { ...record, retiredCredentialHashes: [parsed.credentialHash] }
        : record;
      const transition = refreshTransition(
        transitionInput,
        parsed.credentialHash,
        version,
        nowMs,
        hashValue(nextCredential)
      );
      if (transition.ok) {
        transaction.create(document.collection("retiredCredentials").doc(record.credentialHash), {
          credentialHash: record.credentialHash,
          generation: Number(record.generation || 0),
          retiredAt: new Date(nowMs),
          expiresAt: record.expiresAt
        });
      }
      if (transition.record) {
        const { retiredCredentialHashes, ...storedRecord } = transition.record;
        transaction.set(document, storedRecord, { merge: true });
      }
      return { ...transition, credential: transition.ok ? nextCredential : null };
    });
    if (!outcome.ok) throw new DeviceSessionError(outcome.code);
    return { credential: outcome.credential, sessionKey: parsed.sessionKey };
  }

  async revoke({ credential, nowMs = Date.now() }) {
    const parsed = parseCredential(credential);
    if (!parsed) return;
    await this.firestore.runTransaction(async (transaction) => {
      const document = this.document(parsed.sessionKey);
      const snapshot = await transaction.get(document);
      if (!snapshot.exists) return;
      const record = snapshot.data();
      const retired = record.credentialHash === parsed.credentialHash
        ? false
        : (await transaction.get(document.collection("retiredCredentials").doc(parsed.credentialHash))).exists;
      const known = record.credentialHash === parsed.credentialHash || retired;
      if (known && record.status === "active") {
        transaction.set(document, { status: "revoked", revokedAt: new Date(nowMs) }, { merge: true });
      }
    });
  }

  async assertAccess({ sessionKey, sessionVersion, nowMs = Date.now() }) {
    if (typeof sessionKey !== "string" || !/^[a-f0-9]{64}$/.test(sessionKey)) return false;
    const snapshot = await this.document(sessionKey).get();
    return snapshot.exists &&
      activeState(snapshot.data(), normalizeSessionVersion(sessionVersion), nowMs).active;
  }
}

module.exports = {
  COLLECTION_NAME,
  DEVICE_SESSION_ABSOLUTE_MS,
  DEVICE_SESSION_IDLE_MS,
  DeviceSessionError,
  FirestoreDeviceSessions,
  MemoryDeviceSessions,
  hashValue,
  normalizeSessionVersion,
  parseCredential,
  refreshTransition
};
