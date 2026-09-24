"use strict";

const { GoogleAuth } = require("google-auth-library");
const { mapTeacherRows, summarizeTeacherRows } = require("./sheets-mapper");

const SHEETS_READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const DEFAULT_WORKSHEET_NAME = "LINE帳號資料";

class SheetsReadError extends Error {
  constructor(code, cause) {
    super(code);
    this.name = "SheetsReadError";
    this.code = code;
    this.cause = cause;
  }
}

function requireSpreadsheetId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{20,200}$/.test(value)) {
    throw new SheetsReadError("spreadsheet_configuration_invalid");
  }
  return value;
}

function requireWorksheetName(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new SheetsReadError("worksheet_configuration_invalid");
  }
  return value.trim();
}

function sheetRange(worksheetName) {
  return `'${requireWorksheetName(worksheetName).replaceAll("'", "''")}'!A2:G`;
}

function errorCode(error) {
  const status = Number(error?.response?.status || error?.code);
  if (status === 403) {
    const safeDiagnostic = JSON.stringify(error?.response?.data || {});
    if (/SERVICE_DISABLED|API_DISABLED|accessNotConfigured|has not been used|is disabled/i.test(safeDiagnostic)) {
      return "sheets_api_not_enabled";
    }
    return "sheet_access_denied";
  }
  if (status === 404) return "spreadsheet_not_found";
  if (status === 400) return "worksheet_or_range_not_found";
  return "sheets_api_error";
}

function createSheetsReader({
  auth = new GoogleAuth({ scopes: [SHEETS_READONLY_SCOPE] }),
  getSpreadsheetId,
  worksheetName = DEFAULT_WORKSHEET_NAME
} = {}) {
  if (typeof getSpreadsheetId !== "function") throw new TypeError("getSpreadsheetId is required");
  return async function readSheetData() {
    const spreadsheetId = requireSpreadsheetId(getSpreadsheetId());
    const range = sheetRange(worksheetName);
    try {
      const client = await auth.getClient();
      const response = await client.request({
        method: "GET",
        url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
        params: {
          majorDimension: "ROWS",
          valueRenderOption: "UNFORMATTED_VALUE",
          dateTimeRenderOption: "FORMATTED_STRING"
        }
      });
      const values = response?.data?.values;
      if (values !== undefined && !Array.isArray(values)) throw new SheetsReadError("sheets_response_invalid");
      const rows = values || [];
      return {
        teachers: mapTeacherRows(rows),
        summary: summarizeTeacherRows(rows)
      };
    } catch (error) {
      if (error instanceof SheetsReadError) throw error;
      throw new SheetsReadError(errorCode(error), error);
    }
  };
}

module.exports = {
  DEFAULT_WORKSHEET_NAME,
  SHEETS_READONLY_SCOPE,
  SheetsReadError,
  createSheetsReader,
  sheetRange
};
