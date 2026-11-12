const { db } = require('../database/db');
const { moduleDefinitions } = require('../database/seed');

const dependentModules = moduleDefinitions.filter(([key]) => key !== 'student_profile');
const modulesByKey = new Map(dependentModules.map(([key, name]) => [key, name]));
const studentFieldColumns = new Map([
  ['student_name', 'student_name'], ['roll_number', 'roll_number'], ['department', 'department'],
  ['academic_year', 'academic_year'], ['year_name', 'year_name'], ['semester', 'semester'],
  ['email', 'email'], ['phone', 'phone']
]);

function audit({ runId = null, studentId, recordId = null, proposalId = null, eventType, oldValue = null, newValue = null, message, details = {} }) {
  db.prepare(`INSERT INTO college_audit_events
    (run_id, student_id, college_record_id, proposal_id, event_type, old_value, new_value, message, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(runId, studentId, recordId, proposalId, eventType, oldValue, newValue, message, JSON.stringify(details), new Date().toISOString());
}

function createAttributeChangeRun(studentId, fieldName, proposedValue) {
  const column = studentFieldColumns.get(fieldName);
  if (!column) return { error: 'This student attribute is not registered for correction.', status: 400 };
  const student = db.prepare('SELECT * FROM college_students WHERE student_id = ?').get(studentId);
  if (!student) return { error: 'Student ID not found.', status: 404 };
  const newValue = proposedValue.trim();
  const oldValue = student[column];
  if (newValue === oldValue) return { error: `The new ${fieldName.replaceAll('_', ' ')} must differ from the current authoritative value.`, status: 400 };

  const now = new Date().toISOString();
  const outcome = db.transaction(() => {
    const records = db.prepare('SELECT id, module_key, data_json FROM college_records WHERE student_id = ? ORDER BY id').all(studentId);
    const profileSnapshot = Object.fromEntries([...studentFieldColumns.keys()].map((field) => [field, student[field]]));
    const baseline = [
      { id: null, module_key: 'student_profile', data: profileSnapshot },
      ...records.map((record) => ({ id: record.id, module_key: record.module_key, data: JSON.parse(record.data_json) }))
    ];
    const runResult = db.prepare(`INSERT INTO college_name_change_runs (student_id, field_name, old_name, new_name, baseline_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(studentId, fieldName, oldValue, newValue, JSON.stringify(baseline), now);
    const runId = Number(runResult.lastInsertRowid);

    if (fieldName === 'student_name') {
      db.prepare('UPDATE college_students SET previous_name = student_name, student_name = ?, updated_at = ? WHERE student_id = ?').run(newValue, now, studentId);
    } else {
      db.prepare(`UPDATE college_students SET ${column} = ?, updated_at = ? WHERE student_id = ?`).run(newValue, now, studentId);
    }
    audit({ runId, studentId, eventType: 'MANUAL_SOURCE_ATTRIBUTE_CHANGED', oldValue, newValue, message: `Authoritative Student Profile ${fieldName} changed for ${studentId}.`, details: { field_name: fieldName, recordsSnapshotted: baseline.length } });

    const linkedRecords = db.prepare('SELECT id, module_key, module_name, data_json FROM college_records WHERE student_id = ? ORDER BY id').all(studentId);
    const insertProposal = db.prepare(`INSERT INTO college_correction_proposals
      (run_id, student_id, college_record_id, field_name, old_value, new_value, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?)`);
    for (const record of linkedRecords) {
      const data = JSON.parse(record.data_json);
      if (!Object.hasOwn(data, fieldName) || data[fieldName] === newValue || typeof data[fieldName] !== 'string') continue;
      const proposalId = Number(insertProposal.run(runId, studentId, record.id, fieldName, data[fieldName], newValue, now).lastInsertRowid);
      audit({ runId, studentId, recordId: record.id, proposalId, eventType: 'CORRECTION_PROPOSED', oldValue: data[fieldName], newValue, message: `${fieldName.replaceAll('_', ' ')} mismatch detected in ${record.module_name}.`, details: { module_key: record.module_key, field_name: fieldName } });
    }
    return runId;
  })();

  return { runId: outcome, report: getRunReport(outcome) };
}

