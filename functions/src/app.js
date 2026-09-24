"use strict";

const {
  TOKEN_AUDIENCE,
  TOKEN_TTL_SECONDS,
  bearerToken,
  issueToken,
  passwordMatches,
  rateLimitKey,
  verifyToken
} = require("./security");
const { DeviceSessionError, normalizeSessionVersion } = require("./device-sessions");

function setCorsHeaders(response, origin, allowedOrigins) {
  response.setHeader("Vary", "Origin");
  if (!origin || !allowedOrigins.includes(origin)) return false;
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  response.setHeader("Access-Control-Max-Age", "600");
  return true;
}

function json(response, status, body, cacheControl) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", cacheControl);
  response.end(JSON.stringify(body));
}

function pathOf(request) {
  const rawPath = request.path || new URL(request.url || "/", "https://local.invalid").pathname;
  return rawPath.length > 1 ? rawPath.replace(/\/$/, "") : rawPath;
}

function requestBody(request) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body); } catch { return null; }
  }
  return request.body;
}

function passwordFrom(request) {
  return requestBody(request)?.password;
}

function credentialFrom(request) {
  return requestBody(request)?.deviceCredential;
}

function clientIdentifier(request) {
  return request.ip || request.socket?.remoteAddress || "unknown";
}

function createApi({
  getAccessPassword,
  getSigningKey,
  getRateLimitKey,
  getSessionVersion,
  deviceSessions,
  allowedOrigins,
  rateLimiter,
  loadSheetData,
  simulateTeacherUpdate,
  writeTeacher,
  now = () => Date.now()
}) {
  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) throw new Error("allowedOrigins is required");
  if (!rateLimiter || typeof rateLimiter.consume !== "function") throw new Error("rateLimiter is required");
  if (!deviceSessions || ["create", "refresh", "revoke", "assertAccess"].some((method) => typeof deviceSessions[method] !== "function")) {
    throw new Error("deviceSessions is required");
  }
  if (typeof getSessionVersion !== "function") throw new Error("getSessionVersion is required");

  function sessionVersion() {
    return normalizeSessionVersion(getSessionVersion());
  }

  async function rateAllowed(scope, request, response) {
    try {
      const identifier = `${scope}:${clientIdentifier(request)}`;
      const key = rateLimitKey(identifier, getRateLimitKey());
      const result = await rateLimiter.consume(key, now());
      if (!result.allowed) {
        response.setHeader("Retry-After", String(result.retryAfterSeconds));
        json(response, 429, { error: "too_many_attempts" }, "no-store");
        return false;
      }
      return true;
    } catch {
      json(response, 503, { error: "authentication_temporarily_unavailable" }, "no-store");
      return false;
    }
  }

  function tokenFor(sessionKey) {
    return issueToken({
      signingKey: getSigningKey(),
      nowSeconds: Math.floor(now() / 1000),
      sessionVersion: sessionVersion(),
      sessionKey
    });
  }

  async function authorize(request, response) {
    const token = bearerToken(request.headers?.authorization);
    if (!token) {
      json(response, 401, { error: "unauthorized" }, "private, no-store");
      return null;
    }

    let claims;
    try {
      claims = verifyToken(token, {
        signingKey: getSigningKey(),
        audience: TOKEN_AUDIENCE,
        expectedSessionVersion: sessionVersion(),
        nowSeconds: Math.floor(now() / 1000)
      });
    } catch {
      json(response, 401, { error: "unauthorized" }, "private, no-store");
      return null;
    }

    try {
      const active = await deviceSessions.assertAccess({
        sessionKey: claims.sid,
        sessionVersion: sessionVersion(),
        nowMs: now()
      });
      if (!active) {
        json(response, 401, { error: "unauthorized" }, "private, no-store");
        return null;
      }
    } catch {
      json(response, 503, { error: "authorization_temporarily_unavailable" }, "private, no-store");
      return null;
    }
    return claims;
  }

  return async function api(request, response) {
    const origin = request.headers?.origin;
    const originAllowed = setCorsHeaders(response, origin, allowedOrigins);
    if (origin && !originAllowed) {
      return json(response, 403, { error: "origin_not_allowed" }, "no-store");
    }

    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.setHeader("Cache-Control", "no-store");
      return response.end();
    }

    const path = pathOf(request);
    if (path === "/auth/session") {
      if (request.method !== "POST") {
        response.setHeader("Allow", "POST, OPTIONS");
        return json(response, 405, { error: "method_not_allowed" }, "no-store");
      }
      if (!await rateAllowed("password", request, response)) return;

      const password = passwordFrom(request);
      if (typeof password !== "string" || password.trim().length === 0 || password.length > 256) {
        return json(response, 400, { error: "password_required" }, "no-store");
      }

      try {
        if (!passwordMatches(password, getAccessPassword())) {
          return json(response, 401, { error: "invalid_credentials" }, "no-store");
        }
        const created = await deviceSessions.create({
          sessionVersion: sessionVersion(),
          nowMs: now()
        });
        return json(response, 200, {
          token: tokenFor(created.sessionKey),
          tokenType: "Bearer",
          expiresIn: TOKEN_TTL_SECONDS,
          deviceCredential: created.credential
        }, "no-store");
      } catch {
        return json(response, 503, { error: "authentication_temporarily_unavailable" }, "no-store");
      }
    }

    if (path === "/auth/refresh") {
      if (request.method !== "POST") {
        response.setHeader("Allow", "POST, OPTIONS");
        return json(response, 405, { error: "method_not_allowed" }, "no-store");
      }
      if (!await rateAllowed("refresh", request, response)) return;

      const credential = credentialFrom(request);
      if (typeof credential !== "string" || !credential || credential.length > 128) {
        return json(response, 401, { error: "device_session_invalid" }, "no-store");
      }
      try {
        const refreshed = await deviceSessions.refresh({
          credential,
          sessionVersion: sessionVersion(),
          nowMs: now()
        });
        return json(response, 200, {
          token: tokenFor(refreshed.sessionKey),
          tokenType: "Bearer",
          expiresIn: TOKEN_TTL_SECONDS,
          deviceCredential: refreshed.credential
        }, "no-store");
      } catch (error) {
        if (error instanceof DeviceSessionError) {
          return json(response, 401, { error: "device_session_invalid" }, "no-store");
        }
        return json(response, 503, { error: "authentication_temporarily_unavailable" }, "no-store");
      }
    }

    if (path === "/auth/logout") {
      if (request.method !== "POST") {
        response.setHeader("Allow", "POST, OPTIONS");
        return json(response, 405, { error: "method_not_allowed" }, "no-store");
      }
      const credential = credentialFrom(request);
      try {
        await deviceSessions.revoke({ credential, nowMs: now() });
        return json(response, 200, { success: true }, "no-store");
      } catch {
        return json(response, 503, { error: "logout_temporarily_unavailable" }, "no-store");
      }
    }

    if (path === "/teachers") {
      const supportsWrite = typeof writeTeacher === "function";
      const supportsSimulation = typeof simulateTeacherUpdate === "function";
      if (request.method !== "GET" && request.method !== "POST") {
        response.setHeader("Allow", supportsWrite || supportsSimulation ? "GET, POST, OPTIONS" : "GET, OPTIONS");
        return json(response, 405, { error: "method_not_allowed" }, "private, no-store");
      }
      if (request.method === "POST" && !supportsWrite && !supportsSimulation) {
        response.setHeader("Allow", "GET, OPTIONS");
        return json(response, 405, { error: "method_not_allowed" }, "private, no-store");
      }

      const tokenClaims = await authorize(request, response);
      if (!tokenClaims) return;

      if (request.method === "GET") {
        if (typeof loadSheetData !== "function") {
          return json(response, 503, { error: "sheet_reader_unavailable" }, "private, no-store");
        }
        try {
          const data = await loadSheetData();
          if (!Array.isArray(data?.teachers)) throw new Error("invalid sheet reader result");
          return json(response, 200, { teachers: data.teachers }, "private, no-store");
        } catch (error) {
          const safeCode = typeof error?.code === "string" ? error.code : "sheet_read_failed";
          return json(response, 502, { error: safeCode }, "private, no-store");
        }
      }

      try {
        const limiterKey = rateLimitKey(`teacher-update:${clientIdentifier(request)}`, getRateLimitKey());
        const limiterResult = await rateLimiter.consume(limiterKey, now());
        if (!limiterResult.allowed) {
          response.setHeader("Retry-After", String(limiterResult.retryAfterSeconds));
          return json(response, 429, { error: "too_many_attempts" }, "private, no-store");
        }
        const requestHash = rateLimitKey(`audit:${tokenClaims.jti}`, getRateLimitKey());
        const result = supportsWrite
          ? await writeTeacher(requestBody(request), { requestHash })
          : await simulateTeacherUpdate(requestBody(request));
        if (!result?.validation?.valid) {
          return json(response, 400, { error: "validation_failed", details: result?.validation?.errors || [] }, "private, no-store");
        }
        return json(response, 200, {
          success: true,
          action: result.action === "insert" ? "add" : result.action,
          message: supportsWrite
            ? result.action === "insert" ? "資料已成功新增。" : "資料已成功更新。"
            : result.message,
          simulated: !supportsWrite,
          persisted: supportsWrite
        }, "private, no-store");
      } catch (error) {
        const code = typeof error?.code === "string" ? error.code : "teacher_write_failed";
        if (code === "insert_not_enabled") {
          return json(response, 409, { error: code }, "private, no-store");
        }
        const status = code === "write_lock_timeout" || code === "write_lock_expired" ? 503 : 502;
        return json(response, status, { error: code }, "private, no-store");
      }
    }

    if (path === "/internal/sheets/summary") {
      if (request.method !== "GET") {
        response.setHeader("Allow", "GET, OPTIONS");
        return json(response, 405, { error: "method_not_allowed" }, "private, no-store");
      }

      const claims = await authorize(request, response);
      if (!claims) return;

      if (typeof loadSheetData !== "function") {
        return json(response, 503, { error: "sheet_reader_unavailable" }, "private, no-store");
      }
      try {
        const { summary } = await loadSheetData();
        return json(response, 200, { summary }, "private, no-store");
      } catch (error) {
        const safeCode = typeof error?.code === "string" ? error.code : "sheet_read_failed";
        return json(response, 502, { error: safeCode }, "private, no-store");
      }
    }
    return json(response, 404, { error: "not_found" }, "no-store");
  };
}

module.exports = {
  createApi,
  setCorsHeaders
};
