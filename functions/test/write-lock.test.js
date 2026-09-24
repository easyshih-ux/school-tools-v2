"use strict";

const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const { FirestoreWriteLock, MemoryWriteLock, WriteLockError } = require("../src/write-lock");

describe("Gate 4B write concurrency lock", () => {
  test("Memory lock 將並行 read-modify-write 序列化", async () => {
    const lock = new MemoryWriteLock();
    let active = 0;
    let maximumActive = 0;
    const order = [];
    const task = (label) => lock.withLock("same-sheet", async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      order.push(`${label}-start`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(`${label}-end`);
      active -= 1;
    });
    await Promise.all([task("first"), task("second")]);
    assert.equal(maximumActive, 1);
    assert.deepEqual(order, ["first-start", "first-end", "second-start", "second-end"]);
  });

  test("Firestore lease 被占用時 bounded retry 後 fail closed", async () => {
    const document = {};
    const firestore = {
      collection() {
        return { doc() { return document; } };
      },
      async runTransaction(callback) {
        return callback({
          async get() {
            return { exists: true, data: () => ({ owner: "other", leaseUntilMs: 10_000 }) };
          },
          set() {},
          delete() {}
        });
      }
    };
    const lock = new FirestoreWriteLock(firestore, {
      now: () => 1_000,
      sleep: async () => {},
      maxAttempts: 2
    });
    await assert.rejects(lock.withLock("same-sheet", async () => {}), (error) =>
      error instanceof WriteLockError && error.code === "write_lock_timeout"
    );
  });

  test("lease 到期會在寫入前 fail closed", async () => {
    let currentTime = 1_000;
    const state = {};
    const document = {};
    const firestore = {
      collection() {
        return { doc() { return document; } };
      },
      async runTransaction(callback) {
        return callback({
          async get() {
            return { exists: Boolean(state.owner), data: () => state };
          },
          set(_document, value) { Object.assign(state, value); },
          delete() { for (const key of Object.keys(state)) delete state[key]; }
        });
      }
    };
    const lock = new FirestoreWriteLock(firestore, { now: () => currentTime, leaseMs: 10 });
    await assert.rejects(lock.withLock("same-sheet", async ({ assertLease }) => {
      currentTime = 1_010;
      assertLease();
    }), (error) => error.code === "write_lock_expired");
  });
});
