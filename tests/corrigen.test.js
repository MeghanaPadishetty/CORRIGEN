const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { classifyMatch } = require('../services/impactDetection');

let serverProcess;
let baseUrl;
let tempDirectory;
let stdout = '';
let sessionCookie = '';

test('confidence classification distinguishes exact, normalized, and ambiguous values', () => {
  assert.equal(classifyMatch('15 November 2026', '15 November 2026').level, 'HIGH');
  assert.equal(classifyMatch(' 15   NOVEMBER 2026 ', '15 November 2026').level, 'MEDIUM');
  assert.equal(classifyMatch('14 November 2026', '15 November 2026').level, 'LOW');
});

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(sessionCookie ? { cookie: sessionCookie } : {}), ...(options.headers || {}) }
  });
  const cookie = response.headers.getSetCookie?.()[0] || response.headers.get('set-cookie');
  if (cookie && (pathname === '/api/auth/login' || pathname === '/api/auth/demo')) sessionCookie = cookie.split(';')[0];
  if (pathname === '/api/auth/logout' && response.ok) sessionCookie = '';
  return { status: response.status, body: await response.json() };
}

async function startServer() {
  tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'corrigen-test-'));
  const port = 4100 + Math.floor(Math.random() * 1000);
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), DB_PATH: path.join(tempDirectory, 'test.sqlite') },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  serverProcess.stdout.on('data', (data) => { stdout += data.toString(); });
  serverProcess.stderr.on('data', (data) => { stdout += data.toString(); });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { const response = await fetch(`${baseUrl}/login`); if (response.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Test server did not start: ${stdout}`);
}

test('CORRIGEN end-to-end correction workflow and REST validation', async (t) => {
  await startServer();
  sessionCookie = '';
  t.after(() => {
    serverProcess.kill();
    return once(serverProcess, 'exit').then(() => {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    });
  });

  const loginPage = await fetch(`${baseUrl}/login`);
  assert.equal(loginPage.status, 200);
  assert.match(await loginPage.text(), /Sign In to CORRIGEN/);
  const unauthenticatedPage = await fetch(`${baseUrl}/`, { redirect: 'manual' });
  assert.equal(unauthenticatedPage.status, 302);
  assert.equal(unauthenticatedPage.headers.get('location'), '/login');
  const unauthenticatedHtml = await fetch(`${baseUrl}/index.html`, { redirect: 'manual' });
  assert.equal(unauthenticatedHtml.status, 302);
  assert.equal(unauthenticatedHtml.headers.get('location'), '/login');
  assert.equal((await request('/api/dashboard')).status, 401);
  assert.equal((await request('/api/college/students')).status, 401);
  assert.equal((await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: '', password: '' }) })).status, 400);
  assert.equal((await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'demo@corrigen.com', password: '' }) })).status, 400);
  assert.equal((await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'wrong@corrigen.com', password: 'bad' }) })).status, 401);
  assert.equal((await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'demo@corrigen.com', password: 'wrong' }) })).status, 401);
  const demoAccess = await request('/api/auth/demo', { method: 'POST', body: '{}' });
  assert.equal(demoAccess.status, 200);
  assert.equal(demoAccess.body.user.email, 'demo@corrigen.com');
  assert.equal((await request('/api/auth/session')).status, 200);
  assert.equal((await request('/api/auth/logout', { method: 'POST', body: '{}' })).status, 200);
  assert.equal((await request('/api/dashboard')).status, 401);
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'demo@corrigen.com', password: 'Corrigen@123' }) });
  assert.equal(login.status, 200);
  assert.equal(login.body.authenticated, true);
  assert.ok(sessionCookie.startsWith('corrigen.sid='));
  assert.equal((await request('/api/auth/session')).status, 200);
  const protectedHtml = await fetch(`${baseUrl}/`, { headers: { cookie: sessionCookie } });
  assert.equal(protectedHtml.status, 200);
  assert.match(await protectedHtml.text(), /id="app"/);

  const dashboard = await request('/api/dashboard');
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.body.stats.sourceRecords, 2);
  assert.equal(dashboard.body.stats.dependentRecords, 5);

  const badInput = await request('/api/sources', { method: 'POST', body: JSON.stringify({ title: '' }) });
  assert.equal(badInput.status, 400);
  const created = await request('/api/sources', { method: 'POST', body: JSON.stringify({ title: 'Test source', entity_type: 'Test', field_name: 'Status', current_value: 'Old' }) });
  assert.equal(created.status, 201);
  assert.equal(created.body.record.version, 1);

  const sourceId = dashboard.body.stats.sourceRecords ? (await request('/api/sources?search=Semester%20Examination')).body.records[0].id : null;
  const sourceDetail = await request(`/api/sources/${sourceId}`);
  assert.equal(sourceDetail.status, 200);
  assert.equal(sourceDetail.body.dependents.length, 4);

  const corrected = await request(`/api/sources/${sourceId}/value`, { method: 'PATCH', body: JSON.stringify({ current_value: '18 November 2026' }) });
  assert.equal(corrected.status, 200);
  assert.equal(corrected.body.record.previous_value, '15 November 2026');
  assert.equal(corrected.body.record.version, 2);
  assert.equal(corrected.body.impact.totalIdentified, 4);

  const impact = await request(`/api/impact?sourceId=${sourceId}`);
  assert.equal(impact.body.corrections.length, 4);
  assert.equal(impact.body.corrections.filter((item) => item.confidence_level === 'HIGH').length, 3);
  const rerun = await request('/api/impact/run', { method: 'POST', body: JSON.stringify({ source_id: sourceId }) });
  assert.equal(rerun.status, 200);
  assert.equal(rerun.body.totalIdentified, 4);
  assert.equal((await request('/api/corrections?status=PENDING')).body.corrections.length, 4);
  const lowConfidence = impact.body.corrections.find((item) => item.confidence_level === 'LOW');
  assert.ok(lowConfidence);
  const unrelated = (await request('/api/dependents')).body.records.find((item) => item.record_name === 'Library Reminder');
  assert.equal(unrelated.stored_value, '20 November 2026');

  const rejected = await request(`/api/corrections/${lowConfidence.id}/reject`, { method: 'POST', body: JSON.stringify({ rejected_by: 'Project Reviewer' }) });
  assert.equal(rejected.body.correction.status, 'REJECTED');
  const stillOld = (await request('/api/dependents')).body.records.find((item) => item.record_name === 'Eligibility Report');
  assert.equal(stillOld.stored_value, '14 November 2026');
  const afterRejection = await request('/api/impact/run', { method: 'POST', body: JSON.stringify({ source_id: sourceId }) });
  assert.equal(afterRejection.body.totalIdentified, 3);

  for (const proposal of impact.body.corrections.filter((item) => item.confidence_level === 'HIGH')) {
    const approved = await request(`/api/corrections/${proposal.id}/approve`, { method: 'POST', body: JSON.stringify({ approved_by: 'Project Reviewer' }) });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.correction.status, 'VERIFIED');
  }
  const verification = await request('/api/verification/run', { method: 'POST', body: '{}' });
  assert.equal(verification.status, 200);
  assert.equal(verification.body.summary.approved, 3);
  assert.equal(verification.body.summary.verified, 3);
  assert.equal(verification.body.summary.rejected, 1);

  const audit = await request('/api/audit');
  const eventTypes = audit.body.events.map((event) => event.event_type);
  assert.ok(eventTypes.includes('SOURCE_CORRECTED'));
  assert.ok(eventTypes.includes('CORRECTION_PROPOSED'));
  assert.ok(eventTypes.includes('CORRECTION_APPROVED'));
  assert.ok(eventTypes.includes('CORRECTION_REJECTED'));
  assert.ok(eventTypes.includes('PROPAGATION_COMPLETED'));
  assert.ok(eventTypes.includes('VERIFICATION_PASSED'));

  const students = await request('/api/college/students');
  assert.equal(students.status, 200);
  assert.ok(students.body.students.length >= 10);
  const targetId = 'SWEC2025CSE042';
  const targetBefore = await request(`/api/college/students/${targetId}`);
  assert.equal(targetBefore.body.student.student_name, 'Ananya Sharma');
  assert.equal(targetBefore.body.records.length, 9);
  assert.equal(targetBefore.body.student.phone, '+91 90000 10042');
  for (const record of targetBefore.body.records) {
    assert.equal(record.student_id, targetId);
    assert.equal(record.data.student_id, targetId);
    assert.equal(record.data.student_name, 'Ananya Sharma');
  }

  const duplicateNameBefore = await request('/api/college/students/SWEC2024CSE077');
  assert.equal(duplicateNameBefore.body.student.student_name, 'Ananya Sharma');
  assert.notEqual(duplicateNameBefore.body.student.student_id, targetId);
  const nameChange = await request(`/api/college/students/${targetId}/name`, {
    method: 'PATCH', body: JSON.stringify({ student_name: 'Ananya S.' })
  });
  assert.equal(nameChange.status, 200);
  assert.equal(nameChange.body.report.run.old_name, 'Ananya Sharma');
  assert.equal(nameChange.body.report.run.new_name, 'Ananya S.');
  assert.equal(nameChange.body.report.summary.recordsChecked, 10);
  assert.equal(nameChange.body.report.summary.dependentRecordsChecked, 9);
  assert.equal(nameChange.body.report.summary.outdatedRecords, 9);
  assert.equal(nameChange.body.report.summary.consistentRecords, 1);
  assert.equal(nameChange.body.report.proposals.length, 9);
  assert.ok(nameChange.body.report.findings.some((finding) => finding.error_description.includes('STUDENT NAME MISMATCH DETECTED')));
  const attendanceComparison = nameChange.body.report.findings.find((finding) => finding.module_key === 'attendance_record').field_comparisons.find((field) => field.field === 'attendance_percentage');
  const marksComparison = nameChange.body.report.findings.find((finding) => finding.module_key === 'internal_marks').field_comparisons.find((field) => field.field === 'midterm_one');
  const feeComparison = nameChange.body.report.findings.find((finding) => finding.module_key === 'fee_records').field_comparisons.find((field) => field.field === 'balance');
  const rollNumberComparison = nameChange.body.report.findings.find((finding) => finding.module_key === 'student_profile').field_comparisons.find((field) => field.field === 'roll_number');
  assert.deepEqual([attendanceComparison.before, attendanceComparison.current, attendanceComparison.unchanged], [82, 82, true]);
  assert.equal(marksComparison.unchanged, true);
  assert.equal(feeComparison.unchanged, true);
  assert.deepEqual([rollNumberComparison.before, rollNumberComparison.current, rollNumberComparison.unchanged], ['25CSE042', '25CSE042', true]);

  const studentRunId = nameChange.body.runId;
  const proposals = nameChange.body.report.proposals;
  const rejectedProposal = proposals.find((proposal) => proposal.field_name === 'student_name' && proposal.college_record_id === targetBefore.body.records.find((record) => record.module_key === 'hall_ticket').id);
  assert.ok(rejectedProposal);
  const rejection = await request(`/api/college/proposals/${rejectedProposal.id}/reject`, { method: 'POST', body: JSON.stringify({ reviewer: 'College Admin' }) });
  assert.equal(rejection.body.proposal.status, 'REJECTED');
  const approvalTargets = proposals.filter((proposal) => proposal.id !== rejectedProposal.id).slice(0, 4);
  for (const proposal of approvalTargets) {
    const approval = await request(`/api/college/proposals/${proposal.id}/approve`, { method: 'POST', body: JSON.stringify({ reviewer: 'College Admin' }) });
    assert.equal(approval.body.proposal.status, 'APPROVED');
  }
  const beforePropagation = await request(`/api/college/students/${targetId}`);
  assert.ok(beforePropagation.body.records.every((record) => record.data.student_name === 'Ananya Sharma'));
  const propagated = await request(`/api/college/runs/${studentRunId}/propagate`, { method: 'POST', body: '{}' });
  assert.equal(propagated.status, 200);
  assert.equal(propagated.body.report.summary.verifiedCorrections, 4, JSON.stringify(propagated.body.results));
  assert.equal(propagated.body.report.summary.rejectedCorrections, 1);
  assert.equal(propagated.body.report.summary.pendingCorrections, 4);
  const targetAfter = await request(`/api/college/students/${targetId}`);
  const originalById = new Map(targetBefore.body.records.map((record) => [record.id, record.data]));
  const currentByKey = new Map(targetAfter.body.records.map((record) => [record.module_key, record]));
  for (const record of targetAfter.body.records) {
    const oldData = originalById.get(record.id);
    for (const key of Object.keys(oldData)) {
      if (key !== 'student_name') assert.deepEqual(record.data[key], oldData[key], `${record.module_name}.${key} should be preserved`);
    }
  }
  for (const proposal of approvalTargets) {
    const original = targetBefore.body.records.find((record) => record.id === proposal.college_record_id);
    assert.equal(currentByKey.get(original.module_key).data.student_name, 'Ananya S.');
  }
  assert.equal(currentByKey.get('hall_ticket').data.student_name, 'Ananya Sharma');
  const duplicateNameAfter = await request('/api/college/students/SWEC2024CSE077');
  assert.deepEqual(duplicateNameAfter.body.student, duplicateNameBefore.body.student);
  assert.ok(duplicateNameAfter.body.records.every((record) => record.data.student_name === 'Ananya Sharma'));

  const departmentChange = await request(`/api/college/students/${targetId}/attributes/department`, {
    method: 'PATCH', body: JSON.stringify({ value: 'Computer Science and Engineering' })
  });
  assert.equal(departmentChange.status, 200);
  assert.equal(departmentChange.body.report.run.field_name, 'department');
  assert.equal(departmentChange.body.report.proposals.length, 1);
  const departmentProposal = departmentChange.body.report.proposals[0];
  assert.equal(departmentProposal.module_key, 'department_student_records');
  await request(`/api/college/proposals/${departmentProposal.id}/approve`, { method: 'POST', body: JSON.stringify({ reviewer: 'College Admin' }) });
  const departmentPropagation = await request(`/api/college/runs/${departmentChange.body.runId}/propagate`, { method: 'POST', body: JSON.stringify({}) });
  assert.equal(departmentPropagation.body.report.summary.verifiedCorrections, 1);
  const departmentAfter = await request(`/api/college/students/${targetId}`);
  assert.equal(departmentAfter.body.student.department, 'Computer Science and Engineering');
  assert.equal(departmentAfter.body.records.find((record) => record.module_key === 'department_student_records').data.department, 'Computer Science and Engineering');
  assert.equal(departmentAfter.body.records.find((record) => record.module_key === 'attendance_record').data.attendance_percentage, 82);

  const staleRun = await request(`/api/college/students/${targetId}/name`, { method: 'PATCH', body: JSON.stringify({ student_name: 'Ananya Sharma' }) });
  const staleProposal = staleRun.body.report.proposals[0];
  await request(`/api/college/proposals/${staleProposal.id}/approve`, { method: 'POST', body: JSON.stringify({ reviewer: 'College Admin' }) });
  await request(`/api/college/students/${targetId}/name`, { method: 'PATCH', body: JSON.stringify({ student_name: 'Ananya S. Final' }) });
  const stalePropagation = await request(`/api/college/runs/${staleRun.body.runId}/propagate`, { method: 'POST', body: JSON.stringify({}) });
  assert.equal(stalePropagation.body.results[0].status, 'FAILED');
  const invalidAttribute = await request(`/api/college/students/${targetId}/attributes/not_a_registered_column`, { method: 'PATCH', body: JSON.stringify({ value: 'x' }) });
  assert.equal(invalidAttribute.status, 400);

  const studentAudit = await request(`/api/college/students/${targetId}/audit`);
  const studentEventTypes = studentAudit.body.events.map((event) => event.event_type);
  assert.ok(studentEventTypes.includes('MANUAL_SOURCE_ATTRIBUTE_CHANGED'));
  assert.ok(studentEventTypes.includes('CORRECTION_PROPOSED'));
  assert.ok(studentEventTypes.includes('CORRECTION_APPROVED'));
  assert.ok(studentEventTypes.includes('CORRECTION_REJECTED'));
  assert.ok(studentEventTypes.includes('PROPAGATION_COMPLETED'));
  assert.ok(studentEventTypes.includes('VERIFICATION_PASSED'));
  assert.ok(studentEventTypes.includes('PROPAGATION_FAILED'));

  const logout = await request('/api/auth/logout', { method: 'POST', body: '{}' });
  assert.equal(logout.status, 200);
  assert.equal(logout.body.authenticated, false);
  assert.equal((await request('/api/dashboard')).status, 401);
  const afterLogoutPage = await fetch(`${baseUrl}/`, { redirect: 'manual' });
  assert.equal(afterLogoutPage.status, 302);
  assert.equal(afterLogoutPage.headers.get('location'), '/login');
});