function createNameChangeRun(studentId, proposedName) {
  return createAttributeChangeRun(studentId, 'student_name', proposedName);
}

function getLatestRun(studentId) {
  return db.prepare('SELECT * FROM college_name_change_runs WHERE student_id = ? ORDER BY id DESC LIMIT 1').get(studentId);
}

function compareFields(before, current, trackedField) {
  return [...new Set([...Object.keys(before), ...Object.keys(current)])]
    .filter((field) => field !== trackedField)
    .map((field) => ({
      field,
      before: before[field] ?? null,
      current: current[field] ?? null,
      unchanged: JSON.stringify(before[field] ?? null) === JSON.stringify(current[field] ?? null)
    }));
}

function getRunReport(runId) {
  const run = db.prepare(`SELECT r.*, r.created_at AS run_created_at, s.*
    FROM college_name_change_runs r JOIN college_students s ON s.student_id = r.student_id WHERE r.id = ?`).get(runId);
  if (!run) return null;
  const currentValue = run[studentFieldColumns.get(run.field_name)];
  const isNameChange = run.field_name === 'student_name';

  const records = db.prepare('SELECT * FROM college_records WHERE student_id = ? ORDER BY module_name, id').all(run.student_id);
  const recordsByModule = new Map(records.map((record) => [record.module_key, record]));
  const baseline = new Map(JSON.parse(run.baseline_json).map((snapshot) => [snapshot.id, snapshot.data]));
  const proposals = db.prepare(`SELECT p.*, cr.module_key, cr.module_name FROM college_correction_proposals p
    JOIN college_records cr ON cr.id = p.college_record_id AND cr.student_id = p.student_id WHERE p.run_id = ? ORDER BY p.id`).all(runId);
  const proposalByRecord = new Map(proposals.map((proposal) => [proposal.college_record_id, proposal]));
  const findings = [];
  const sourceSnapshot = baseline.get(null) || {};
  const currentProfile = Object.fromEntries([...studentFieldColumns.keys()].map((field) => [field, run[field]]));
  const profileComparisons = compareFields(sourceSnapshot, currentProfile, run.field_name);
  const authoritative = {
    record_id: null,
    module_key: 'student_profile',
    module_name: 'Student Profile',
    stored_name: isNameChange ? currentValue : undefined,
    expected_name: isNameChange ? currentValue : undefined,
    stored_value: currentValue,
    expected_value: currentValue,
    status: currentValue === run.new_name ? 'MANUALLY_UPDATED' : 'SOURCE_CHANGED_AGAIN',
    error_description: currentValue === run.new_name ? `Authoritative ${run.field_name.replaceAll('_', ' ')} was manually updated in the Student Profile.` : 'The authoritative value changed again after this test run; review proposals before approving.',
    proposal_id: null,
    other_fields_unchanged: profileComparisons.every((field) => field.unchanged),
    unchanged_fields: profileComparisons.filter((field) => field.unchanged).map((field) => field.field),
    field_comparisons: profileComparisons,
    unexpected_changes: profileComparisons.filter((field) => !field.unchanged)
  };
  findings.push(authoritative);

  for (const [moduleKey, moduleName] of dependentModules) {
    const record = recordsByModule.get(moduleKey);
    if (!record) {
      findings.push({ record_id: null, module_key: moduleKey, module_name: moduleName, stored_name: null, expected_name: currentValue, stored_value: null, expected_value: currentValue, status: 'MISSING', error_description: `No ${moduleName} is registered for Student ID ${run.student_id}.`, proposal_id: null, other_fields_unchanged: false, unchanged_fields: [] });
      continue;
    }
    const data = JSON.parse(record.data_json);
    const storedValue = typeof data[run.field_name] === 'string' ? data[run.field_name] : null;
    const proposal = proposalByRecord.get(record.id) || null;
    const originalData = baseline.get(record.id);
    const fieldComparisons = originalData ? compareFields(originalData, data, run.field_name) : [];
    const unchangedFields = fieldComparisons.filter((field) => field.unchanged).map((field) => field.field);
    const unexpectedChanges = fieldComparisons.filter((field) => !field.unchanged);
    let status;
    let errorDescription = '';
    if (storedValue === null) {
      status = 'NOT_TRACKED';
      errorDescription = `${moduleName} does not store ${run.field_name.replaceAll('_', ' ')}; no value was changed.`;
    } else if (storedValue === currentValue) {
      status = proposal && proposal.status === 'VERIFIED' ? 'VERIFIED' : 'CONSISTENT';
      errorDescription = `Stored ${run.field_name.replaceAll('_', ' ')} matches the authoritative Student Profile.`;
    } else if (proposal && proposal.status === 'REJECTED') {
      status = 'REJECTED';
      errorDescription = `Correction was rejected; ${moduleName} still stores “${storedValue}”.`;
    } else if (proposal && proposal.status === 'APPROVED') {
      status = 'APPROVED';
      errorDescription = `Correction is approved and waiting to be propagated; ${moduleName} still stores “${storedValue}”.`;
    } else if (proposal && proposal.status === 'FAILED') {
      status = 'FAILED';
      errorDescription = proposal.verification_message || 'Propagation or verification failed.';
    } else {
      status = 'OUTDATED';
      errorDescription = `${isNameChange ? 'STUDENT NAME MISMATCH DETECTED' : `${run.field_name.replaceAll('_', ' ').toUpperCase()} MISMATCH DETECTED`}: The Student Profile contains “${currentValue}”, but ${moduleName} still contains “${storedValue}”.`;
    }
    findings.push({
      record_id: record.id,
      module_key: moduleKey,
      module_name: record.module_name,
      stored_name: isNameChange ? storedValue : undefined,
      expected_name: isNameChange ? currentValue : undefined,
      stored_value: storedValue,
      expected_value: currentValue,
      status,
      error_description: errorDescription,
      proposal_id: proposal && ['PENDING', 'APPROVED'].includes(proposal.status) ? proposal.id : null,
      proposal_status: proposal ? proposal.status : null,
      other_fields_unchanged: unexpectedChanges.length === 0,
      unchanged_fields: unchangedFields,
      field_comparisons: fieldComparisons,
      unexpected_changes: unexpectedChanges,
      record_data: data
    });
  }

  const proposalsPending = proposals.filter((proposal) => proposal.status === 'PENDING').length;
  const rejected = proposals.filter((proposal) => proposal.status === 'REJECTED').length;
  const verified = proposals.filter((proposal) => proposal.status === 'VERIFIED').length;
  const failedProposals = proposals.filter((proposal) => proposal.status === 'FAILED').length;
  const missingCount = findings.filter((finding) => finding.status === 'MISSING').length;
  const outdatedCount = findings.filter((finding) => ['OUTDATED', 'REJECTED', 'FAILED', 'NEEDS_REVIEW'].includes(finding.status)).length;
  const unexpectedChanges = findings.flatMap((finding) => (finding.unexpected_changes || []).map((change) => ({ module_name: finding.module_name, record_id: finding.record_id, ...change })));
  return {
    run: { id: run.id, student_id: run.student_id, field_name: run.field_name, old_value: run.old_name, new_value: run.new_name, old_name: isNameChange ? run.old_name : undefined, new_name: isNameChange ? run.new_name : undefined, current_value: currentValue, current_name: isNameChange ? currentValue : undefined, created_at: run.run_created_at },
    student: { student_id: run.student_id, college_name: run.college_name, department: run.department, academic_year: run.academic_year, year_name: run.year_name, semester: run.semester, roll_number: run.roll_number, email: run.email, phone: run.phone },
    summary: {
      recordsChecked: findings.length,
      dependentRecordsChecked: findings.length - 1,
      outdatedRecords: outdatedCount,
      consistentRecords: findings.filter((finding) => ['CONSISTENT', 'VERIFIED', 'MANUALLY_UPDATED'].includes(finding.status)).length,
      failedOrMissingRecords: findings.filter((finding) => ['FAILED', 'MISSING', 'NEEDS_REVIEW'].includes(finding.status)).length,
      missingRecords: missingCount,
      pendingCorrections: proposalsPending,
      approvedCorrections: proposals.filter((proposal) => ['APPROVED', 'VERIFIED'].includes(proposal.status)).length,
      rejectedCorrections: rejected,
      verifiedCorrections: verified,
      failedCorrections: failedProposals,
      unchangedFieldCount: findings.reduce((sum, finding) => sum + finding.unchanged_fields.length, 0),
      unexpectedChangeCount: unexpectedChanges.length
    },
    unchangedFields: [...new Set(findings.flatMap((finding) => finding.unchanged_fields))],
    unexpectedChanges,
    findings,
    proposals
  };
}

