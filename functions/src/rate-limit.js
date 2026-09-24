"use strict";

const AUTH_WINDOW_MS = 5 * 60 * 1000;
const AUTH_BLOCK_MS = 15 * 60 * 1000;
const AUTH_MAX_ATTEMPTS = 5;

function nextState(current, nowMs) {
  const existing = current || {};
  if (Number(existing.blockedUntilMs) > nowMs) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.blockedUntilMs - nowMs) / 1000)),
      state: existing
    };
  }

  const windowExpired = !Number(existing.windowStartedAtMs) || nowMs - existing.windowStartedAtMs >= AUTH_WINDOW_MS;
  const count = windowExpired ? 1 : Number(existing.count || 0) + 1;
  const windowStartedAtMs = windowExpired ? nowMs : existing.windowStartedAtMs;
  if (count > AUTH_MAX_ATTEMPTS) {
    const blockedUntilMs = nowMs + AUTH_BLOCK_MS;
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil(AUTH_BLOCK_MS / 1000),
      state: { count, windowStartedAtMs, blockedUntilMs, expiresAtMs: blockedUntilMs + AUTH_BLOCK_MS }
    };
  }

  return {
    allowed: true,
    retryAfterSeconds: 0,
    state: { count, windowStartedAtMs, blockedUntilMs: 0, expiresAtMs: windowStartedAtMs + AUTH_WINDOW_MS + AUTH_BLOCK_MS }
  };
}

class MemoryRateLimiter {
  constructor() {
    this.records = new Map();
  }

  async consume(key, nowMs = Date.now()) {
    const result = nextState(this.records.get(key), nowMs);
    this.records.set(key, result.state);
    return { allowed: result.allowed, retryAfterSeconds: result.retryAfterSeconds };
  }
}

class FirestoreRateLimiter {
  constructor(firestore, collectionName = "schoolToolsV2RateLimits") {
    this.firestore = firestore;
    this.collectionName = collectionName;
  }

  async consume(key, nowMs = Date.now()) {
    const document = this.firestore.collection(this.collectionName).doc(key);
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(document);
      const result = nextState(snapshot.exists ? snapshot.data() : null, nowMs);
      transaction.set(document, {
        ...result.state,
        expiresAt: new Date(result.state.expiresAtMs)
      });
      return { allowed: result.allowed, retryAfterSeconds: result.retryAfterSeconds };
    });
  }
}

module.exports = {
  AUTH_BLOCK_MS,
  AUTH_MAX_ATTEMPTS,
  AUTH_WINDOW_MS,
  FirestoreRateLimiter,
  MemoryRateLimiter,
  nextState
};
