const express = require('express');
const { db } = require('../database/db');
const router = express.Router();

router.get('/', (req, res) => {
  const count = (sql) => db.prepare(sql).get().count;
  const stats = {
    sourceRecords: count('SELECT COUNT(*) AS count FROM source_records'),
    dependentRecords: count('SELECT COUNT(*) AS count FROM dependent_records'),
    outdatedRecords: count("SELECT COUNT(*) AS count FROM dependent_records WHERE status IN ('OUTDATED', 'REVIEW')"),
    pendingApprovals: count("SELECT COUNT(*) AS count FROM correction_logs WHERE status = 'PENDING'"),
    verifiedCorrections: count("SELECT COUNT(*) AS count FROM correction_logs WHERE status = 'VERIFIED'"),
    failedCorrections: count("SELECT COUNT(*) AS count FROM correction_logs WHERE status = 'FAILED'")
  };
  const recentActivity = db.prepare(`SELECT a.*, s.title AS source_title, d.record_name AS dependent_name
    FROM audit_events a LEFT JOIN source_records s ON s.id = a.source_record_id
    LEFT JOIN dependent_records d ON d.id = a.dependent_record_id ORDER BY a.created_at DESC, a.id DESC LIMIT 8`).all();
  res.json({ stats, recentActivity, systemStatus: stats.failedCorrections ? 'ATTENTION' : stats.pendingApprovals ? 'REVIEW_REQUIRED' : 'OPERATIONAL' });
});
module.exports = router;
