"use strict";

const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const { SHEETS_READONLY_SCOPE, SheetsReadError, createSheetsReader, sheetRange } = require("../src/sheets-reader");

function authFixture(handler) {
  return { async getClient() { return { request: handler }; } };
}

describe("Gate 3B-1 Sheets reader", () => {
  test("只發出 GET 並回傳不含個資的 aggregate", async () => {
    let request;
    const reader = createSheetsReader({
      auth: authFixture(async (options) => { request = options; return { data: { values: [["測試處", "", "虛構姓名", "測試帳號", "", "", true]] } }; }),
      getSpreadsheetId: () => "fixture_spreadsheet_identifier_12345",
      worksheetName: "LINE帳號資料"
    });
    const data = await reader();
    assert.equal(request.method, "GET");
    assert.match(request.url, /^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\//);
    assert.equal(request.params.valueRenderOption, "UNFORMATTED_VALUE");
    assert.equal(data.teachers.length, 1);
    assert.equal(data.summary.mappedRowCount, 1);
    assert.equal(JSON.stringify(data.summary).includes("虛構姓名"), false);
  });

  test("worksheet 名稱安全轉成 A2:G range", () => {
    assert.equal(sheetRange("LINE帳號資料"), "'LINE帳號資料'!A2:G");
    assert.equal(sheetRange("測試'工作表"), "'測試''工作表'!A2:G");
  });

  test("worksheet 不存在時明確 fail closed", async () => {
    const reader = createSheetsReader({
      auth: authFixture(async () => { const error = new Error("fixture"); error.response = { status: 400 }; throw error; }),
      getSpreadsheetId: () => "fixture_spreadsheet_identifier_12345"
    });
    await assert.rejects(reader, (error) => error instanceof SheetsReadError && error.code === "worksheet_or_range_not_found");
  });

  test("Spreadsheet 不存在、拒絕存取及一般 API error 均 fail closed", async () => {
    for (const [status, code] of [[404, "spreadsheet_not_found"], [403, "sheet_access_denied"], [500, "sheets_api_error"]]) {
      const reader = createSheetsReader({
        auth: authFixture(async () => { const error = new Error("fixture"); error.response = { status }; throw error; }),
        getSpreadsheetId: () => "fixture_spreadsheet_identifier_12345"
      });
      await assert.rejects(reader, (error) => error.code === code);
    }
  });

  test("無效 ID 或 response 不會被容錯成資料", async () => {
    const invalidIdReader = createSheetsReader({ auth: authFixture(async () => ({ data: {} })), getSpreadsheetId: () => "short" });
    await assert.rejects(invalidIdReader, (error) => error.code === "spreadsheet_configuration_invalid");
    const invalidResponseReader = createSheetsReader({ auth: authFixture(async () => ({ data: { values: {} } })), getSpreadsheetId: () => "fixture_spreadsheet_identifier_12345" });
    await assert.rejects(invalidResponseReader, (error) => error.code === "sheets_response_invalid");
  });

  test("宣告的唯一 OAuth scope 為 Sheets read-only", () => {
    assert.equal(SHEETS_READONLY_SCOPE, "https://www.googleapis.com/auth/spreadsheets.readonly");
  });

test("403 SERVICE_DISABLED is distinguished without exposing upstream details", async () => {
  const reader = createSheetsReader({
    auth: authFixture(async () => {
      const error = new Error("fixture");
      error.response = { status: 403, data: { error: { details: [{ reason: "SERVICE_DISABLED" }] } } };
      throw error;
    }),
    getSpreadsheetId: () => "fixture_spreadsheet_identifier_12345"
  });
  await assert.rejects(reader, (error) => error.code === "sheets_api_not_enabled");
});
});