function getStudentDetail(studentId) {
  const student = db.prepare('SELECT * FROM college_students WHERE student_id = ?').get(studentId);
  if (!student) return null;
  const records = db.prepare('SELECT * FROM college_records WHERE student_id = ? ORDER BY module_name, id').all(studentId).map((record) => ({ ...record, data: JSON.parse(record.data_json) }));
  const run = getLatestRun(studentId);
  return { student, records, latestReport: run ? getRunReport(run.id) : null };
}

function getStudentList(search = '') {
  const query = search.trim().slice(0, 100);
  return query
    ? db.prepare('SELECT student_id, student_name, department, year_name, semester, roll_number FROM college_students WHERE student_id LIKE ? OR student_name LIKE ? OR roll_number LIKE ? ORDER BY student_id')
      .all(`%${query}%`, `%${query}%`, `%${query}%`)
    : db.prepare('SELECT student_id, student_name, department, year_name, semester, roll_number FROM college_students ORDER BY student_id').all();
}

function decideProposal(proposalId, reviewer, decision) {
  const proposal = db.prepare(`SELECT p.*, r.new_name, r.field_name AS tracked_field, r.baseline_json, cr.module_name, cr.data_json
    FROM college_correction_proposals p
    JOIN college_name_change_runs r ON r.id = p.run_id
    JOIN college_records cr ON cr.id = p.college_record_id AND cr.student_id = p.student_id
    WHERE p.id = ?`).get(proposalId);
  if (!proposal) return { error: 'Correction proposal not found.', status: 404 };
  if (proposal.status !== 'PENDING') return { error: `Correction is already ${proposal.status.toLowerCase()}.`, status: 409 };
  const now = new Date().toISOString();
  if (decision === 'reject') {
    db.transaction(() => {
      db.prepare("UPDATE college_correction_proposals SET status = 'REJECTED', approved_by = ?, completed_at = ?, verification_message = 'Rejected by reviewer; dependent data was not changed.' WHERE id = ?")
        .run(reviewer, now, proposalId);
      audit({ runId: proposal.run_id, studentId: proposal.student_id, recordId: proposal.college_record_id, proposalId, eventType: 'CORRECTION_REJECTED', oldValue: proposal.old_value, newValue: proposal.new_value, message: `${proposal.module_name} ${proposal.tracked_field} correction rejected by ${reviewer}.` });
    })();
    return { proposal: db.prepare('SELECT * FROM college_correction_proposals WHERE id = ?').get(proposalId) };
  }

  db.transaction(() => {
    db.prepare("UPDATE college_correction_proposals SET status = 'APPROVED', approved_by = ? WHERE id = ?").run(reviewer, proposalId);
    audit({ runId: proposal.run_id, studentId: proposal.student_id, recordId: proposal.college_record_id, proposalId, eventType: 'CORRECTION_APPROVED', oldValue: proposal.old_value, newValue: proposal.new_value, message: `${proposal.module_name} ${proposal.tracked_field} correction approved by ${reviewer}; awaiting explicit propagation.` });
  })();
  return { proposal: db.prepare('SELECT * FROM college_correction_proposals WHERE id = ?').get(proposalId) };
}

