const express = require('express');
const {
  createNameChangeRun,
  getRunReport,
  getStudentDetail,
  getStudentList,
  createAttributeChangeRun,
  decideProposal,
  propagateApproved,
  verifyRun,
  getStudentAudit
} = require('../services/collegeCorrectionService');

const router = express.Router();
const validStudentId = (value) => typeof value === 'string' && /^[A-Za-z0-9-]{1,40}$/.test(value.trim());

router.get('/students', (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search : '';
  res.json({ students: getStudentList(search) });
});

router.get('/students/:studentId', (req, res) => {
  if (!validStudentId(req.params.studentId)) return res.status(400).json({ error: 'A valid Student ID is required.' });
  const detail = getStudentDetail(req.params.studentId.trim());
  return detail ? res.json(detail) : res.status(404).json({ error: 'Student ID not found.' });
});

router.patch('/students/:studentId/name', (req, res) => {
  if (!validStudentId(req.params.studentId)) return res.status(400).json({ error: 'A valid Student ID is required.' });
  const name = req.body && req.body.student_name;
  if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 160) {
    return res.status(400).json({ error: 'student_name is required and must be 1–160 characters.' });
  }
  const result = createNameChangeRun(req.params.studentId.trim(), name);
  return result.error ? res.status(result.status).json({ error: result.error }) : res.json(result);
});

router.patch('/students/:studentId/attributes/:fieldName', (req, res) => {
  if (!validStudentId(req.params.studentId)) return res.status(400).json({ error: 'A valid Student ID is required.' });
  const value = req.body && req.body.value;
  if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 160) {
    return res.status(400).json({ error: 'value is required and must be 1–160 characters.' });
  }
  const result = createAttributeChangeRun(req.params.studentId.trim(), req.params.fieldName, value);
  return result.error ? res.status(result.status).json({ error: result.error }) : res.json(result);
});

router.get('/runs/:runId/report', (req, res) => {
  const runId = Number(req.params.runId);
  if (!Number.isSafeInteger(runId) || runId < 1) return res.status(400).json({ error: 'Run ID must be a positive integer.' });
  const report = getRunReport(runId);
  return report ? res.json(report) : res.status(404).json({ error: 'Name-change test run not found.' });
});

router.post('/runs/:runId/verify', (req, res) => {
  const runId = Number(req.params.runId);
  if (!Number.isSafeInteger(runId) || runId < 1) return res.status(400).json({ error: 'Run ID must be a positive integer.' });
  const report = verifyRun(runId);
  return report ? res.json({ report }) : res.status(404).json({ error: 'Name-change test run not found.' });
});

router.post('/runs/:runId/propagate', (req, res) => {
  const runId = Number(req.params.runId);
  if (!Number.isSafeInteger(runId) || runId < 1) return res.status(400).json({ error: 'Run ID must be a positive integer.' });
  const result = propagateApproved(runId);
  return result ? res.json(result) : res.status(404).json({ error: 'Name-change test run not found.' });
});

router.post('/proposals/:proposalId/:decision', (req, res) => {
  const proposalId = Number(req.params.proposalId);
  const decision = req.params.decision;
  const reviewer = req.body && req.body.reviewer;
  if (!Number.isSafeInteger(proposalId) || proposalId < 1) return res.status(400).json({ error: 'Proposal ID must be a positive integer.' });
  if (!['approve', 'reject'].includes(decision)) return res.status(404).json({ error: 'Decision must be approve or reject.' });
  if (typeof reviewer !== 'string' || !reviewer.trim() || reviewer.trim().length > 100) return res.status(400).json({ error: 'reviewer is required and must not exceed 100 characters.' });
  const result = decideProposal(proposalId, reviewer.trim(), decision);
  return result.error ? res.status(result.status).json({ error: result.error }) : res.json(result);
});

router.get('/students/:studentId/audit', (req, res) => {
  if (!validStudentId(req.params.studentId)) return res.status(400).json({ error: 'A valid Student ID is required.' });
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 250);
  res.json({ events: getStudentAudit(req.params.studentId.trim(), limit) });
});

module.exports = router;
