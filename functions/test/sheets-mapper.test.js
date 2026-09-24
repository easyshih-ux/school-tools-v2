"use strict";

const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const { TEACHER_FIELDS, groupStatus, mapTeacherRows, summarizeTeacherRows } = require("../src/sheets-mapper");

describe("Gate 3B-1 Sheets mapper", () => {
  test("正常 7 欄與中文內容依正式 schema mapping", () => {
    const result = mapTeacherRows([[" 測試處 ", " 測試職稱 ", " 王範例 ", " 測試帳號 ", " 測試科目 ", " T-001 ", "已加入"]]);
    assert.deepEqual(result, [{ office: "測試處", title: "測試職稱", name: "王範例", lineName: "測試帳號", subject: "測試科目", ext: "T-001", inSmallGroup: "已加入" }]);
    assert.deepEqual(Object.keys(result[0]), TEACHER_FIELDS);
  });

  test("姓名空白列會跳過", () => {
    assert.equal(mapTeacherRows([["測試處", "", "   ", "測試帳號", "", "", false]]).length, 0);
  });

  test("空欄位保留為空字串且不猜值", () => {
    assert.deepEqual(mapTeacherRows([[null, undefined, "測試姓名"]])[0], {
      office: "", title: "", name: "測試姓名", lineName: "", subject: "", ext: "", inSmallGroup: "未加入"
    });
  });

  test("checkbox boolean 與文字 boolean 轉成 UI 相容狀態", () => {
    assert.equal(groupStatus(true), "已加入");
    assert.equal(groupStatus(false), "未加入");
    assert.equal(groupStatus("TRUE"), "已加入");
    assert.equal(groupStatus(" false "), "未加入");
    assert.equal(groupStatus("其他狀態"), "其他狀態");
  });

  test("多餘欄位忽略，少欄位安全補空值", () => {
    const rows = mapTeacherRows([
      ["測試處", "職稱", "甲範例", "帳號", "科目", "T-002", true, "不得映射"],
      ["測試處", "", "乙範例"]
    ]);
    assert.equal(rows.length, 2);
    assert.equal(Object.hasOwn(rows[0], "extra"), false);
    assert.equal(rows[1].lineName, "");
    assert.equal(rows[1].inSmallGroup, "未加入");
  });

  test("aggregate 不含姓名或 LINE 值", () => {
    const summary = summarizeTeacherRows([
      ["測試處", "", "虛構姓名甲", "秘密測試帳號", "", "", true],
      ["", "", "", "", "", "", false],
      ["測試處", "", "虛構姓名乙", "", "", "", "已加入"]
    ]);
    const serialized = JSON.stringify(summary);
    assert.equal(summary.sourceRowCount, 3);
    assert.equal(summary.mappedRowCount, 2);
    assert.equal(summary.skippedBlankNameCount, 1);
    assert.equal(summary.officeCount, 1);
    assert.equal(summary.mappingValid, true);
    assert.equal(summary.emptyByField.lineName, 1);
    assert.equal(summary.inSmallGroupTypes.booleanTrue, 1);
    assert.equal(summary.inSmallGroupTypes.booleanFalse, 1);
    assert.equal(summary.inSmallGroupTypes.joinedText, 1);
    assert.equal(serialized.includes("虛構姓名"), false);
    assert.equal(serialized.includes("秘密測試帳號"), false);
  });
});
