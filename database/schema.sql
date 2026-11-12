PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS source_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
  entity_type TEXT NOT NULL CHECK (length(trim(entity_type)) BETWEEN 1 AND 80),
  field_name TEXT NOT NULL CHECK (length(trim(field_name)) BETWEEN 1 AND 100),
  current_value TEXT NOT NULL CHECK (length(trim(current_value)) BETWEEN 1 AND 500),
  previous_value TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dependent_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_name TEXT NOT NULL CHECK (length(trim(record_name)) BETWEEN 1 AND 160),
  record_type TEXT NOT NULL CHECK (length(trim(record_type)) BETWEEN 1 AND 100),
  source_record_id INTEGER NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
  field_name TEXT NOT NULL CHECK (length(trim(field_name)) BETWEEN 1 AND 100),
  stored_value TEXT NOT NULL CHECK (length(trim(stored_value)) BETWEEN 1 AND 500),
  status TEXT NOT NULL DEFAULT 'CURRENT' CHECK (status IN ('CURRENT', 'OUTDATED', 'REVIEW')),
  last_updated TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS correction_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_record_id INTEGER NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
  dependent_record_id INTEGER NOT NULL REFERENCES dependent_records(id) ON DELETE RESTRICT,
  old_value TEXT NOT NULL,
  new_value TEXT NOT NULL,
  confidence INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  confidence_level TEXT NOT NULL CHECK (confidence_level IN ('HIGH', 'MEDIUM', 'LOW')),
  confidence_reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'REJECTED', 'APPROVED', 'VERIFIED', 'FAILED')),
  approved_by TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  verification_message TEXT
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  source_record_id INTEGER REFERENCES source_records(id) ON DELETE SET NULL,
  dependent_record_id INTEGER REFERENCES dependent_records(id) ON DELETE SET NULL,
  correction_id INTEGER REFERENCES correction_logs(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS college_students (
  student_id TEXT PRIMARY KEY CHECK (length(trim(student_id)) BETWEEN 1 AND 40),
  college_name TEXT NOT NULL,
  student_name TEXT NOT NULL CHECK (length(trim(student_name)) BETWEEN 1 AND 160),
  department TEXT NOT NULL,
  academic_year TEXT NOT NULL,
  year_name TEXT NOT NULL,
  semester TEXT NOT NULL,
  roll_number TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  previous_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS college_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id TEXT NOT NULL REFERENCES college_students(student_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  module_key TEXT NOT NULL,
  module_name TEXT NOT NULL,
  record_key TEXT NOT NULL DEFAULT 'primary',
  data_json TEXT NOT NULL CHECK (json_valid(data_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (student_id, module_key, record_key)
);

CREATE TABLE IF NOT EXISTS college_name_change_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id TEXT NOT NULL REFERENCES college_students(student_id) ON DELETE RESTRICT,
  field_name TEXT NOT NULL DEFAULT 'student_name',
  old_name TEXT NOT NULL,
  new_name TEXT NOT NULL,
  baseline_json TEXT NOT NULL CHECK (json_valid(baseline_json)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS college_correction_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES college_name_change_runs(id) ON DELETE RESTRICT,
  student_id TEXT NOT NULL REFERENCES college_students(student_id) ON DELETE RESTRICT,
  college_record_id INTEGER NOT NULL REFERENCES college_records(id) ON DELETE RESTRICT,
  field_name TEXT NOT NULL,
  old_value TEXT NOT NULL,
  new_value TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'REJECTED', 'APPROVED', 'VERIFIED', 'FAILED')),
  approved_by TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  verification_message TEXT,
  UNIQUE (run_id, college_record_id, field_name)
);

CREATE TABLE IF NOT EXISTS college_audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER REFERENCES college_name_change_runs(id) ON DELETE SET NULL,
  student_id TEXT REFERENCES college_students(student_id) ON DELETE SET NULL,
  college_record_id INTEGER REFERENCES college_records(id) ON DELETE SET NULL,
  proposal_id INTEGER REFERENCES college_correction_proposals(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  message TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dependents_source ON dependent_records(source_record_id);
CREATE INDEX IF NOT EXISTS idx_corrections_status ON correction_logs(status);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_college_records_student ON college_records(student_id, module_key);
CREATE INDEX IF NOT EXISTS idx_college_proposals_run_status ON college_correction_proposals(run_id, status);
CREATE INDEX IF NOT EXISTS idx_college_audit_student ON college_audit_events(student_id, created_at DESC);
