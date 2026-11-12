const express = require('express');
const { db } = require('../database/db');
const router = express.Router();

router.get('/', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 250);
  const events = db.prepare(`SELECT a.*, s.title AS source_title, d.record_name AS dependent_name
    FROM audit_events a LEFT JOIN source_records s ON s.id = a.source_record_id
    LEFT JOIN dependent_records d ON d.id = a.dependent_record_id ORDER BY a.created_at DESC, a.id DESC LIMIT ?`).all(limit);
  res.json({ events });
});
module.exports = router;
