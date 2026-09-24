"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

test("Gate 4 production wiring 需明確啟用 writer 並允許原版 insert parity", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.match(source, /SCHOOL_TOOLS_WRITE_ENABLED", \{ default: "false" \}/);
  assert.match(source, /writeEnabled\.value\(\) === "true"/);
  assert.match(source, /allowInsert: true/);
  assert.match(source, /writeTeacher: writer\?\.write/);
});