function propagateApproved(runId) {
  const run = db.prepare('SELECT * FROM college_name_change_runs WHERE id = ?').get(runId);
  if (!run) return null;
  const proposals = db.prepare(`SELECT p.*, cr.module_name FROM college_correction_proposals p
    JOIN college_records cr ON cr.id = p.college_record_id AND cr.student_id = p.student_id
    WHERE p.run_id = ? AND p.status = 'APPROVED' ORDER BY p.id`).all(runId);
  const baseline = new Map(JSON.parse(run.baseline_json).map((snapshot) => [snapshot.id, snapshot.data]));
  const now = new Date().toISOString();
  const results = db.transaction(() => proposals.map((proposal) => {
    const column = studentFieldColumns.get(proposal.field_name);
    const student = db.prepare('SELECT * FROM college_students WHERE student_id = ?').get(run.student_id);
    const record = db.prepare('SELECT student_id, data_json FROM college_records WHERE id = ? AND student_id = ?').get(proposal.college_record_id, run.student_id);
    const data = record ? JSON.parse(record.data_json) : null;
    const sourceValue = student && column ? student[column] : null;
    if (!student || sourceValue !== run.new_name || !record || record.student_id !== proposal.student_id || !data || data.student_id !== proposal.student_id || data[proposal.field_name] !== proposal.old_value) {
      const message = 'Propagation blocked: source identity or dependent field changed since approval.';
      db.prepare("UPDATE college_correction_proposals SET status = 'FAILED', completed_at = ?, verification_message = ? WHERE id = ?").run(now, message, proposal.id);
      audit({ runId, studentId: run.student_id, recordId: proposal.college_record_id, proposalId: proposal.id, eventType: 'PROPAGATION_FAILED', oldValue: proposal.old_value, newValue: proposal.new_value, message });
      return { id: proposal.id, status: 'FAILED', verification_message: message };
    }

    data[proposal.field_name] = proposal.new_value;
    const updated = db.prepare(`UPDATE college_records SET data_json = ?, updated_at = ?
      WHERE id = ? AND student_id = ? AND json_extract(data_json, ?) = ?`)
      .run(JSON.stringify(data), now, proposal.college_record_id, proposal.student_id, `$.${proposal.field_name}`, proposal.old_value);
    if (updated.changes !== 1) {
      const message = 'Propagation failed: the linked record was not updated.';
      db.prepare("UPDATE college_correction_proposals SET status = 'FAILED', completed_at = ?, verification_message = ? WHERE id = ?").run(now, message, proposal.id);
      audit({ runId, studentId: run.student_id, recordId: proposal.college_record_id, proposalId: proposal.id, eventType: 'PROPAGATION_FAILED', oldValue: proposal.old_value, newValue: proposal.new_value, message });
      return { id: proposal.id, status: 'FAILED', verification_message: message };
    }

    audit({ runId, studentId: run.student_id, recordId: proposal.college_record_id, proposalId: proposal.id, eventType: 'PROPAGATION_COMPLETED', oldValue: proposal.old_value, newValue: proposal.new_value, message: `Approved ${proposal.field_name} propagated to ${proposal.module_name}; other fields were not included in the update.` });
    const refreshed = db.prepare('SELECT student_id, data_json FROM college_records WHERE id = ? AND student_id = ?').get(proposal.college_record_id, proposal.student_id);
    const actual = refreshed ? JSON.parse(refreshed.data_json) : null;
    const baselineRecord = baseline.get(proposal.college_record_id);
    const preserved = Boolean(actual && baselineRecord && Object.keys(baselineRecord).filter((key) => key !== proposal.field_name)
      .every((key) => JSON.stringify(actual[key]) === JSON.stringify(baselineRecord[key])));
    const verified = Boolean(refreshed && refreshed.student_id === proposal.student_id && actual && actual.student_id === proposal.student_id && actual[proposal.field_name] === sourceValue && preserved);
    const status = verified ? 'VERIFIED' : 'FAILED';
    const message = verified
      ? `Database re-read confirms ${proposal.field_name} and all snapshotted other fields are unchanged.`
      : 'Database re-read failed attribute, student identity, or other-field preservation verification.';
    db.prepare('UPDATE college_correction_proposals SET status = ?, completed_at = ?, verification_message = ? WHERE id = ?').run(status, new Date().toISOString(), message, proposal.id);
    audit({ runId, studentId: run.student_id, recordId: proposal.college_record_id, proposalId: proposal.id, eventType: verified ? 'VERIFICATION_PASSED' : 'VERIFICATION_FAILED', oldValue: proposal.old_value, newValue: proposal.new_value, message });
    return { id: proposal.id, status, verification_message: message };
  }))();
  return { results, report: getRunReport(runId) };
}

