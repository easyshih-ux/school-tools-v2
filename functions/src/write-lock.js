"use strict";

const crypto = require("node:crypto");

const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_WAIT_MS = 100;
const DEFAULT_MAX_ATTEMPTS = 50;

class WriteLockError extends Error {
  constructor(code) {
    super(code);
    this.name = "WriteLockError";
    this.code = code;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class MemoryWriteLock {
  constructor() {
    this.tail = Promise.resolve();
  }

  async withLock(_key, task) {
    let release;
    const previous = this.tail;
    this.tail = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  }
}

class FirestoreWriteLock {
  constructor(firestore, {
    collectionName = "schoolToolsV2WriteLocks",
    leaseMs = DEFAULT_LEASE_MS,
    waitMs = DEFAULT_WAIT_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    now = () => Date.now(),
    sleep = delay
  } = {}) {
    this.firestore = firestore;
    this.collectionName = collectionName;
    this.leaseMs = leaseMs;
    this.waitMs = waitMs;
    this.maxAttempts = maxAttempts;
    this.now = now;
    this.sleep = sleep;
  }

  async tryAcquire(document, owner) {
    const nowMs = this.now();
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(document);
      const current = snapshot.exists ? snapshot.data() : {};
      if (Number(current.leaseUntilMs) > nowMs) return null;
      const leaseUntilMs = nowMs + this.leaseMs;
      transaction.set(document, {
        owner,
        leaseUntilMs,
        expiresAt: new Date(leaseUntilMs + this.leaseMs)
      });
      return leaseUntilMs;
    });
  }

  async release(document, owner) {
    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(document);
      if (snapshot.exists && snapshot.data()?.owner === owner) transaction.delete(document);
    });
  }

  async withLock(key, task) {
    const owner = crypto.randomUUID();
    const document = this.firestore.collection(this.collectionName).doc(key);
    let leaseUntilMs = null;
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      leaseUntilMs = await this.tryAcquire(document, owner);
      if (leaseUntilMs) break;
      await this.sleep(this.waitMs);
    }
    if (!leaseUntilMs) throw new WriteLockError("write_lock_timeout");

    const assertLease = () => {
      if (this.now() >= leaseUntilMs) throw new WriteLockError("write_lock_expired");
    };
    try {
      return await task({ assertLease, leaseUntilMs });
    } finally {
      await this.release(document, owner);
    }
  }
}

module.exports = {
  DEFAULT_LEASE_MS,
  FirestoreWriteLock,
  MemoryWriteLock,
  WriteLockError
};
