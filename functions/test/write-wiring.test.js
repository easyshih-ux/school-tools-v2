"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

test("Gate 4B production wiring 預設關閉且禁止正式 insert", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  assert.match(source, /SCHOOL_TOOLS_WRITE_ENABLED", \{ default: "false" \}/);
  assert.match(source, /writeEnabled\.value\(\) === "true"/);
  assert.match(source, /allowInsert: false/);
  assert.match(source, /writeTeacher: writer\?\.write/);
});
