"use strict";

const crypto = require("node:crypto");

const TOKEN_TTL_SECONDS = 30 * 60;
const TOKEN_ISSUER = "school-tools-v2-api";
const TOKEN_AUDIENCE = "school-tools-v2-teachers";

function encode(value) {
  const content = typeof value === "string" ? value : JSON.stringify(value);
  return Buffer.from(content).toString("base64url");
}

function decodeJson(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function requireSecret(value, name) {
  if (typeof value !== "string" || value.length < 32) {
    throw new Error(`${name} is unavailable or too short`);
  }
  return value;
}

function safeEqual(left, right) {
  const leftDigest = crypto.createHash("sha256").update(String(left)).digest();
  const rightDigest = crypto.createHash("sha256").update(String(right)).digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

function requireAccessPassword(value) {
  if (typeof value !== "string" || value.trim().length < 8) {
    throw new Error("ACCESS_PASSWORD is unavailable or too short");
  }
  return value.trim();
}

function passwordMatches(candidate, configuredPassword) {
  const expected = requireAccessPassword(configuredPassword).toLocaleLowerCase("en-US");
  if (typeof candidate !== "string") return false;
  const supplied = candidate.trim().toLocaleLowerCase("en-US");
  return supplied.length > 0 && safeEqual(supplied, expected);
}

function sign(unsignedToken, signingKey) {
  requireSecret(signingKey, "TOKEN_SIGNING_KEY");
  return crypto.createHmac("sha256", signingKey).update(unsignedToken).digest("base64url");
}

function issueToken({ signingKey, nowSeconds = Math.floor(Date.now() / 1000), audience = TOKEN_AUDIENCE, expiresInSeconds = TOKEN_TTL_SECONDS, sessionVersion = "1", sessionKey = "0".repeat(64) }) {
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: TOKEN_ISSUER,
    aud: audience,
    sub: "shared-school-access",
    sid: sessionKey,
    sv: String(sessionVersion),
    jti: crypto.randomUUID(),
    iat: nowSeconds,
    exp: nowSeconds + expiresInSeconds
  };
  const unsignedToken = `${encode(header)}.${encode(payload)}`;
  return `${unsignedToken}.${sign(unsignedToken, signingKey)}`;
}

function verifyToken(token, { signingKey, nowSeconds = Math.floor(Date.now() / 1000), audience = TOKEN_AUDIENCE, expectedSessionVersion = null, clockSkewSeconds = 30 } = {}) {
  if (typeof token !== "string") throw new Error("invalid token");
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) throw new Error("invalid token");

  const [encodedHeader, encodedPayload, suppliedSignature] = parts;
  let header;
  let payload;
  try {
    header = decodeJson(encodedHeader);
    payload = decodeJson(encodedPayload);
  } catch {
    throw new Error("invalid token");
  }

  if (header.alg !== "HS256" || header.typ !== "JWT") throw new Error("invalid token");
  const expectedSignature = sign(`${encodedHeader}.${encodedPayload}`, signingKey);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    throw new Error("invalid token");
  }

  if (payload.iss !== TOKEN_ISSUER || payload.aud !== audience) throw new Error("invalid token");
  if (typeof payload.sv !== "string" || !payload.sv || payload.sv.length > 64) throw new Error("invalid token");
  if (expectedSessionVersion !== null && payload.sv !== String(expectedSessionVersion)) throw new Error("invalid token");
  if (typeof payload.sid !== "string" || !/^[a-f0-9]{64}$/.test(payload.sid)) throw new Error("invalid token");
  if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)) throw new Error("invalid token");
  if (payload.iat > nowSeconds + clockSkewSeconds) throw new Error("invalid token");
  if (payload.exp <= nowSeconds) throw new Error("invalid token");
  if (payload.exp <= payload.iat || payload.exp - payload.iat > TOKEN_TTL_SECONDS) throw new Error("invalid token");
  return payload;
}

function bearerToken(headerValue) {
  if (typeof headerValue !== "string") return null;
  const match = headerValue.match(/^Bearer ([A-Za-z0-9._~-]+)$/);
  return match ? match[1] : null;
}

function rateLimitKey(identifier, key) {
  requireSecret(key, "RATE_LIMIT_KEY");
  return crypto.createHmac("sha256", key).update(String(identifier || "unknown")).digest("hex");
}

module.exports = {
  TOKEN_AUDIENCE,
  TOKEN_ISSUER,
  TOKEN_TTL_SECONDS,
  bearerToken,
  issueToken,
  passwordMatches,
  rateLimitKey,
  verifyToken
};