function verifyRun(runId) {
  const run = db.prepare('SELECT * FROM college_name_change_runs WHERE id = ?').get(runId);
  if (!run) return null;
  const proposals = db.prepare(`SELECT id, college_record_id, status FROM college_correction_proposals WHERE run_id = ? AND status IN ('APPROVED', 'VERIFIED', 'FAILED')`).all(runId);
  const column = studentFieldColumns.get(run.field_name);
  const source = db.prepare('SELECT * FROM college_students WHERE student_id = ?').get(run.student_id);
  const expectedValue = source && column ? source[column] : null;
  for (const proposal of proposals) {
    const row = db.prepare('SELECT student_id, data_json FROM college_records WHERE id = ? AND student_id = ?').get(proposal.college_record_id, run.student_id);
    const data = row ? JSON.parse(row.data_json) : null;
    const baseline = JSON.parse(run.baseline_json).find((item) => item.id === proposal.college_record_id);
    const preserved = Boolean(data && baseline && Object.keys(baseline.data).filter((key) => key !== run.field_name).every((key) => JSON.stringify(data[key]) === JSON.stringify(baseline.data[key])));
    const verified = Boolean(row && row.student_id === run.student_id && data && data.student_id === run.student_id && data[run.field_name] === expectedValue && expectedValue === run.new_name && preserved);
    const status = verified ? 'VERIFIED' : 'FAILED';
    const message = verified ? `Database re-read confirms ${run.field_name} and unchanged related fields.` : 'Database re-read detected a mismatch in identity, tracked attribute, or an unrelated field.';
    db.prepare('UPDATE college_correction_proposals SET status = ?, completed_at = ?, verification_message = ? WHERE id = ?').run(status, new Date().toISOString(), message, proposal.id);
    audit({ runId, studentId: run.student_id, recordId: proposal.college_record_id, proposalId: proposal.id, eventType: verified ? 'VERIFICATION_PASSED' : 'VERIFICATION_FAILED', message });
  }
  return getRunReport(runId);
}

function getStudentAudit(studentId, limit = 250) {
  return db.prepare(`SELECT * FROM college_audit_events WHERE student_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`).all(studentId, limit);
}

module.exports = { createNameChangeRun, createAttributeChangeRun, getRunReport, getStudentDetail, getStudentList, decideProposal, propagateApproved, verifyRun, getStudentAudit };
