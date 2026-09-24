"use strict";

const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const { SHEETS_VALUE_INPUT_OPTION, applyTeacherUpdate, createTeacherUpdateSimulation, safeSheetRow, safeSheetText, validateTeacherPayload } = require("../src/teacher-update");

function fixture(overrides = {}) {
  return {
    office: "測試處", title: "測試教師", name: "王範例", lineName: "測試帳號01",
    subject: "測試科目", ext: "T-001", inSmallGroup: "已加入", ...overrides
  };
}

describe("Gate 4A teacher update engine", () => {
  test("existing name 更新第一筆並保留陣列長度", () => {
    const result = applyTeacherUpdate([fixture()], { name: "王範例", lineName: "測試帳號02" });
    assert.equal(result.action, "update");
    assert.equal(result.records.length, 1);
    assert.equal(result.resultingRecord.lineName, "測試帳號02");
  });
  test("new name 新增並完整 mapping 七欄", () => {
    const submitted = fixture({ name: "李範例" });
    const result = applyTeacherUpdate([fixture()], submitted);
    assert.equal(result.action, "insert");
    assert.deepEqual(result.resultingRecord, submitted);
    assert.deepEqual(Object.keys(result.resultingRecord), ["office", "title", "name", "lineName", "subject", "ext", "inSmallGroup"]);
  });
  test("姓名前後空白會 trim 後比對", () => {
    const result = applyTeacherUpdate([fixture()], { name: "  王範例  ", title: "新職稱" });
    assert.equal(result.action, "update");
    assert.equal(result.resultingRecord.name, "王範例");
  });
  test("姓名比對區分大小寫", () => {
    assert.equal(applyTeacherUpdate([fixture({ name: "Test User" })], { name: "test user" }).action, "insert");
  });
  test("missing name validation failure", () => {
    for (const payload of [{}, { name: "" }, { name: "   " }]) {
      const result = applyTeacherUpdate([], payload);
      assert.equal(result.validation.valid, false);
      assert.equal(result.validation.errors.some((error) => error.field === "name"), true);
    }
  });
  test("未提供與空字串欄位均保留舊值", () => {
    const result = applyTeacherUpdate([fixture()], {
      name: "王範例", office: "", title: "   ", lineName: "", subject: "", ext: "", inSmallGroup: ""
    });
    assert.deepEqual(result.resultingRecord, fixture());
  });
  test("新增的空欄位保留空字串，群組狀態預設未加入", () => {
    const result = applyTeacherUpdate([], { name: "新範例" });
    assert.deepEqual(result.resultingRecord, {
      office: "", title: "", name: "新範例", lineName: "", subject: "", ext: "", inSmallGroup: "未加入"
    });
  });
  test("inSmallGroup 非空字串照原系統 trim，空值保留或預設", () => {
    assert.equal(applyTeacherUpdate([fixture()], { name: "王範例", inSmallGroup: " 未加入 " }).resultingRecord.inSmallGroup, "未加入");
    assert.equal(applyTeacherUpdate([fixture()], { name: "王範例", inSmallGroup: "" }).resultingRecord.inSmallGroup, "已加入");
    assert.equal(applyTeacherUpdate([], { name: "新範例", inSmallGroup: "" }).resultingRecord.inSmallGroup, "未加入");
    assert.equal(applyTeacherUpdate([], { name: "新範例", inSmallGroup: "其他文字" }).resultingRecord.inSmallGroup, "其他文字");
    assert.equal(applyTeacherUpdate([fixture({ inSmallGroup: false })], { name: "王範例" }).resultingRecord.inSmallGroup, "未加入");
    assert.equal(applyTeacherUpdate([fixture({ inSmallGroup: true })], { name: "王範例" }).resultingRecord.inSmallGroup, "true");
  });
  test("ext 支援原系統的文字或數字並 trim", () => {
    assert.equal(applyTeacherUpdate([], { name: "甲範例", ext: 123 }).resultingRecord.ext, "123");
    assert.equal(applyTeacherUpdate([], { name: "乙範例", ext: "  T-009 " }).resultingRecord.ext, "T-009");
  });
  test("中文及 LINE 顯示名稱正常保留", () => {
    const result = applyTeacherUpdate([], { name: "陳測試", lineName: "測試帳號✨", subject: "藝術領域" });
    assert.equal(result.resultingRecord.lineName, "測試帳號✨");
    assert.equal(result.resultingRecord.subject, "藝術領域");
  });
  test("duplicate name 只更新第一筆並回報重複數", () => {
    const result = applyTeacherUpdate([
      fixture({ lineName: "測試帳號01" }), fixture({ lineName: "測試帳號02" })
    ], { name: "王範例", lineName: "新測試帳號" });
    assert.equal(result.target.index, 0);
    assert.equal(result.target.duplicateCount, 2);
    assert.equal(result.records[0].lineName, "新測試帳號");
    assert.equal(result.records[1].lineName, "測試帳號02");
  });
  test("unknown/control fields 一律拒絕", () => {
    for (const field of ["role", "admin", "row", "range", "spreadsheetId", "worksheet", "formula"]) {
      const validation = validateTeacherPayload({ name: "王範例", [field]: "x" });
      assert.equal(validation.valid, false);
      assert.equal(validation.errors[0].code, "unknown_fields");
    }
  });
  test("malformed payload 與不合法型別拒絕", () => {
    for (const payload of [null, [], "bad"]) assert.equal(validateTeacherPayload(payload).valid, false);
    assert.equal(validateTeacherPayload({ name: "王範例", office: { value: "測試處" } }).valid, false);
  });
  test("formula-like input 產生不可執行的安全 Sheet 文字", () => {
    for (const value of ["=IMPORTXML(A1)", "+SUM(A1:A2)", "-1+2", "@cmd"]) {
      assert.equal(safeSheetText(value).startsWith("'"), true);
    }
    assert.equal(safeSheetText("一般文字"), "一般文字");
    assert.equal(safeSheetRow(fixture({ lineName: "=FORMULA" }))[3].startsWith("'="), true);
  });
    assert.equal(SHEETS_VALUE_INPUT_OPTION, "RAW");
  test("模擬 insert 不影響其他 records", () => {
    const original = fixture();
    const simulation = createTeacherUpdateSimulation([original]);
    simulation.apply({ name: "新範例", lineName: "測試帳號99" });
    const records = simulation.snapshot();
    assert.equal(records.length, 2);
    assert.deepEqual(records[0], original);
  });
  test("模擬 update 不影響其他 records", () => {
    const other = fixture({ name: "李範例", lineName: "測試帳號02" });
    const simulation = createTeacherUpdateSimulation([fixture(), other]);
    simulation.apply({ name: "王範例", title: "更新職稱" });
    const records = simulation.snapshot();
    assert.equal(records[0].title, "更新職稱");
    assert.deepEqual(records[1], other);
  });
});
