const express = require('express');
const { db, recordAudit } = require('../database/db');
const { createProposals } = require('../services/correctionService');
const router = express.Router();
const text = (value, max = 500) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;

router.get('/', (req, res) => {
  const search = String(req.query.search || '').trim().slice(0, 100);
  const records = search
    ? db.prepare('SELECT * FROM source_records WHERE title LIKE ? OR entity_type LIKE ? OR field_name LIKE ? ORDER BY updated_at DESC').all(`%${search}%`, `%${search}%`, `%${search}%`)
    : db.prepare('SELECT * FROM source_records ORDER BY updated_at DESC').all();
  res.json({ records });
});

router.post('/', (req, res) => {
  const { title, entity_type: entityType, field_name: fieldName, current_value: currentValue } = req.body || {};
  if (!text(title, 160) || !text(entityType, 80) || !text(fieldName, 100) || !text(currentValue)) return res.status(400).json({ error: 'Title, entity type, field name, and current value are required and must be within their length limits.' });
  const now = new Date().toISOString();
  const result = db.prepare(`INSERT INTO source_records (title, entity_type, field_name, current_value, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)`).run(title.trim(), entityType.trim(), fieldName.trim(), currentValue.trim(), now, now);
  const id = Number(result.lastInsertRowid);
  recordAudit({ eventType: 'SOURCE_CREATED', sourceRecordId: id, message: `Source record “${title.trim()}” created.` });
  res.status(201).json({ record: db.prepare('SELECT * FROM source_records WHERE id = ?').get(id) });
});

router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Source record ID must be a positive integer.' });
  const record = db.prepare('SELECT * FROM source_records WHERE id = ?').get(id);
  if (!record) return res.status(404).json({ error: 'Source record not found.' });
  const dependents = db.prepare('SELECT * FROM dependent_records WHERE source_record_id = ? ORDER BY id').all(id);
  res.json({ record, dependents });
});

router.patch('/:id/value', (req, res) => {
  const id = Number(req.params.id);
  const newValue = req.body && req.body.current_value;
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Source record ID must be a positive integer.' });
  if (!text(newValue)) return res.status(400).json({ error: 'A new current_value between 1 and 500 characters is required.' });
  const source = db.prepare('SELECT * FROM source_records WHERE id = ?').get(id);
  if (!source) return res.status(404).json({ error: 'Source record not found.' });
  if (source.current_value === newValue.trim()) return res.status(400).json({ error: 'The new value must differ from the current value.' });
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare('UPDATE source_records SET previous_value = current_value, current_value = ?, version = version + 1, updated_at = ? WHERE id = ?').run(newValue.trim(), now, id);
    recordAudit({ eventType: 'SOURCE_CORRECTED', sourceRecordId: id, message: `Source value changed from “${source.current_value}” to “${newValue.trim()}”.`, details: { oldValue: source.current_value, newValue: newValue.trim(), version: source.version + 1 } });
  })();
  try {
    const analysis = createProposals(id);
    res.json({ record: db.prepare('SELECT * FROM source_records WHERE id = ?').get(id), impact: { totalIdentified: analysis.detected, proposals: analysis.corrections } });
  } catch (error) {
    console.error('Impact detection failed:', error.message);
    res.status(500).json({ error: 'The source value was saved, but impact proposals could not be created.' });
  }
});
module.exports = router;
