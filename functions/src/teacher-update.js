"use strict";

const TEACHER_FIELDS = Object.freeze([
  "office",
  "title",
  "name",
  "lineName",
  "subject",
  "ext",
  "inSmallGroup"
]);
const UPDATE_FIELDS = Object.freeze(TEACHER_FIELDS.filter((field) => field !== "name"));
const FORMULA_PREFIX = /^[=+\-@]/;

const SHEETS_VALUE_INPUT_OPTION = "RAW";
function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function trimValue(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function validateTeacherPayload(payload) {
  const errors = [];
  if (!isPlainObject(payload)) {
    return { valid: false, errors: [{ field: "payload", code: "malformed_payload" }] };
  }

  const unknownFields = Object.keys(payload).filter((field) => !TEACHER_FIELDS.includes(field));
  if (unknownFields.length) {
    errors.push({ field: "payload", code: "unknown_fields", fields: unknownFields.sort() });
  }

  for (const field of TEACHER_FIELDS) {
    if (!Object.hasOwn(payload, field) || payload[field] === null || payload[field] === undefined) continue;
    if (typeof payload[field] !== "string" && !(field === "ext" && typeof payload[field] === "number")) {
      errors.push({ field, code: "invalid_type" });
    }
  }

  if (!Object.hasOwn(payload, "name") || typeof payload.name !== "string" || trimValue(payload.name) === "") {
    errors.push({ field: "name", code: "required" });
  }

  return { valid: errors.length === 0, errors };
}

function normalizedSubmission(payload) {
  return Object.fromEntries(TEACHER_FIELDS.map((field) => [field, trimValue(payload[field])]));
}

function normalizedExisting(record) {
  const normalized = Object.fromEntries(TEACHER_FIELDS.map((field) => [field, trimValue(record?.[field])]));
  normalized.inSmallGroup = record?.inSmallGroup
    ? trimValue(record.inSmallGroup)
    : "未加入";
  return normalized;
}

function safeSheetText(value) {
  const text = trimValue(value);
  return FORMULA_PREFIX.test(text) ? `'${text}` : text;
}

function safeSheetRow(record) {
  return TEACHER_FIELDS.map((field) => safeSheetText(record[field]));
}

function failedResult(validation) {
  return {
    action: null,
    target: null,
    normalizedData: null,
    resultingRecord: null,
    safeSheetValues: null,
    validation
  };
}

function applyTeacherUpdate(existingTeachers, submittedData) {
  if (!Array.isArray(existingTeachers)) {
    return failedResult({ valid: false, errors: [{ field: "existingTeachers", code: "invalid_type" }] });
  }
  const validation = validateTeacherPayload(submittedData);
  if (!validation.valid) return failedResult(validation);

  const normalizedData = normalizedSubmission(submittedData);
  const matchingIndexes = [];
  existingTeachers.forEach((teacher, index) => {
    if (trimValue(teacher?.name) === normalizedData.name) matchingIndexes.push(index);
  });

  const records = existingTeachers.map((teacher) => ({ ...teacher }));
  if (matchingIndexes.length) {
    const index = matchingIndexes[0];
    const existing = normalizedExisting(records[index]);
    const resultingRecord = { ...existing, name: normalizedData.name };
    for (const field of UPDATE_FIELDS) {
      if (normalizedData[field] !== "") resultingRecord[field] = normalizedData[field];
    }
    records[index] = resultingRecord;
    return {
      action: "update",
      target: { index, duplicateCount: matchingIndexes.length },
      normalizedData,
      resultingRecord,
      safeSheetValues: safeSheetRow(resultingRecord),
      records,
      validation,
      message: `成功更新「${normalizedData.name}」的資料！`
    };
  }

  const resultingRecord = {
    office: normalizedData.office,
    title: normalizedData.title,
    name: normalizedData.name,
    lineName: normalizedData.lineName,
    subject: normalizedData.subject,
    ext: normalizedData.ext,
    inSmallGroup: normalizedData.inSmallGroup || "未加入"
  };
  records.push(resultingRecord);
  return {
    action: "insert",
    target: { index: records.length - 1, duplicateCount: 0 },
    normalizedData,
    resultingRecord,
    safeSheetValues: safeSheetRow(resultingRecord),
    records,
    validation,
    message: `成功新增「${normalizedData.name}」的資料！`
  };
}

function createTeacherUpdateSimulation(initialTeachers = []) {
  let records = initialTeachers.map((teacher) => ({ ...teacher }));
  return {
    apply(payload) {
      const result = applyTeacherUpdate(records, payload);
      if (result.validation.valid) records = result.records;
      return result;
    },
    snapshot() {
      return records.map((teacher) => ({ ...teacher }));
    }
  };
}

module.exports = {
  TEACHER_FIELDS,
  SHEETS_VALUE_INPUT_OPTION,
  applyTeacherUpdate,
  createTeacherUpdateSimulation,
  safeSheetRow,
  safeSheetText,
  validateTeacherPayload
};
