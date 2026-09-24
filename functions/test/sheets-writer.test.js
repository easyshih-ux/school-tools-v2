"use strict";

const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const {
  SHEETS_WRITE_SCOPE,
  SheetsWriteError,
  appendRange,
  createSheetsWriteAdapter,
  fullDataRange,
  updateRowRange
} = require("../src/sheets-writer");
const { MemoryWriteLock } = require("../src/write-lock");

const SPREADSHEET_ID = "fixture_spreadsheet_identifier_12345";

function fixture(overrides = {}) {
  return ["測試處", "測試教師", "王範例", "測試帳號01", "測試科目", "104", "已加入"].map((value, index) => {
    const fields = ["office", "title", "name", "lineName", "subject", "ext", "inSmallGroup"];
    return Object.hasOwn(overrides, fields[index]) ? overrides[fields[index]] : value;
  });
}

function authFixture(initialRows, { failMethod, failStatus } = {}) {
  const rows = initialRows.map((row) => [...row]);
  const calls = [];
  return {
    rows,
    calls,
    auth: {
      async getClient() {
        return {
          async request(options) {
            calls.push(options);
            if (failMethod === options.method) {
              const error = new Error("fixture upstream failure");
              error.response = { status: failStatus };
              throw error;
            }
            if (options.method === "GET") return { data: { values: rows.map((row) => [...row]) } };
            if (options.method === "PUT") {
              const range = decodeURIComponent(options.url.split("/values/")[1]);
              const match = range.match(/!A(\d+):G\1$/);
              if (!match) throw new Error("unexpected update range");
              rows[Number(match[1]) - 2] = [...options.data.values[0]];
              return { data: { updatedRows: 1 } };
            }
            if (options.method === "POST" && options.url.endsWith(":append")) {
              rows.push([...options.data.values[0]]);
              return { data: { updates: { updatedRows: 1 } } };
            }
            throw new Error(`unexpected method ${options.method}`);
          }
        };
      }
    }
  };
}

function adapter(fake, options = {}) {
  return createSheetsWriteAdapter({
    auth: fake.auth,
    getSpreadsheetId: () => SPREADSHEET_ID,
    lock: options.lock || new MemoryWriteLock(),
    logger: options.logger,
    allowInsert: options.allowInsert
  });
}

describe("Gate 4B Sheets write adapter", () => {
  test("固定 worksheet 與 range，不接受前端指定位置", () => {
    assert.equal(fullDataRange(), "'LINE帳號資料'!A2:G");
    assert.equal(appendRange(), "'LINE帳號資料'!A:G");
    assert.equal(updateRowRange(0), "'LINE帳號資料'!A2:G2");
    assert.throws(() => updateRowRange(-2), (error) => error.code === "target_row_invalid");
  });

  test("只要求 Sheets scope，不要求 Drive scope", () => {
    assert.equal(SHEETS_WRITE_SCOPE, "https://www.googleapis.com/auth/spreadsheets");
    assert.equal(SHEETS_WRITE_SCOPE.includes("drive"), false);
  });

  test("existing update 使用 PUT、精確單列 A:G、RAW 與七欄 mapping", async () => {
    const fake = authFixture([fixture()]);
    const result = await adapter(fake).write({ name: "王範例", lineName: "測試帳號02" }, { requestHash: "hash" });
    const write = fake.calls.find((call) => call.method === "PUT");
    assert.equal(result.action, "update");
    assert.equal(decodeURIComponent(write.url).endsWith("'LINE帳號資料'!A2:G2"), true);
    assert.equal(write.params.valueInputOption, "RAW");
    assert.equal(write.data.values[0].length, 7);
    assert.equal(write.data.values[0][3], "測試帳號02");
  });

  test("partial update 保留所有空白／未提供的舊值", async () => {
    const fake = authFixture([fixture()]);
    await adapter(fake).write({ name: " 王範例 ", office: "", title: "", lineName: "新測試帳號" });
    assert.deepEqual(fake.rows[0], fixture({ lineName: "新測試帳號" }));
  });

  test("formula-like values 以文字寫入且仍使用 RAW", async () => {
    const fake = authFixture([fixture()]);
    await adapter(fake).write({ name: "王範例", lineName: "=FORMULA" });
    const write = fake.calls.find((call) => call.method === "PUT");
    assert.equal(write.params.valueInputOption, "RAW");
    assert.equal(write.data.values[0][3], "'=FORMULA");
  });

  test("insert fixture 使用固定 append range、RAW 與七欄；預設正式模式禁止 insert", async () => {
    const blocked = authFixture([fixture()]);
    await assert.rejects(
      adapter(blocked).write({ name: "李範例", lineName: "測試帳號02" }),
      (error) => error.code === "insert_not_enabled"
    );
    assert.equal(blocked.calls.some((call) => call.method === "POST"), false);

    const fake = authFixture([fixture()]);
    const result = await adapter(fake, { allowInsert: true }).write({
      office: "測試處", title: "", name: "李範例", lineName: "測試帳號02",
      subject: "", ext: "", inSmallGroup: ""
    });
    const write = fake.calls.find((call) => call.method === "POST");
    assert.equal(result.action, "insert");
    assert.equal(decodeURIComponent(write.url).endsWith("'LINE帳號資料'!A:G:append"), true);
    assert.equal(write.params.valueInputOption, "RAW");
    assert.deepEqual(write.data.values[0], ["測試處", "", "李範例", "測試帳號02", "", "", "未加入"]);
  });

  test("row/range/worksheet/spreadsheetId 無法控制 writer", async () => {
    const fake = authFixture([fixture()]);
    const result = await adapter(fake).write({ name: "王範例", range: "A1:Z", row: 99 });
    assert.equal(result.validation.valid, false);
    assert.equal(result.validation.errors[0].code, "unknown_fields");
    assert.equal(fake.calls.some((call) => ["PUT", "POST", "DELETE"].includes(call.method)), false);
  });

  test("permission denied 與 worksheet missing 均 fail closed", async () => {
    for (const [status, code] of [[403, "sheet_write_permission_denied"], [400, "worksheet_or_range_not_found"]]) {
      const fake = authFixture([fixture()], { failMethod: "GET", failStatus: status });
      await assert.rejects(adapter(fake).write({ name: "王範例" }), (error) => error instanceof SheetsWriteError && error.code === code);
      assert.equal(fake.calls.some((call) => ["PUT", "POST", "DELETE"].includes(call.method)), false);
    }
  });

  test("read-back 不一致時 fail closed", async () => {
    const fake = authFixture([fixture()]);
    const originalRequest = fake.auth.getClient;
    fake.auth.getClient = async () => {
      const client = await originalRequest();
      const request = client.request;
      return {
        request: async (options) => {
          const response = await request(options);
          if (options.method === "PUT") fake.rows[0][3] = "不同值";
          return response;
        }
      };
    };
    await assert.rejects(adapter(fake).write({ name: "王範例", lineName: "測試帳號02" }), (error) => error.code === "write_verification_failed");
  });

  test("adapter 永不使用 DELETE，audit 不含 payload", async () => {
    const events = [];
    const fake = authFixture([fixture()]);
    await adapter(fake, { logger: { info: (event) => events.push(event), error: (event) => events.push(event) } })
      .write({ name: "王範例", lineName: "測試帳號02" }, { requestHash: "irreversible-hash" });
    assert.equal(fake.calls.some((call) => call.method === "DELETE"), false);
    const serialized = JSON.stringify(events);
    assert.equal(serialized.includes("王範例"), false);
    assert.equal(serialized.includes("測試帳號02"), false);
    assert.equal(serialized.includes("irreversible-hash"), true);
  });
});
