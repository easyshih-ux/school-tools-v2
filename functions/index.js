"use strict";

const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret, defineString } = require("firebase-functions/params");
const { createApi } = require("./src/app");
const { DEFAULT_WORKSHEET_NAME, createSheetsReader } = require("./src/sheets-reader");
const { FirestoreRateLimiter } = require("./src/rate-limit");


const accessPassword = defineSecret("SCHOOL_TOOLS_TEST_ACCESS_PASSWORD");
const tokenSigningKey = defineSecret("SCHOOL_TOOLS_TOKEN_SIGNING_KEY");
const spreadsheetId = defineSecret("SCHOOL_TOOLS_SPREADSHEET_ID");
const rateLimitKey = defineSecret("SCHOOL_TOOLS_RATE_LIMIT_KEY");
const worksheetName = defineString("SCHOOL_TOOLS_WORKSHEET_NAME", { default: DEFAULT_WORKSHEET_NAME });
const allowedOrigins = defineString("SCHOOL_TOOLS_ALLOWED_ORIGINS");

let handler;
let adminInitialized = false;

function configuredHandler() {
  if (!handler) {
    const { initializeApp } = require("firebase-admin/app");
    const { getFirestore } = require("firebase-admin/firestore");
    if (!adminInitialized) {
      initializeApp();
      adminInitialized = true;
    }
    const origins = allowedOrigins.value().split(",").map((origin) => origin.trim()).filter(Boolean);
    handler = createApi({
      getAccessPassword: () => accessPassword.value(),
      getSigningKey: () => tokenSigningKey.value(),
      getRateLimitKey: () => rateLimitKey.value(),
      loadSheetSummary: createSheetsReader({
        getSpreadsheetId: () => spreadsheetId.value(),
        worksheetName: worksheetName.value()
      }),
      allowedOrigins: origins,
      rateLimiter: new FirestoreRateLimiter(getFirestore())
    });
  }
  return handler;
}

exports.api = onRequest({
  region: "asia-east1",
  cors: false,
  secrets: [accessPassword, tokenSigningKey, rateLimitKey, spreadsheetId],
  minInstances: 0,
  maxInstances: 5,
  concurrency: 40,
  timeoutSeconds: 15,
  memory: "256MiB"
}, (request, response) => configuredHandler()(request, response));
