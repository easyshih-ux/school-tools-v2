"use strict";

const apiSession = { token: null };

class AuthRequiredError extends Error {
  constructor(message = "authentication required") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

class ApiRequestError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

function apiConfig() {
  return window.SCHOOL_TOOLS_CONFIG || { mode: "disabled", apiBaseUrl: "" };
}

function apiUrl(path) {
  const base = String(apiConfig().apiBaseUrl || "").replace(/\/$/, "");
  if (!base) throw new ApiRequestError("API endpoint 尚未設定", 0);
  return `${base}${path}`;
}

async function parseResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiRequestError(body.error || "request_failed", response.status);
  return body;
}

async function createSession(password) {
  if (apiConfig().mode !== "api") throw new ApiRequestError("API mode required", 0);
  const response = await fetch(apiUrl("/auth/session"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ password })
  });
  const body = await parseResponse(response);
  apiSession.token = body.token;
  return { expiresIn: body.expiresIn };
}

async function loadTeachers() {
  if (apiConfig().mode !== "api") throw new ApiRequestError("API mode required", 0);
  if (!apiSession.token) throw new AuthRequiredError();
  const response = await fetch(apiUrl("/teachers"), {
    method: "GET",
    headers: { Authorization: `Bearer ${apiSession.token}` },
    cache: "no-store"
  });
  if (response.status === 401) {
    apiSession.token = null;
    throw new AuthRequiredError("session expired");
  }
  const body = await parseResponse(response);
  return Array.isArray(body.teachers) ? body.teachers : [];
}

function clearSession() {
  apiSession.token = null;
}

async function updateTeacher(formData) {
  return {
    success: false,
    persisted: false,
    message: "V2 測試模式：目前不會寫入正式資料。",
    submittedData: { ...formData }
  };
}
