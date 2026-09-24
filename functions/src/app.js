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

function passwordFrom(request) {
  if (request.body && typeof request.body === "object") return request.body.password;
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body).password; } catch { return undefined; }
  }
  return undefined;
}

function clientIdentifier(request) {
  return request.ip || request.socket?.remoteAddress || "unknown";
}

function createApi({
  getAccessPassword,
  getSigningKey,
  getRateLimitKey,
  allowedOrigins,
  rateLimiter,
  loadSheetData,
  now = () => Date.now()
}) {
  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) throw new Error("allowedOrigins is required");
  if (!rateLimiter || typeof rateLimiter.consume !== "function") throw new Error("rateLimiter is required");

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

      let limiterResult;
      try {
        const key = rateLimitKey(clientIdentifier(request), getRateLimitKey());
        limiterResult = await rateLimiter.consume(key, now());
      } catch {
        return json(response, 503, { error: "authentication_temporarily_unavailable" }, "no-store");
      }
      if (!limiterResult.allowed) {
        response.setHeader("Retry-After", String(limiterResult.retryAfterSeconds));
        return json(response, 429, { error: "too_many_attempts" }, "no-store");
      }

      const password = passwordFrom(request);
      if (typeof password !== "string" || password.length === 0 || password.length > 256) {
        return json(response, 400, { error: "password_required" }, "no-store");
      }

      try {
        if (!passwordMatches(password, getAccessPassword())) {
          return json(response, 401, { error: "invalid_credentials" }, "no-store");
        }
        const token = issueToken({ signingKey: getSigningKey(), nowSeconds: Math.floor(now() / 1000) });
        return json(response, 200, { token, tokenType: "Bearer", expiresIn: TOKEN_TTL_SECONDS }, "no-store");
      } catch {
        return json(response, 503, { error: "authentication_temporarily_unavailable" }, "no-store");
      }
    }

    if (path === "/teachers") {
      if (request.method !== "GET") {
        response.setHeader("Allow", "GET, OPTIONS");
        return json(response, 405, { error: "method_not_allowed" }, "private, no-store");
      }

      const token = bearerToken(request.headers?.authorization);
      if (!token) return json(response, 401, { error: "unauthorized" }, "private, no-store");
      try {
        verifyToken(token, {
          signingKey: getSigningKey(),
          audience: TOKEN_AUDIENCE,
          nowSeconds: Math.floor(now() / 1000)
        });
      } catch {
        return json(response, 401, { error: "unauthorized" }, "private, no-store");
      }
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

    if (path === "/internal/sheets/summary") {
      if (request.method !== "GET") {
        response.setHeader("Allow", "GET, OPTIONS");
        return json(response, 405, { error: "method_not_allowed" }, "private, no-store");
      }

      const token = bearerToken(request.headers?.authorization);
      if (!token) return json(response, 401, { error: "unauthorized" }, "private, no-store");
      try {
        verifyToken(token, {
          signingKey: getSigningKey(),
          audience: TOKEN_AUDIENCE,
          nowSeconds: Math.floor(now() / 1000)
        });
      } catch {
        return json(response, 401, { error: "unauthorized" }, "private, no-store");
      }

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
