const express = require('express');
const { db, recordAudit } = require('../database/db');
const router = express.Router();
const validText = (value, max = 500) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;

router.get('/', (req, res) => {
  const conditions = [];
  const values = [];
  if (req.query.sourceId !== undefined) {
    const sourceId = Number(req.query.sourceId);
    if (!Number.isSafeInteger(sourceId) || sourceId < 1) return res.status(400).json({ error: 'sourceId must be a positive integer.' });
    conditions.push('d.source_record_id = ?'); values.push(sourceId);
  }
  if (req.query.status) { conditions.push('d.status = ?'); values.push(String(req.query.status).slice(0, 20).toUpperCase()); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const records = db.prepare(`SELECT d.*, s.title AS source_title FROM dependent_records d JOIN source_records s ON s.id = d.source_record_id ${where} ORDER BY d.last_updated DESC`).all(...values);
  res.json({ records });
});

router.post('/', (req, res) => {
  const body = req.body || {};
  const sourceId = Number(body.source_record_id);
  if (!validText(body.record_name, 160) || !validText(body.record_type, 100) || !validText(body.field_name, 100) || !validText(body.stored_value) || !Number.isSafeInteger(sourceId) || sourceId < 1) return res.status(400).json({ error: 'Record name, type, field, stored value, and a valid source_record_id are required.' });
  if (!db.prepare('SELECT id FROM source_records WHERE id = ?').get(sourceId)) return res.status(400).json({ error: 'The selected source record does not exist.' });
  const now = new Date().toISOString();
  const result = db.prepare(`INSERT INTO dependent_records (record_name, record_type, source_record_id, field_name, stored_value, status, last_updated, created_at)
    VALUES (?, ?, ?, ?, ?, 'CURRENT', ?, ?)`).run(body.record_name.trim(), body.record_type.trim(), sourceId, body.field_name.trim(), body.stored_value.trim(), now, now);
  const id = Number(result.lastInsertRowid);
  recordAudit({ eventType: 'DEPENDENT_REGISTERED', sourceRecordId: sourceId, dependentRecordId: id, message: `Dependent record “${body.record_name.trim()}” registered.` });
  res.status(201).json({ record: db.prepare('SELECT * FROM dependent_records WHERE id = ?').get(id) });
});
module.exports = router;
