const { db, recordAudit } = require('../database/db');
const { detectImpacts } = require('./impactDetection');

function createProposals(sourceId) {
  const source = db.prepare('SELECT * FROM source_records WHERE id = ?').get(sourceId);
  if (!source) return null;
  const dependents = db.prepare('SELECT * FROM dependent_records WHERE source_record_id = ?').all(sourceId);
  const impacts = detectImpacts(source, dependents);
  const now = new Date().toISOString();
  const create = db.prepare(`INSERT INTO correction_logs
    (source_record_id, dependent_record_id, old_value, new_value, confidence, confidence_level, confidence_reason, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`);
  const insertAudit = db.prepare(`INSERT INTO audit_events (event_type, source_record_id, dependent_record_id, correction_id, message, details_json, created_at)
    VALUES ('CORRECTION_PROPOSED', ?, ?, ?, ?, ?, ?)`);
  const transaction = db.transaction(() => {
    for (const impact of impacts) {
      const alreadyProposed = db.prepare(`SELECT id FROM correction_logs WHERE source_record_id = ? AND dependent_record_id = ?
        AND old_value = ? AND new_value = ?`).get(sourceId, impact.dependent.id, impact.dependent.stored_value, source.current_value);
      if (alreadyProposed) continue;
      const correctionId = Number(create.run(sourceId, impact.dependent.id, impact.dependent.stored_value, source.current_value, impact.confidence, impact.level, impact.reason, now).lastInsertRowid);
      insertAudit.run(sourceId, impact.dependent.id, correctionId, `Correction proposed for ${impact.dependent.record_name}.`, JSON.stringify({ confidence: impact.level, reason: impact.reason }), now);
      db.prepare("UPDATE dependent_records SET status = ? WHERE id = ?").run(impact.level === 'LOW' ? 'REVIEW' : 'OUTDATED', impact.dependent.id);
    }
  });
  transaction();
  const corrections = db.prepare("SELECT * FROM correction_logs WHERE source_record_id = ? AND new_value = ? AND status = 'PENDING' ORDER BY id").all(sourceId, source.current_value);
  return { source, detected: corrections.length, corrections };
}

function approveCorrection(id, approvedBy) {
  const correction = db.prepare('SELECT * FROM correction_logs WHERE id = ?').get(id);
  if (!correction) return { error: 'Correction proposal not found.', status: 404 };
  if (correction.status !== 'PENDING') return { error: `Correction is already ${correction.status.toLowerCase()}.`, status: 409 };
  const now = new Date().toISOString();
  const result = db.transaction(() => {
    const dependent = db.prepare('SELECT * FROM dependent_records WHERE id = ?').get(correction.dependent_record_id);
    const source = db.prepare('SELECT current_value FROM source_records WHERE id = ?').get(correction.source_record_id);
    db.prepare("UPDATE correction_logs SET status = 'APPROVED', approved_by = ? WHERE id = ?").run(approvedBy, id);
    recordAudit({ eventType: 'CORRECTION_APPROVED', sourceRecordId: correction.source_record_id, dependentRecordId: correction.dependent_record_id, correctionId: id, message: `Correction approved by ${approvedBy}.`, details: { oldValue: correction.old_value, newValue: correction.new_value } });

    if (!source || source.current_value !== correction.new_value || !dependent || dependent.stored_value !== correction.old_value) {
      const message = 'Propagation blocked: the source or dependent value changed after this proposal was created.';
      db.prepare("UPDATE correction_logs SET status = 'FAILED', completed_at = ?, verification_message = ? WHERE id = ?").run(now, message, id);
      recordAudit({ eventType: 'PROPAGATION_FAILED', sourceRecordId: correction.source_record_id, dependentRecordId: correction.dependent_record_id, correctionId: id, message });
      return { id, status: 'FAILED', verification_message: message };
    }

    db.prepare('UPDATE dependent_records SET stored_value = ?, status = \'CURRENT\', last_updated = ? WHERE id = ?').run(correction.new_value, now, correction.dependent_record_id);
    recordAudit({ eventType: 'PROPAGATION_COMPLETED', sourceRecordId: correction.source_record_id, dependentRecordId: correction.dependent_record_id, correctionId: id, message: 'Approved correction propagated to the dependent record.' });
    const refreshed = db.prepare('SELECT stored_value FROM dependent_records WHERE id = ?').get(correction.dependent_record_id);
    const latestSource = db.prepare('SELECT current_value FROM source_records WHERE id = ?').get(correction.source_record_id);
    const verified = refreshed && latestSource && refreshed.stored_value === latestSource.current_value;
    const status = verified ? 'VERIFIED' : 'FAILED';
    const message = verified ? 'Stored dependent value matches the latest source value.' : 'Verification failed: stored dependent value does not match the latest source value.';
    db.prepare('UPDATE correction_logs SET status = ?, completed_at = ?, verification_message = ? WHERE id = ?').run(status, new Date().toISOString(), message, id);
    recordAudit({ eventType: verified ? 'VERIFICATION_PASSED' : 'VERIFICATION_FAILED', sourceRecordId: correction.source_record_id, dependentRecordId: correction.dependent_record_id, correctionId: id, message });
    return { id, status, verification_message: message };
  })();
  return { correction: result };
}

function rejectCorrection(id, rejectedBy) {
  const correction = db.prepare('SELECT * FROM correction_logs WHERE id = ?').get(id);
  if (!correction) return { error: 'Correction proposal not found.', status: 404 };
  if (correction.status !== 'PENDING') return { error: `Correction is already ${correction.status.toLowerCase()}.`, status: 409 };
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare("UPDATE correction_logs SET status = 'REJECTED', approved_by = ?, completed_at = ?, verification_message = 'Rejected by reviewer; dependent value was not changed.' WHERE id = ?").run(rejectedBy, now, id);
    recordAudit({ eventType: 'CORRECTION_REJECTED', sourceRecordId: correction.source_record_id, dependentRecordId: correction.dependent_record_id, correctionId: id, message: `Correction rejected by ${rejectedBy}.`, details: { oldValue: correction.old_value, proposedValue: correction.new_value } });
  })();
  return { correction: { id, status: 'REJECTED' } };
}

function verifyCorrections() {
  const candidates = db.prepare("SELECT * FROM correction_logs WHERE status IN ('APPROVED', 'VERIFIED', 'FAILED')").all();
  const now = new Date().toISOString();
  const verify = db.transaction(() => candidates.map((correction) => {
    const dependent = db.prepare('SELECT stored_value FROM dependent_records WHERE id = ?').get(correction.dependent_record_id);
    const source = db.prepare('SELECT current_value FROM source_records WHERE id = ?').get(correction.source_record_id);
    const verified = Boolean(dependent && source && dependent.stored_value === source.current_value);
    const status = verified ? 'VERIFIED' : 'FAILED';
    const message = verified ? 'Stored dependent value matches the latest source value.' : 'Stored dependent value does not match the latest source value.';
    db.prepare('UPDATE correction_logs SET status = ?, completed_at = ?, verification_message = ? WHERE id = ?').run(status, now, message, correction.id);
    recordAudit({ eventType: verified ? 'VERIFICATION_PASSED' : 'VERIFICATION_FAILED', sourceRecordId: correction.source_record_id, dependentRecordId: correction.dependent_record_id, correctionId: correction.id, message });
    return { id: correction.id, status, verification_message: message };
  }));
  return verify();
}

module.exports = { createProposals, approveCorrection, rejectCorrection, verifyCorrections };
