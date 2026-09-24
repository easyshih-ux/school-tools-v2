"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { describe, test } = require("node:test");

function loadAdapter() {
  let fetchCalls = 0;
  const context = vm.createContext({
    window: { SCHOOL_TOOLS_CONFIG: { mode: "api", apiBaseUrl: "https://example.invalid" } },
    fetch: async () => { fetchCalls += 1; throw new Error("network must not be used"); }
  });
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "api-client.js"), "utf8");
  vm.runInContext(source, context, { filename: "api-client.js" });
  return {
    update: (payload) => vm.runInContext(`updateTeacher(${JSON.stringify(payload)})`, context),
    fetchCalls: () => fetchCalls
  };
}

describe("Gate 4A frontend simulation adapter", () => {
  test("虛構 existing name 模擬 update 且不呼叫網路", async () => {
    const adapter = loadAdapter();
    const result = await adapter.update({ name: "王小明", lineName: "測試帳號02" });
    assert.equal(result.action, "update");
    assert.equal(result.persisted, false);
    assert.equal(adapter.fetchCalls(), 0);
  });

  test("虛構 new name 模擬 add 且明確標示未寫入", async () => {
    const adapter = loadAdapter();
    const result = await adapter.update({ name: "李範例", lineName: "測試帳號03" });
    assert.equal(result.action, "add");
    assert.equal(result.simulated, true);
    assert.equal(result.message.includes("未寫入正式資料"), true);
    assert.equal(adapter.fetchCalls(), 0);
  });
});
