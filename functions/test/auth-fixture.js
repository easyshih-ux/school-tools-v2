"use strict";

const crypto = require("node:crypto");

function credential() {
  return `${crypto.randomBytes(24).toString("base64url")}.${crypto.randomBytes(32).toString("base64url")}`;
}

function createTestDeviceSessions() {
  return {
    async create() {
      return { credential: credential(), sessionKey: "0".repeat(64) };
    },
    async refresh({ credential: current }) {
      return { credential: `${current.split(".")[0]}.${crypto.randomBytes(32).toString("base64url")}`, sessionKey: "0".repeat(64) };
    },
    async revoke() {},
    async assertAccess() { return true; }
  };
}

module.exports = { createTestDeviceSessions };
