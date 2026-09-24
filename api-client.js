"use strict";

const apiSession = { token: null };
let refreshInFlight = null;

class AuthRequiredError extends Error {
  constructor(message = "authentication required") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

class ApiRequestError extends Error {
  constructor(message, status, code = "request_failed", details = []) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.details = Array.isArray(details) ? details : [];
  }
}

function apiConfig() {
  return window.SCHOOL_TOOLS_CONFIG || { mode: "disabled", apiBaseUrl: "" };
}

function apiUrl(path) {
  const base = String(apiConfig().apiBaseUrl || "").replace(/\/$/, "");
  if (!base) throw new ApiRequestError("API endpoint unavailable", 0);
  return `${base}${path}`;
}

async function parseResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiRequestError(body.error || "request_failed", response.status, body.error, body.details);
  }
  return body;
}

async function persistRotatedCredential(credential) {
  try {
    await saveDeviceCredential(credential);
    return true;
  } catch {
    await clearDeviceCredential();
    return false;
  }
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
  if (typeof body.token !== "string" || typeof body.deviceCredential !== "string") {
    throw new ApiRequestError("invalid_session_response", 502);
  }
  apiSession.token = body.token;
  const remembered = await persistRotatedCredential(body.deviceCredential);
  return { expiresIn: body.expiresIn, remembered };
}

async function executeRefresh() {
  let credential;
  try {
    credential = await getDeviceCredential();
  } catch {
    return false;
  }
  if (!credential) return false;

  try {
    const response = await fetch(apiUrl("/auth/refresh"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ deviceCredential: credential })
    });
    const body = await parseResponse(response);
    if (typeof body.token !== "string" || typeof body.deviceCredential !== "string") {
      throw new ApiRequestError("invalid_refresh_response", 502);
    }
    apiSession.token = body.token;
    await persistRotatedCredential(body.deviceCredential);
    return true;
  } catch {
    apiSession.token = null;
    await clearDeviceCredential();
    return false;
  }
}

async function withRefreshLock(operation) {
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    return navigator.locks.request("school-tools-v2-device-refresh", operation);
  }
  return operation();
}

async function restoreSession() {
  if (apiSession.token) return true;
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = withRefreshLock(async () => {
    if (apiSession.token) return true;
    return executeRefresh();
  });
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

async function authorizedFetch(path, options, allowRefresh = true) {
  if (!apiSession.token && !await restoreSession()) throw new AuthRequiredError();
  const request = () => fetch(apiUrl(path), {
    ...options,
    headers: {
      ...(options?.headers || {}),
      Authorization: `Bearer ${apiSession.token}`
    },
    cache: "no-store"
  });

  let response = await request();
  if (response.status === 401 && allowRefresh) {
    apiSession.token = null;
    if (await restoreSession()) response = await request();
  }
  if (response.status === 401) {
    apiSession.token = null;
    await clearDeviceCredential();
    throw new AuthRequiredError("session expired");
  }
  return response;
}

async function loadTeachers() {
  if (apiConfig().mode !== "api") throw new ApiRequestError("API mode required", 0);
  const response = await authorizedFetch("/teachers", { method: "GET" });
  const body = await parseResponse(response);
  return Array.isArray(body.teachers) ? body.teachers : [];
}

function clearSession() {
  apiSession.token = null;
}

async function logoutSession() {
  let credential = null;
  try { credential = await getDeviceCredential(); } catch { /* local cleanup still runs */ }
  try {
    if (credential && apiConfig().mode === "api") {
      await fetch(apiUrl("/auth/logout"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ deviceCredential: credential })
      });
    }
  } finally {
    apiSession.token = null;
    await clearDeviceCredential();
  }
}

async function updateTeacher(formData) {
  if (apiConfig().mode !== "api") throw new ApiRequestError("API mode required", 0);
  const fields = ["office", "title", "name", "lineName", "subject", "ext", "inSmallGroup"];
  const payload = Object.fromEntries(fields.map((field) => [field, String(formData[field] ?? "").trim()]));
  const response = await authorizedFetch("/teachers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return parseResponse(response);
}
