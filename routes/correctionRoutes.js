const express = require('express');
const { db } = require('../database/db');
const { createProposals, approveCorrection, rejectCorrection, verifyCorrections } = require('../services/correctionService');
const router = express.Router();

router.get('/impact', (req, res) => {
  const sourceId = req.query.sourceId === undefined ? null : Number(req.query.sourceId);
  if (sourceId !== null && (!Number.isSafeInteger(sourceId) || sourceId < 1)) return res.status(400).json({ error: 'sourceId must be a positive integer.' });
  const sourceFilter = sourceId === null ? '' : 'AND c.source_record_id = ?';
  const args = sourceId === null ? [] : [sourceId];
  const corrections = db.prepare(`SELECT c.*, s.title AS source_title, s.field_name, d.record_name, d.record_type, d.stored_value
    FROM correction_logs c JOIN source_records s ON s.id = c.source_record_id
    JOIN dependent_records d ON d.id = c.dependent_record_id WHERE c.status = 'PENDING' ${sourceFilter}
    ORDER BY CASE c.confidence_level WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END, c.created_at DESC`).all(...args);
  res.json({ corrections, summary: correctionSummary() });
});

router.post('/impact/run', (req, res) => {
  const sourceId = Number(req.body && req.body.source_id);
  if (!Number.isSafeInteger(sourceId) || sourceId < 1) return res.status(400).json({ error: 'A valid source_id is required.' });
  const analysis = createProposals(sourceId);
  if (!analysis) return res.status(404).json({ error: 'Source record not found.' });
  res.json({ source: analysis.source, totalIdentified: analysis.detected, corrections: analysis.corrections, summary: correctionSummary() });
});

router.get('/corrections', (req, res) => {
  const status = req.query.status ? String(req.query.status).toUpperCase() : null;
  const allowed = ['PENDING', 'REJECTED', 'APPROVED', 'VERIFIED', 'FAILED'];
  if (status && !allowed.includes(status)) return res.status(400).json({ error: `status must be one of ${allowed.join(', ')}.` });
  const corrections = db.prepare(`SELECT c.*, s.title AS source_title, d.record_name, d.record_type, d.stored_value
    FROM correction_logs c JOIN source_records s ON s.id = c.source_record_id
    JOIN dependent_records d ON d.id = c.dependent_record_id ${status ? 'WHERE c.status = ?' : ''} ORDER BY c.created_at DESC, c.id DESC`).all(...(status ? [status] : []));
  res.json({ corrections, summary: correctionSummary() });
});

router.post('/corrections/:id/approve', (req, res) => {
  const id = Number(req.params.id);
  const approvedBy = req.body && req.body.approved_by;
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Correction ID must be a positive integer.' });
  if (typeof approvedBy !== 'string' || !approvedBy.trim() || approvedBy.trim().length > 100) return res.status(400).json({ error: 'approved_by is required and must not exceed 100 characters.' });
  const result = approveCorrection(id, approvedBy.trim());
  return result.error ? res.status(result.status).json({ error: result.error }) : res.json(result);
});

router.post('/corrections/:id/reject', (req, res) => {
  const id = Number(req.params.id);
  const rejectedBy = req.body && req.body.rejected_by;
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Correction ID must be a positive integer.' });
  if (typeof rejectedBy !== 'string' || !rejectedBy.trim() || rejectedBy.trim().length > 100) return res.status(400).json({ error: 'rejected_by is required and must not exceed 100 characters.' });
  const result = rejectCorrection(id, rejectedBy.trim());
  return result.error ? res.status(result.status).json({ error: result.error }) : res.json(result);
});

router.post('/verification/run', (req, res) => res.json({ results: verifyCorrections(), summary: correctionSummary() }));
router.get('/verification', (req, res) => {
  const corrections = db.prepare(`SELECT c.*, s.title AS source_title, d.record_name, d.stored_value
    FROM correction_logs c JOIN source_records s ON s.id = c.source_record_id
    JOIN dependent_records d ON d.id = c.dependent_record_id ORDER BY c.created_at DESC, c.id DESC`).all();
  res.json({ corrections, summary: correctionSummary() });
});

function correctionSummary() {
  const rows = db.prepare('SELECT status, COUNT(*) AS count FROM correction_logs GROUP BY status').all();
  const summary = { totalIdentified: 0, approved: 0, rejected: 0, verified: 0, failed: 0, pending: 0 };
  const keys = { APPROVED: 'approved', VERIFIED: 'verified', REJECTED: 'rejected', FAILED: 'failed', PENDING: 'pending' };
  for (const row of rows) {
    summary.totalIdentified += row.count;
    if (keys[row.status]) summary[keys[row.status]] += row.count;
    if (row.status === 'VERIFIED' || row.status === 'FAILED') summary.approved += row.count;
  }
  return summary;
}
module.exports = router;
