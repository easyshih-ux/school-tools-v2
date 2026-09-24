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

function textCell(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function groupStatus(value) {
  if (value === true) return "已加入";
  if (value === false || value === null || value === undefined) return "未加入";
  const text = textCell(value);
  if (!text || text.toLocaleLowerCase("en-US") === "false") return "未加入";
  if (text.toLocaleLowerCase("en-US") === "true") return "已加入";
  return text;
}

function mapTeacherRows(rows) {
  if (!Array.isArray(rows)) throw new TypeError("rows must be an array");
  const teachers = [];
  rows.forEach((source) => {
    const row = Array.isArray(source) ? source : [];
    const name = textCell(row[2]);
    if (!name) return;
    teachers.push({
      office: textCell(row[0]),
      title: textCell(row[1]),
      name,
      lineName: textCell(row[3]),
      subject: textCell(row[4]),
      ext: textCell(row[5]),
      inSmallGroup: groupStatus(row[6])
    });
  });
  return teachers;
}

function rawGroupCategory(value) {
  if (value === true) return "booleanTrue";
  if (value === false) return "booleanFalse";
  if (value === null || value === undefined || textCell(value) === "") return "blank";
  if (typeof value !== "string") return "otherType";
  const normalized = textCell(value).toLocaleLowerCase("en-US");
  if (normalized === "true" || normalized === "已加入") return "joinedText";
  if (normalized === "false" || normalized === "未加入") return "notJoinedText";
  return "otherText";
}

function summarizeTeacherRows(rows) {
  if (!Array.isArray(rows)) throw new TypeError("rows must be an array");
  const teachers = mapTeacherRows(rows);
  const emptyByField = Object.fromEntries(TEACHER_FIELDS.map((field) => [field, 0]));
  teachers.forEach((teacher) => {
    TEACHER_FIELDS.forEach((field) => {
      if (field !== "inSmallGroup" && teacher[field] === "") emptyByField[field] += 1;
    });
  });
  const inSmallGroupTypes = {
    booleanTrue: 0,
    booleanFalse: 0,
    blank: 0,
    joinedText: 0,
    notJoinedText: 0,
    otherText: 0,
    otherType: 0
  };
  rows.forEach((row) => {
    const category = rawGroupCategory(Array.isArray(row) ? row[6] : undefined);
    inSmallGroupTypes[category] += 1;
  });
  return {
    sourceRowCount: rows.length,
    mappedRowCount: teachers.length,
    skippedBlankNameCount: rows.length - teachers.length,
    officeCount: new Set(teachers.map((teacher) => teacher.office).filter(Boolean)).size,
    schema: [...TEACHER_FIELDS],
    mappingValid: teachers.every((teacher) =>
      Object.keys(teacher).length === TEACHER_FIELDS.length && TEACHER_FIELDS.every((field) => Object.hasOwn(teacher, field))
    ),
    emptyByField,
    inSmallGroupTypes
  };
}

module.exports = {
  TEACHER_FIELDS,
  groupStatus,
  mapTeacherRows,
  summarizeTeacherRows,
  textCell
};
