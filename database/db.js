const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const databasePath = process.env.DB_PATH || path.join(__dirname, 'corrigen.sqlite');
const db = new Database(databasePath);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

const studentColumns = db.prepare('PRAGMA table_info(college_students)').all();
if (studentColumns.length && !studentColumns.some((column) => column.name === 'phone')) {
  db.exec("ALTER TABLE college_students ADD COLUMN phone TEXT NOT NULL DEFAULT ''");
}
const nameRunColumns = db.prepare('PRAGMA table_info(college_name_change_runs)').all();
if (nameRunColumns.length && !nameRunColumns.some((column) => column.name === 'field_name')) {
  db.exec("ALTER TABLE college_name_change_runs ADD COLUMN field_name TEXT NOT NULL DEFAULT 'student_name'");
}

function recordAudit({ eventType, sourceRecordId = null, dependentRecordId = null, correctionId = null, message, details = {} }) {
  db.prepare(`INSERT INTO audit_events (event_type, source_record_id, dependent_record_id, correction_id, message, details_json, created_at)
    VALUES (@eventType, @sourceRecordId, @dependentRecordId, @correctionId, @message, @details, @createdAt)`)
    .run({ eventType, sourceRecordId, dependentRecordId, correctionId, message, details: JSON.stringify(details), createdAt: new Date().toISOString() });
}

module.exports = { db, recordAudit, databasePath };
