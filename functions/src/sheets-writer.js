"use strict";

const { GoogleAuth } = require("google-auth-library");
const { mapTeacherRows } = require("./sheets-mapper");
const { SHEETS_VALUE_INPUT_OPTION, applyTeacherUpdate } = require("./teacher-update");

const SHEETS_WRITE_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const FIXED_WORKSHEET_NAME = "LINE帳號資料";
const FIXED_COLUMNS = "A:G";
const FIXED_LOCK_KEY = "line-account-teachers-write";

class SheetsWriteError extends Error {
  constructor(code, cause) {
    super(code);
    this.name = "SheetsWriteError";
    this.code = code;
    this.cause = cause;
  }
}

function requireSpreadsheetId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{20,200}$/.test(value)) {
    throw new SheetsWriteError("spreadsheet_configuration_invalid");
  }
  return value;
}

function quotedSheetName() {
  return `'${FIXED_WORKSHEET_NAME.replaceAll("'", "''")}'`;
}

function fullDataRange() {
  return `${quotedSheetName()}!A2:G`;
}

function appendRange() {
  return `${quotedSheetName()}!${FIXED_COLUMNS}`;
}

function updateRowRange(sourceIndex) {
  const rowNumber = sourceIndex + 2;
  if (!Number.isInteger(rowNumber) || rowNumber < 2) throw new SheetsWriteError("target_row_invalid");
  return `${quotedSheetName()}!A${rowNumber}:G${rowNumber}`;
}

function upstreamErrorCode(error) {
  const status = Number(error?.response?.status || error?.code);
  if (status === 401 || status === 403) return "sheet_write_permission_denied";
  if (status === 404) return "spreadsheet_not_found";
  if (status === 400) return "worksheet_or_range_not_found";
  return "sheet_write_failed";
}

function valuesUrl(spreadsheetId, range, suffix = "") {
  return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}${suffix}`;
}

function sameRow(left, right) {
  return Array.isArray(left) && Array.isArray(right) &&
    left.length === 7 && right.length === 7 &&
    left.every((value, index) => String(value ?? "") === String(right[index] ?? ""));
}

function createSheetsWriteAdapter({
  auth = new GoogleAuth({ scopes: [SHEETS_WRITE_SCOPE] }),
  getSpreadsheetId,
  lock,
  logger = { info() {}, error() {} },
  allowInsert = false
} = {}) {
  if (typeof getSpreadsheetId !== "function") throw new TypeError("getSpreadsheetId is required");
  if (!lock || typeof lock.withLock !== "function") throw new TypeError("lock is required");

  async function request(options) {
    try {
      const client = await auth.getClient();
      return await client.request(options);
    } catch (error) {
      if (error instanceof SheetsWriteError) throw error;
      throw new SheetsWriteError(upstreamErrorCode(error), error);
    }
  }

  async function readRows(spreadsheetId) {
    const response = await request({
      method: "GET",
      url: valuesUrl(spreadsheetId, fullDataRange()),
      params: {
        majorDimension: "ROWS",
        valueRenderOption: "UNFORMATTED_VALUE",
        dateTimeRenderOption: "FORMATTED_STRING"
      }
    });
    const rows = response?.data?.values;
    if (rows !== undefined && !Array.isArray(rows)) throw new SheetsWriteError("sheets_response_invalid");
    return rows || [];
  }

  async function write(payload, { requestHash = "unavailable" } = {}) {
    const spreadsheetId = requireSpreadsheetId(getSpreadsheetId());
    let action = "unknown";
    try {
      const result = await lock.withLock(FIXED_LOCK_KEY, async ({ assertLease } = {}) => {
        const rows = await readRows(spreadsheetId);
        const teachers = mapTeacherRows(rows);
        const decision = applyTeacherUpdate(teachers, payload);
        if (!decision.validation.valid) return decision;
        action = decision.action;
        if (action === "insert" && !allowInsert) throw new SheetsWriteError("insert_not_enabled");

        const sourceIndex = rows.findIndex((row) =>
          String(Array.isArray(row) ? row[2] ?? "" : "").trim() === decision.normalizedData.name
        );
        if (action === "update" && sourceIndex < 0) throw new SheetsWriteError("target_row_not_found");
        if (typeof assertLease === "function") assertLease();

        if (action === "update") {
          await request({
            method: "PUT",
            url: valuesUrl(spreadsheetId, updateRowRange(sourceIndex)),
            params: { valueInputOption: SHEETS_VALUE_INPUT_OPTION },
            data: { majorDimension: "ROWS", values: [decision.safeSheetValues] }
          });
        } else {
          await request({
            method: "POST",
            url: valuesUrl(spreadsheetId, appendRange(), ":append"),
            params: {
              valueInputOption: SHEETS_VALUE_INPUT_OPTION,
              insertDataOption: "INSERT_ROWS"
            },
            data: { majorDimension: "ROWS", values: [decision.safeSheetValues] }
          });
        }

        if (typeof assertLease === "function") assertLease();
        const afterRows = await readRows(spreadsheetId);
        const readBackIndex = afterRows.findIndex((row) =>
          String(Array.isArray(row) ? row[2] ?? "" : "").trim() === decision.normalizedData.name
        );
        if (readBackIndex < 0 || !sameRow(afterRows[readBackIndex], decision.safeSheetValues)) {
          throw new SheetsWriteError("write_verification_failed");
        }
        return decision;
      });
      if (!result?.validation?.valid) return result;
      logger.info({ event: "teacher_write", action, success: true, requestHash });
      return result;
    } catch (error) {
      logger.error({
        event: "teacher_write",
        action,
        success: false,
        code: typeof error?.code === "string" ? error.code : "sheet_write_failed",
        requestHash
      });
      if (error instanceof SheetsWriteError) throw error;
      throw new SheetsWriteError(typeof error?.code === "string" ? error.code : "sheet_write_failed", error);
    }
  }

  return { write };
}

module.exports = {
  FIXED_COLUMNS,
  FIXED_LOCK_KEY,
  FIXED_WORKSHEET_NAME,
  SHEETS_WRITE_SCOPE,
  SheetsWriteError,
  appendRange,
  createSheetsWriteAdapter,
  fullDataRange,
  updateRowRange
};
