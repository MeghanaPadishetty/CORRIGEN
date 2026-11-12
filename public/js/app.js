(() => {
  const api = window.CorrigenAPI;
  const root = document.getElementById('app');
  const modal = document.getElementById('modal');
  const titles = { dashboard: 'Dashboard', sources: 'Source Records', dependents: 'Dependent Records', students: 'Student Testing', impact: 'Impact Analysis', approvals: 'Correction Approvals', verification: 'Verification Reports', audit: 'Audit History' };
  let sourceCache = [];
  let dependentCache = [];
  let collegeSearch = 'SWEC2025CSE042';
  let collegeStudentId = '';
  let collegeRunId = null;
  let collegeReportVisible = false;

  const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    fetch('/api/auth/session', { cache: 'no-store', credentials: 'same-origin' })
      .then((response) => { if (!response.ok) window.location.replace('/login'); })
      .catch(() => window.location.replace('/login'));
  });
  const dateTime = (value) => {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return '—';
    return `<time class="technical-value" datetime="${date.toISOString()}">${escapeHtml(date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))}</time>`;
  };
  const statusBadge = (value) => `<span class="status-badge badge-${escapeHtml(String(value).toLowerCase())}">${escapeHtml(value)}</span>`;
  const pageHeading = (eyebrow, title, description, actions = '') => `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${description}</p></div><div class="heading-actions">${actions}</div></div>`;
  const empty = (icon, title, detail) => `<div class="empty-state"><div class="empty-icon">${icon}</div><strong>${title}</strong><p>${detail}</p></div>`;
  function toast(message, error = false) {
    const item = document.createElement('div'); item.className = `toast${error ? ' error' : ''}`; item.textContent = message;
    document.getElementById('toast-region').append(item); setTimeout(() => item.remove(), 3500);
  }
  async function logout(button) {
    button.disabled = true;
    try {
      await api.post('/auth/logout');
      window.location.replace('/login');
    } catch (error) {
      button.disabled = false;
      toast(error.message, true);
    }
  }
  async function renderPage() {
    const page = location.hash.slice(1) || 'dashboard';
    if (!titles[page]) { location.hash = '#dashboard'; return; }
    document.querySelectorAll('.navigation a').forEach((link) => {
      const active = link.dataset.page === page;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    document.getElementById('breadcrumb-page').textContent = titles[page];
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('menu-toggle').setAttribute('aria-expanded', 'false');
    root.setAttribute('aria-busy', 'true');
    root.innerHTML = '<div class="loading-state"><span class="spinner"></span>Loading workspace data…</div>';
    try {
      if (page === 'dashboard') await renderDashboard();
      else if (page === 'sources') await renderSources();
      else if (page === 'dependents') await renderDependents();
      else if (page === 'students') await renderStudentTesting();
      else if (page === 'impact') await renderCorrections('impact');
      else if (page === 'approvals') await renderCorrections('approvals');
      else if (page === 'verification') await renderVerification();
      else await renderAudit();
    } catch (error) {
      root.innerHTML = `${empty('!', 'Could not load this view', escapeHtml(error.message))}<div class="heading-actions" style="justify-content:center"><button class="btn btn-primary" data-action="retry-page">Try again</button></div>`;
    } finally { root.setAttribute('aria-busy', 'false'); }
  }
  async function renderDashboard() {
    const [{ stats, recentActivity, systemStatus }, sourceData, dependentData, correctionData] = await Promise.all([
      api.get('/dashboard'), api.get('/sources'), api.get('/dependents'), api.get('/corrections')
    ]);
    sourceCache = sourceData.records;
    dependentCache = dependentData.records;
    document.getElementById('pending-count').textContent = stats.pendingApprovals;
    const systemStatusElement = document.getElementById('system-status');
    const statusLabels = { OPERATIONAL: 'SYSTEM OPERATIONAL', REVIEW_REQUIRED: 'REVIEW REQUIRED', ATTENTION: 'ATTENTION REQUIRED' };
    systemStatusElement.className = `environment-pill${systemStatus === 'REVIEW_REQUIRED' ? ' needs-review' : systemStatus === 'ATTENTION' ? ' attention' : ''}`;
    systemStatusElement.innerHTML = `<i aria-hidden="true"></i> ${statusLabels[systemStatus] || 'SYSTEM STATUS UNKNOWN'}`;
    const metrics = [
      ['Source records', stats.sourceRecords, 'Registered authoritative records', '◈', ''],
      ['Dependent records', stats.dependentRecords, 'Linked records monitored', '▤', 'green'],
      ['Outdated records', stats.outdatedRecords, 'Require review or propagation', '⌁', 'orange'],
      ['Pending approvals', stats.pendingApprovals, 'Waiting for human decision', '✓', ''],
      ['Verified corrections', stats.verifiedCorrections, 'Read-back checks passed', '◎', 'green'],
      ['Failed corrections', stats.failedCorrections, 'Need investigation', '!', 'red']
    ];
    const activity = recentActivity.length ? recentActivity.map((item) => `<div class="activity-item"><div class="activity-mark ${item.event_type.includes('PASSED') || item.event_type.includes('COMPLETED') ? 'success' : item.event_type.includes('FAILED') || item.event_type.includes('REJECTED') ? 'warning' : ''}">${eventIcon(item.event_type)}</div><div class="activity-copy"><strong>${escapeHtml(item.message)}</strong><small>${escapeHtml(item.source_title || 'CORRIGEN system')}${item.dependent_name ? ` · ${escapeHtml(item.dependent_name)}` : ''}</small></div><div class="activity-time">${dateTime(item.created_at)}</div></div>`).join('') : empty('◷', 'No activity yet', 'Events appear here as records are created and corrected.');
    const integrityMap = buildIntegrityMap(sourceData.records, dependentData.records, correctionData.corrections);
    root.innerHTML = `${pageHeading('INFORMATION INTEGRITY / LIVE LINEAGE', 'Correction operations', 'Follow authoritative information as it moves through registered records—and see when every change is verified.', '<button class="btn btn-primary" data-action="open-demo">Run demo correction</button>')}<section class="integrity-map-panel" aria-labelledby="integrity-map-heading"><div class="integrity-map-head"><div><div class="map-overline"><span class="map-live-dot"></span> LIVE RECORD LINEAGE</div><h2 id="integrity-map-heading">Information Integrity Map</h2><p>Authoritative sources flow into their registered dependent records.</p></div><div class="map-count"><strong>${sourceData.records.length}</strong><span>sources</span><i>·</i><strong>${dependentData.records.length}</strong><span>connections</span></div></div>${integrityMap}<div class="map-legend" aria-label="Map status legend"><span><i class="legend-dot current"></i>Current</span><span><i class="legend-dot outdated"></i>Detected / outdated</span><span><i class="legend-dot pending"></i>Pending review</span><span><i class="legend-dot approved"></i>Approved</span><span><i class="legend-dot verified"></i>Verified</span><span><i class="legend-dot rejected"></i>Rejected / unchanged</span><span><i class="legend-dot failed"></i>Failed</span></div></section><div class="metrics-grid">${metrics.map(([label, value, note, icon, tone]) => `<article class="metric-card"><div class="metric-top">${label}<span class="metric-icon ${tone}">${icon}</span></div><div class="metric-value">${value}</div><div class="metric-foot">${note}</div></article>`).join('')}</div><div class="dashboard-grid"><section class="panel"><div class="panel-heading"><div><h2>Recent activity</h2><p>Auditable events across your workspace</p></div><a class="text-link" href="#audit">View audit history →</a></div><div class="activity-list">${activity}</div></section><aside class="panel"><div class="panel-heading"><div><h2>System health</h2><p>Live status from the correction queue</p></div></div><div class="status-summary"><div class="status-ring">${systemStatus === 'OPERATIONAL' ? '✓' : '!'}</div><div><strong>${systemStatus === 'OPERATIONAL' ? 'All systems operational' : systemStatus === 'ATTENTION' ? 'Attention required' : 'Review required'}</strong><small>Local database · API connected</small></div></div><div class="status-row"><span>Pending review</span><strong>${stats.pendingApprovals}</strong></div><div class="status-row"><span>Verified to source</span><strong>${stats.verifiedCorrections}</strong></div><div class="status-row"><span>Failed checks</span><strong>${stats.failedCorrections}</strong></div><div class="callout">CORRIGEN analyzes registered dependent records only. Every proposed update requires a human decision.</div></aside></div>`;
  }
  function buildIntegrityMap(sources, dependents, corrections) {
    if (!sources.length) return `<div class="integrity-map-empty"><strong>No source records registered yet.</strong><a href="#sources">Create the first source record →</a></div>`;
    const latestByDependent = new Map();
    for (const correction of corrections) if (!latestByDependent.has(correction.dependent_record_id)) latestByDependent.set(correction.dependent_record_id, correction);
    const groups = sources.map((source) => ({ source, dependents: dependents.filter((item) => item.source_record_id === source.id) }));
    const groupHeights = groups.map((group) => Math.max(108, group.dependents.length * 82));
    const height = Math.max(230, 46 + groupHeights.reduce((sum, item) => sum + item, 0) + Math.max(0, groups.length - 1) * 24);
    const nodeState = (record) => {
      const correction = latestByDependent.get(record.id);
      if (correction) {
        if (correction.status === 'PENDING' && correction.confidence_level === 'LOW') return { key: 'review', label: 'LOW · REVIEW', correction };
        if (correction.status === 'PENDING' && record.status === 'OUTDATED') return { key: 'pending', label: 'OUTDATED · PENDING', correction };
        if (correction.status === 'PENDING' && record.status === 'REVIEW') return { key: 'review', label: 'REVIEW · PENDING', correction };
        return { key: correction.status.toLowerCase(), label: correction.status, correction };
      }
      if (record.status === 'OUTDATED') return { key: 'outdated', label: 'OUTDATED' };
      if (record.status === 'REVIEW') return { key: 'review', label: 'NEEDS REVIEW' };
      return { key: 'current', label: 'CURRENT' };
    };
    const shorten = (value, limit = 36) => {
      const text = String(value || '');
      return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
    };
    let cursorY = 46;
    const edges = [];
    const sourceNodes = [];
    const dependentNodes = [];
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const { source, dependents: children } = groups[groupIndex];
      const groupHeight = groupHeights[groupIndex];
      const sourceY = cursorY + groupHeight / 2;
      const sourceTop = sourceY - 34;
      sourceNodes.push(`<g class="integrity-node source-node"><title>${escapeHtml(source.title)} · ${escapeHtml(source.field_name)}: ${escapeHtml(source.current_value)}</title><rect x="46" y="${sourceTop}" width="292" height="68" rx="12"/><circle class="node-index" cx="317" cy="${sourceTop + 19}" r="9"/><text class="node-index-text" x="317" y="${sourceTop + 22}" text-anchor="middle">S${groupIndex + 1}</text><text class="node-kicker" x="62" y="${sourceTop + 22}">AUTHORITATIVE · V${source.version}</text><text class="node-title" x="62" y="${sourceTop + 43}">${escapeHtml(shorten(source.title, 31))}</text><text class="node-value" x="62" y="${sourceTop + 58}">${escapeHtml(shorten(`${source.field_name}: ${source.current_value}`, 40))}</text></g>`);
      if (!children.length) dependentNodes.push(`<text class="map-empty-label" x="662" y="${sourceY + 4}">No registered dependents linked to this source</text>`);
      children.forEach((dependent, childIndex) => {
        const dependentTop = cursorY + childIndex * 82 + 12;
        const dependentY = dependentTop + 29;
        const state = nodeState(dependent);
        const correction = state.correction;
        const detectedOutdated = Boolean(correction && correction.status === 'PENDING' && dependent.status === 'OUTDATED');
        const fromValue = correction && correction.status !== 'PENDING' ? correction.old_value : dependent.stored_value;
        const newValue = correction ? correction.new_value : source.current_value;
        const path = `M 338 ${sourceY} C 454 ${sourceY}, 532 ${dependentY}, 650 ${dependentY}`;
        const edgeState = state.key === 'verified' ? 'verified' : state.key === 'failed' ? 'failed' : state.key === 'rejected' ? 'rejected' : state.key === 'pending' || state.key === 'review' ? 'pending' : state.key === 'approved' ? 'approved' : state.key === 'outdated' ? 'outdated' : 'current';
        const detectionClass = detectedOutdated ? ' edge-detected' : '';
        edges.push(`<path class="integrity-edge edge-${edgeState}${detectionClass}" d="${path}"/>${edgeState === 'pending' ? `<circle class="lineage-pulse" r="3.5"><animateMotion dur="3.6s" repeatCount="indefinite" path="${path}"/></circle>` : ''}`);
        dependentNodes.push(`<g class="integrity-node dependent-node state-${state.key}${detectedOutdated ? ' state-detected' : ''}"><title>${escapeHtml(dependent.record_name)} · ${escapeHtml(state.label)} · ${escapeHtml(fromValue)} → ${escapeHtml(newValue)}</title><rect x="650" y="${dependentTop}" width="340" height="58" rx="11"/><circle class="state-indicator" cx="669" cy="${dependentTop + 20}" r="4"/><text class="node-title" x="682" y="${dependentTop + 23}">${escapeHtml(shorten(dependent.record_name, 34))}</text><text class="node-value" x="666" y="${dependentTop + 43}">${escapeHtml(shorten(`${dependent.field_name}: ${fromValue} → ${newValue}`, 48))}</text><text class="node-status" x="973" y="${dependentTop + 23}" text-anchor="end">${escapeHtml(shorten(state.label, 22))}</text></g>`);
      });
      cursorY += groupHeight + 24;
    }
    const mapDescription = `${sources.length} authoritative sources connect to ${dependents.length} registered dependent records. Statuses reflect the latest stored correction records.`;
    return `<div class="integrity-map-scroll"><svg class="integrity-map-svg" viewBox="0 0 1036 ${height}" role="img" aria-labelledby="integrity-svg-title integrity-svg-desc"><title id="integrity-svg-title">CORRIGEN information lineage</title><desc id="integrity-svg-desc">${escapeHtml(mapDescription)}</desc><defs><pattern id="integrity-grid" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#8ac9ff" fill-opacity=".12"/></pattern></defs><rect class="map-grid" x="0" y="0" width="1036" height="${height}" fill="url(#integrity-grid)"/>${edges.join('')}${sourceNodes.join('')}${dependentNodes.join('')}</svg></div>`;
  }
  function eventIcon(type) { return ({ SOURCE_CORRECTED: '↗', CORRECTION_PROPOSED: '⌁', CORRECTION_APPROVED: '✓', CORRECTION_REJECTED: '×', PROPAGATION_COMPLETED: '→', VERIFICATION_PASSED: '◎', VERIFICATION_FAILED: '!', SOURCE_CREATED: '+', DEPENDENT_REGISTERED: '+' })[type] || '•'; }
  function sourceRows(records) {
    return records.map((record) => `<tr><td><div class="cell-title">${escapeHtml(record.title)}</div><div class="cell-sub">${escapeHtml(record.entity_type)} · <span class="technical-value">v${record.version}</span></div></td><td>${escapeHtml(record.field_name)}</td><td><strong>${escapeHtml(record.current_value)}</strong><div class="cell-sub">${record.previous_value ? `Previous: ${escapeHtml(record.previous_value)}` : 'Original value'}</div></td><td>${dateTime(record.updated_at)}</td><td><button class="small-action" data-action="source-detail" data-id="${record.id}">View / correct →</button></td></tr>`).join('') || `<tr><td colspan="5">${empty('◈', 'No source records found', 'Try another search or add your first source record.')}</td></tr>`;
  }
  async function renderSources(search = '') {
    const data = await api.get(`/sources${search ? `?search=${encodeURIComponent(search)}` : ''}`); sourceCache = data.records;
    root.innerHTML = `${pageHeading('AUTHORITATIVE DATA', 'Source Records', 'Manage original values and trace every versioned correction.', '<button class="btn btn-primary" data-action="add-source">＋ Add source</button>')}<div class="toolbar"><input id="source-search" class="search-input" aria-label="Search source records" placeholder="Search title, entity, or field…" value="${escapeHtml(search)}"><span id="source-count" class="inline-note">${data.records.length} source record${data.records.length === 1 ? '' : 's'}</span></div><div class="table-card"><div class="table-scroll"><table><thead><tr><th>Source record</th><th>Tracked field</th><th>Current value</th><th>Last updated</th><th>Action</th></tr></thead><tbody id="source-rows">${sourceRows(data.records)}</tbody></table></div></div>`;
    document.getElementById('source-search').addEventListener('input', debounce(async (event) => {
      const query = event.target.value.trim();
      try {
        const results = await api.get(`/sources${query ? `?search=${encodeURIComponent(query)}` : ''}`);
        sourceCache = results.records;
        document.getElementById('source-rows').innerHTML = sourceRows(results.records);
        document.getElementById('source-count').textContent = `${results.records.length} source record${results.records.length === 1 ? '' : 's'}`;
      } catch (error) { toast(error.message, true); }
    }, 250));
  }
  function debounce(callback, delay) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => callback(...args), delay); }; }
  async function renderDependents() {
    const [dependentData, sources] = await Promise.all([api.get('/dependents'), api.get('/sources')]); dependentCache = dependentData.records; sourceCache = sources.records;
    const rows = dependentCache.map((record) => `<tr><td><div class="cell-title">${escapeHtml(record.record_name)}</div><div class="cell-sub">${escapeHtml(record.record_type)}</div></td><td>${escapeHtml(record.source_title)}<div class="cell-sub">${escapeHtml(record.field_name)}</div></td><td>${escapeHtml(record.stored_value)}</td><td>${statusBadge(record.status)}</td><td>${dateTime(record.last_updated)}</td></tr>`).join('');
    root.innerHTML = `${pageHeading('REGISTERED DEPENDENCIES', 'Dependent Records', 'Only records explicitly linked to a source are evaluated.', '<button class="btn btn-primary" data-action="add-dependent">＋ Register dependent</button>')}<div class="toolbar"><select id="dependent-filter" class="select-input" aria-label="Filter dependent records by status"><option value="ALL">All statuses</option><option value="CURRENT">Current</option><option value="OUTDATED">Outdated</option><option value="REVIEW">Needs review</option></select><span class="inline-note">${dependentCache.length} registered dependent records</span></div><div class="table-card"><div class="table-scroll"><table><thead><tr><th>Dependent record</th><th>Linked source / field</th><th>Stored value</th><th>Status</th><th>Last updated</th></tr></thead><tbody id="dependent-rows">${rows || `<tr><td colspan="5">${empty('▤', 'No dependents registered', 'Register a record and link it to a source.')}</td></tr>`}</tbody></table></div></div>`;
    document.getElementById('dependent-filter').addEventListener('change', (event) => { const filtered = event.target.value === 'ALL' ? dependentCache : dependentCache.filter((item) => item.status === event.target.value); document.getElementById('dependent-rows').innerHTML = filtered.map((record) => `<tr><td><div class="cell-title">${escapeHtml(record.record_name)}</div><div class="cell-sub">${escapeHtml(record.record_type)}</div></td><td>${escapeHtml(record.source_title)}<div class="cell-sub">${escapeHtml(record.field_name)}</div></td><td>${escapeHtml(record.stored_value)}</td><td>${statusBadge(record.status)}</td><td>${dateTime(record.last_updated)}</td></tr>`).join('') || `<tr><td colspan="5">${empty('⌕', 'No records in this status', 'Choose another status filter.')}</td></tr>`; });
  }
  async function renderStudentTesting() {
    const listData = await api.get(`/college/students${collegeSearch ? `?search=${encodeURIComponent(collegeSearch)}` : ''}`);
    const students = listData.students;
    if (!students.length) {
      root.innerHTML = `${pageHeading('COLLEGE DATA / MANUAL CHANGE TEST', 'Student Correction Testing', 'Change an authoritative profile value, inspect linked SQLite records, then review and propagate corrections.')}<section class="panel student-picker"><label for="college-search">Search by Student ID, name, or roll number</label><div class="student-search-row"><input id="college-search" class="search-input" value="${escapeHtml(collegeSearch)}" placeholder="e.g. SWEC2025CSE042"><button class="btn" data-action="search-college-students">Search</button></div>${empty('⌕', 'No students match this search', 'Try a Student ID, student name, or roll number.')}</section>`;
      document.getElementById('college-search').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); collegeSearch = event.currentTarget.value.trim(); renderStudentTesting(); } });
      return;
    }
    if (!collegeStudentId || !students.some((student) => student.student_id === collegeStudentId)) {
      collegeStudentId = students[0].student_id;
      collegeRunId = null;
      collegeReportVisible = true;
    }
    const detail = await api.get(`/college/students/${encodeURIComponent(collegeStudentId)}`);
    if (!collegeRunId && detail.latestReport) collegeRunId = detail.latestReport.run.id;
    const latestReport = detail.latestReport && detail.latestReport.run.id === collegeRunId ? detail.latestReport : null;
    const report = collegeReportVisible ? latestReport : null;
    const student = detail.student;
    const profileRows = [
      ['College', student.college_name], ['Student ID', student.student_id], ['Department', student.department],
      ['Academic year', student.academic_year], ['Year', student.year_name], ['Semester', student.semester],
      ['Roll number', student.roll_number], ['Email', student.email], ['Phone', student.phone || '—']
    ].map(([label, value]) => `<div class="student-profile-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
    const recordRows = detail.records.map((record) => {
      const finding = report && report.findings.find((item) => item.record_id === record.id);
      const proposal = report && report.proposals.find((item) => item.college_record_id === record.id);
      const stored = report ? (finding && finding.stored_value) : record.data.student_name;
      const expected = report ? (finding && finding.expected_value) : student.student_name;
      const currentStatus = report ? (finding ? finding.status : 'NEEDS_REVIEW') : 'REGISTERED';
      const values = Object.entries(record.data).filter(([key]) => key !== 'student_name').map(([key, value]) => `${key.replaceAll('_', ' ')}: ${value}`).join(' · ');
      const decision = proposal && proposal.status === 'PENDING'
        ? `<div class="table-actions"><button class="small-action" data-action="college-approve" data-id="${proposal.id}" aria-label="Approve ${escapeHtml(record.module_name)}">Approve</button><button class="small-action reject" data-action="college-reject" data-id="${proposal.id}" aria-label="Reject ${escapeHtml(record.module_name)}">Reject</button></div>`
        : proposal && proposal.status === 'APPROVED' ? '<span class="inline-note">Approved · awaiting propagation</span>' : '—';
      return `<tr><td><div class="cell-title">${escapeHtml(record.module_name)}</div><div class="cell-sub">${escapeHtml(record.module_key)}</div></td><td><span class="technical-value">${escapeHtml(student.student_id)}</span><div class="cell-sub">${escapeHtml(record.record_key)}</div></td><td>${escapeHtml(stored || '—')}</td><td>${escapeHtml(expected || '—')}</td><td>${statusBadge(currentStatus)}</td><td><span class="student-record-context">${escapeHtml(values)}</span></td><td>${decision}</td></tr>`;
    }).join('');
    const reportPanel = report ? renderStudentReport(report, detail.records) : `<section class="panel student-detect-panel"><div><div class="eyebrow">DATABASE COMPARISON</div><h2>${collegeRunId ? 'Ready to detect inconsistencies' : 'Change saved profile, then detect'}</h2><p>${collegeRunId ? 'Run the comparison to read all records linked to this Student ID from SQLite.' : 'Save a manual name change to create a database comparison run.'}</p></div><button class="btn btn-primary" data-action="detect-student" ${collegeRunId ? '' : 'disabled'}>Detect Inconsistencies</button></section>`;
    const auditData = await api.get(`/college/students/${encodeURIComponent(student.student_id)}/audit?limit=100`);
    const auditRows = auditData.events.map((event) => `<tr><td>${escapeHtml(event.event_type.replaceAll('_', ' '))}</td><td>${escapeHtml(event.old_value || '—')}</td><td>${escapeHtml(event.new_value || '—')}</td><td>${escapeHtml(event.message)}</td><td>${dateTime(event.created_at)}</td></tr>`).join('');
    const selectorOptions = students.map((item) => `<option value="${escapeHtml(item.student_id)}" ${item.student_id === student.student_id ? 'selected' : ''}>${escapeHtml(item.student_id)} · ${escapeHtml(item.student_name)} · ${escapeHtml(item.department)}</option>`).join('');
    root.innerHTML = `${pageHeading('COLLEGE DATA / MANUAL CHANGE TEST', 'Student Correction Testing', 'Change an authoritative student attribute, inspect records linked by Student ID, and verify only approved updates.', '')}<section class="panel student-picker"><div class="student-search-row"><div class="student-search-field"><label for="college-search">Search seeded students</label><input id="college-search" class="search-input" value="${escapeHtml(collegeSearch)}" placeholder="Search unique Student ID, name, or roll number"></div><div class="student-select-field"><label for="college-student-picker">Student record</label><select id="college-student-picker" class="select-input">${selectorOptions}</select></div><button class="btn" data-action="load-college-student">Open profile</button></div><p class="inline-note" id="college-student-count">${students.length} matching student record${students.length === 1 ? '' : 's'} · related records are scoped to the selected Student ID.</p></section><section class="panel student-master"><div class="student-master-head"><div><div class="eyebrow">AUTHORITATIVE STUDENT PROFILE</div><h2>${escapeHtml(student.student_name)}</h2><p><span class="technical-value">${escapeHtml(student.student_id)}</span><span class="student-separator">·</span>${escapeHtml(student.department)}<span class="student-separator">·</span>${escapeHtml(student.year_name)} / ${escapeHtml(student.semester)}</p></div><span class="status-badge badge-manually_updated">SOURCE OF TRUTH</span></div><div class="student-profile-grid">${profileRows}</div><form id="student-name-form" class="student-name-form"><div class="form-field"><label for="student-name-input">Manually change authoritative student name</label><input id="student-name-input" class="form-input" name="student_name" maxlength="160" required value="${escapeHtml(student.student_name)}"></div><button class="btn btn-primary" type="submit">Save profile name</button></form></section>${reportPanel}<section class="panel student-records-panel"><div class="panel-heading"><div><h2>Connected college records</h2><p>${detail.records.length} related modules loaded from SQLite for <span class="technical-value">${escapeHtml(student.student_id)}</span></p></div><span class="inline-note">Linked by Student ID</span></div><div class="table-card"><div class="table-scroll"><table><thead><tr><th>Database module</th><th>Student identity</th><th>Stored value</th><th>Expected value</th><th>Status</th><th>Other stored fields</th><th>Decision</th></tr></thead><tbody>${recordRows}</tbody></table></div></div></section><section class="panel student-audit-panel"><div class="panel-heading"><div><h2>Student change audit</h2><p>Source edits, proposals, decisions, propagation and database verification.</p></div></div><div class="table-card"><div class="table-scroll"><table><thead><tr><th>Action</th><th>Old value</th><th>New value</th><th>Audit detail</th><th>Timestamp</th></tr></thead><tbody>${auditRows || `<tr><td colspan="5">${empty('◷', 'No student audit events', 'Actions for this Student ID will be recorded here.')}</td></tr>`}</tbody></table></div></div></section>`;
    const updateStudentOptions = debounce(async (searchValue) => {
      collegeSearch = searchValue;
      try {
        const filtered = await api.get(`/college/students${collegeSearch ? `?search=${encodeURIComponent(collegeSearch)}` : ''}`);
        const select = document.getElementById('college-student-picker');
        if (!select) return;
        select.innerHTML = filtered.students.length
          ? filtered.students.map((item) => `<option value="${escapeHtml(item.student_id)}">${escapeHtml(item.student_id)} · ${escapeHtml(item.student_name)} · ${escapeHtml(item.department)}</option>`).join('')
          : '<option value="">No matching student</option>';
        const count = document.getElementById('college-student-count');
        if (count) count.textContent = `${filtered.students.length} matching student record${filtered.students.length === 1 ? '' : 's'}`;
      } catch (error) { toast(error.message, true); }
    }, 250);
    document.getElementById('college-search').addEventListener('input', (event) => updateStudentOptions(event.target.value.trim()));
    document.getElementById('college-student-picker').addEventListener('change', (event) => {
      collegeStudentId = event.target.value;
      collegeRunId = null;
      collegeReportVisible = true;
      renderStudentTesting();
    });
    document.getElementById('student-name-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = event.currentTarget.querySelector('[type=submit]');
      submit.disabled = true;
      try {
        const result = await api.patch(`/college/students/${encodeURIComponent(student.student_id)}/name`, { student_name: new FormData(event.currentTarget).get('student_name') });
        collegeRunId = result.runId;
        collegeStudentId = student.student_id;
        collegeReportVisible = false;
        toast(`Authoritative profile updated. Test run ${result.runId} saved; detect inconsistencies to review SQLite comparisons.`);
        await renderStudentTesting();
      } catch (error) { toast(error.message, true); }
      finally { submit.disabled = false; }
    });
  }
  async function studentDecision(action, proposalId) {
    const approve = action === 'approve';
    showModal(approve ? 'Approve this correction?' : 'Reject this correction?', approve
      ? 'This records approval only. The record changes only when you explicitly propagate approved corrections.'
      : 'The selected dependent record will remain unchanged.',
    `<div class="confirm-box">${approve ? 'Approved records are queued for the separate propagation step.' : 'The rejected record remains unchanged and is retained in the report.'}</div><div class="form-field"><label>Administrator</label><input class="form-input" name="reviewer" required maxlength="100" value="College Admin"></div>`,
    approve ? 'Record approval' : 'Reject correction', async (form) => {
      const result = await api.post(`/college/proposals/${proposalId}/${action}`, { reviewer: form.get('reviewer') });
      collegeReportVisible = true;
      toast(`Correction ${result.proposal.status.toLowerCase()} for this record.`);
      await renderStudentTesting();
    });
  }
  function renderStudentReport(report, records) {
    const summaryCards = [
      ['Records checked', report.summary.recordsChecked], ['Outdated', report.summary.outdatedRecords],
      ['Consistent', report.summary.consistentRecords], ['Missing / failed', report.summary.failedOrMissingRecords],
      ['Pending', report.summary.pendingCorrections], ['Verified', report.summary.verifiedCorrections]
    ].map(([label, value]) => `<div class="summary-box"><strong>${value}</strong><small>${escapeHtml(label)}</small></div>`).join('');
    const mismatches = report.findings.some((finding) => ['OUTDATED', 'REJECTED', 'FAILED', 'MISSING', 'NEEDS_REVIEW'].includes(finding.status));
    const proposalByRecord = new Map(report.proposals.map((proposal) => [proposal.college_record_id, proposal]));
    const findings = report.findings.map((finding) => {
      const proposal = finding.record_id ? proposalByRecord.get(finding.record_id) : null;
      const decision = proposal && proposal.status === 'PENDING'
        ? `<div class="table-actions"><button class="small-action" data-action="college-approve" data-id="${proposal.id}">Approve</button><button class="small-action reject" data-action="college-reject" data-id="${proposal.id}">Reject</button></div>`
        : proposal && proposal.status === 'APPROVED' ? '<span class="inline-note">Approved · awaiting propagation</span>' : '—';
      const fields = finding.unexpected_changes && finding.unexpected_changes.length
        ? finding.unexpected_changes.map((change) => `${escapeHtml(change.field)} changed`).join(', ')
        : finding.unchanged_fields.length ? `${finding.unchanged_fields.length} other fields unchanged` : '—';
      return `<tr><td><div class="cell-title">${escapeHtml(finding.module_name)}</div><div class="cell-sub">${escapeHtml(finding.module_key)}</div></td><td>${escapeHtml(finding.stored_value ?? 'Missing')}</td><td>${escapeHtml(finding.expected_value ?? report.run.current_value)}</td><td>${statusBadge(finding.status)}</td><td>${escapeHtml(finding.error_description)}</td><td>${escapeHtml(fields)}</td><td>${decision}</td></tr>`;
    }).join('');
    const unchanged = report.unchangedFields.map((field) => `<span class="student-field-chip">${escapeHtml(field.replaceAll('_', ' '))}</span>`).join('');
    const unexpected = report.unexpectedChanges.length ? report.unexpectedChanges.map((change) => `<li><strong>${escapeHtml(change.module_name)} · ${escapeHtml(change.field)}</strong>: ${escapeHtml(JSON.stringify(change.before))} → ${escapeHtml(JSON.stringify(change.current))}</li>`).join('') : '<li>No unrelated field changes detected in the snapshotted records.</li>';
    const fieldComparisons = report.findings.flatMap((finding) => (finding.field_comparisons || []).map((comparison) => ({ module_name: finding.module_name, ...comparison })));
    const fieldComparisonRows = fieldComparisons.map((comparison) => `<tr><td>${escapeHtml(comparison.module_name)}</td><td>${escapeHtml(comparison.field.replaceAll('_', ' '))}</td><td>${escapeHtml(comparison.before === null ? '—' : JSON.stringify(comparison.before))}</td><td>${escapeHtml(comparison.current === null ? '—' : JSON.stringify(comparison.current))}</td><td>${statusBadge(comparison.unchanged ? 'CONSISTENT' : 'OUTDATED')}</td></tr>`).join('');
    const pending = report.proposals.filter((proposal) => proposal.status === 'PENDING').length;
    const approved = report.proposals.filter((proposal) => proposal.status === 'APPROVED').length;
    const verified = report.proposals.filter((proposal) => proposal.status === 'VERIFIED').length;
    const failed = report.proposals.filter((proposal) => proposal.status === 'FAILED').length;
    const actions = `<div class="student-report-actions"><button class="btn" data-action="detect-student">Refresh comparison</button><button class="btn btn-primary" data-action="propagate-student" ${approved ? '' : 'disabled'}>Propagate approved corrections (${approved})</button><button class="btn" data-action="verify-student">Verify database values</button></div>`;
    return `<section class="student-report"><div class="panel student-report-header"><div><div class="eyebrow">DATABASE COMPARISON / RUN ${report.run.id}</div><h2>Impact Analysis</h2><p><span class="technical-value">${escapeHtml(report.run.student_id)}</span> · ${escapeHtml(report.run.field_name.replaceAll('_', ' '))}: <strong>${escapeHtml(report.run.old_value)}</strong> → <strong>${escapeHtml(report.run.new_value)}</strong></p><p>Current authoritative value: <strong>${escapeHtml(report.run.current_value)}</strong></p></div>${actions}</div><div class="summary-strip">${summaryCards}</div><div class="student-preservation"><div><h3>Unrelated field comparison</h3><p>${report.summary.unchangedFieldCount} unchanged field observations · ${report.summary.unexpectedChangeCount} unexpected changes</p><div class="student-field-list">${unchanged || '<span class="inline-note">No comparable non-target fields in this run.</span>'}</div></div><ul class="student-unexpected-list">${unexpected}</ul></div><details class="student-field-history"><summary>View before-and-after values for ${fieldComparisons.length} unrelated fields</summary><div class="table-card"><div class="table-scroll"><table><thead><tr><th>Module</th><th>Field</th><th>Before manual edit</th><th>Current database value</th><th>Comparison</th></tr></thead><tbody>${fieldComparisonRows || '<tr><td colspan="5">No other fields were stored for comparison.</td></tr>'}</tbody></table></div></div></details><div class="table-card student-findings-table"><div class="table-scroll"><table><thead><tr><th>Database module</th><th>Stored value</th><th>Expected value</th><th>Status</th><th>Comparison result</th><th>Other fields</th><th>Decision</th></tr></thead><tbody>${findings}</tbody></table></div></div><div class="student-propagation-result" role="status">Run ${report.run.id}: ${verified} verified · ${pending} pending · ${report.summary.rejectedCorrections} rejected · ${failed} failed</div></section>`;
  }
  async function renderCorrections(mode) {
    const path = mode === 'impact' ? '/impact' : '/corrections?status=PENDING';
    const [data, sources] = await Promise.all([api.get(path), api.get('/sources')]); sourceCache = sources.records;
    const rows = data.corrections.map((item) => `<tr><td><div class="cell-title">${escapeHtml(item.record_name)}</div><div class="cell-sub">${escapeHtml(item.record_type)} · ${escapeHtml(item.source_title)}</div></td><td><div class="cell-title">${escapeHtml(item.old_value)}</div></td><td><div class="cell-title">${escapeHtml(item.new_value)}</div></td><td><div class="confidence-cell"><span class="confidence-badge badge-${item.confidence_level.toLowerCase()}">${item.confidence_level} · ${item.confidence}%</span><small>${escapeHtml(item.confidence_reason)}</small></div></td><td>${statusBadge(item.status)}</td><td><div class="table-actions"><button class="small-action" aria-label="Approve correction for ${escapeHtml(item.record_name)}" data-action="approve" data-id="${item.id}">Approve</button><button class="small-action reject" aria-label="Reject correction for ${escapeHtml(item.record_name)}" data-action="reject" data-id="${item.id}">Reject</button></div></td></tr>`).join('');
    const summary = data.summary;
    root.innerHTML = `${pageHeading(mode === 'impact' ? 'DEPENDENCY INTELLIGENCE' : 'HUMAN REVIEW', mode === 'impact' ? 'Impact Analysis' : 'Correction Approvals', mode === 'impact' ? 'Review exactly which registered records are affected before any update.' : 'No correction is propagated until a reviewer explicitly approves it.', mode === 'impact' ? '<button class="btn" data-action="refresh">↻ Refresh analysis</button>' : '')}<div class="summary-strip">${[['Identified', summary.totalIdentified], ['Pending', summary.pending], ['Verified', summary.verified], ['Rejected', summary.rejected], ['Failed', summary.failed], ['Approved', summary.approved]].map(([label, value]) => `<div class="summary-box"><strong>${value}</strong><small>${label}</small></div>`).join('')}</div>${sourceCache.length ? `<div class="impact-flow"><span>Latest source correction</span><span class="flow-value">${escapeHtml(sourceCache[0].title)}</span><span class="flow-arrow">→</span><span class="flow-value">${escapeHtml(sourceCache[0].previous_value || 'No previous value')} → ${escapeHtml(sourceCache[0].current_value)}</span><span class="inline-note">Review each proposal below. LOW confidence always needs judgment.</span></div>` : ''}<div class="table-card"><div class="table-scroll"><table><thead><tr><th>Dependent record</th><th>Stored value</th><th>Proposed value</th><th>Confidence & rationale</th><th>Status</th><th>Decision</th></tr></thead><tbody>${rows || `<tr><td colspan="6">${empty('✓', 'No pending proposals', 'Correct a source value to run a fresh impact analysis.')}</td></tr>`}</tbody></table></div></div>`;
  }
  async function renderVerification() {
    const data = await api.get('/verification');
    root.innerHTML = `${pageHeading('CLOSED-LOOP CHECKS', 'Verification Reports', 'Every approved propagation is read back and compared with the latest source.', '<button class="btn btn-primary" data-action="run-verification">Run verification</button>')}<div class="summary-strip">${[['Identified', data.summary.totalIdentified], ['Pending', data.summary.pending], ['Verified', data.summary.verified], ['Rejected', data.summary.rejected], ['Failed', data.summary.failed], ['Approved', data.summary.approved]].map(([label, value]) => `<div class="summary-box"><strong>${value}</strong><small>${label}</small></div>`).join('')}</div><div class="table-card"><div class="table-scroll"><table><thead><tr><th>Dependent record</th><th>Proposed value</th><th>Stored value now</th><th>Result</th><th>Verification detail</th><th>Completed</th></tr></thead><tbody>${data.corrections.map((item) => `<tr><td><div class="cell-title">${escapeHtml(item.record_name)}</div><div class="cell-sub">${escapeHtml(item.source_title)}</div></td><td>${escapeHtml(item.new_value)}</td><td>${escapeHtml(item.stored_value)}</td><td>${statusBadge(item.status)}</td><td>${escapeHtml(item.verification_message || 'Awaiting approval; no update has been applied.')}</td><td>${dateTime(item.completed_at)}</td></tr>`).join('') || `<tr><td colspan="6">${empty('◎', 'No corrections to verify', 'Your correction outcomes will appear here.')}</td></tr>`}</tbody></table></div></div>`;
  }
  async function renderAudit() {
    const { events } = await api.get('/audit?limit=250');
    root.innerHTML = `${pageHeading('IMMUTABLE EVENT TRAIL', 'Audit History', 'A chronological record of source edits, proposals, decisions, propagation, and verification.', '')}<div class="table-card"><div class="table-scroll"><table><thead><tr><th>Event</th><th>Source</th><th>Dependent record</th><th>Details</th><th>Timestamp</th></tr></thead><tbody>${events.map((event) => `<tr><td><div class="cell-title">${escapeHtml(event.event_type.replaceAll('_', ' '))}</div></td><td>${escapeHtml(event.source_title || '—')}</td><td>${escapeHtml(event.dependent_name || '—')}</td><td>${escapeHtml(event.message)}${event.details_json && event.details_json !== '{}' ? `<div class="cell-sub">${escapeHtml(event.details_json)}</div>` : ''}</td><td>${dateTime(event.created_at)}</td></tr>`).join('') || `<tr><td colspan="5">${empty('◷', 'Audit trail is empty', 'System events will be recorded here.')}</td></tr>`}</tbody></table></div></div>`;
  }
  function showModal(title, description, body, submitLabel, onSubmit) {
    modal.innerHTML = `<form method="dialog" class="modal-content" id="active-form"><div class="modal-head"><div><h2>${title}</h2><p>${description}</p></div><button type="button" class="modal-close" aria-label="Close">×</button></div>${body}<div class="modal-actions"><button type="button" class="btn" data-action="close-modal">Cancel</button><button type="submit" class="btn btn-primary">${submitLabel}</button></div></form>`;
    modal.querySelectorAll('.form-field').forEach((field, index) => {
      const label = field.querySelector('label');
      const control = field.querySelector('input, select, textarea');
      if (label && control) {
        if (!control.id) control.id = `corrigen-field-${index + 1}`;
        label.htmlFor = control.id;
      }
    });
    modal.showModal(); modal.querySelector('.modal-close').onclick = () => modal.close();
    modal.querySelector('[data-action="close-modal"]').addEventListener('click', () => modal.close());
    modal.querySelector('form').addEventListener('submit', async (event) => { event.preventDefault(); const submit = modal.querySelector('[type=submit]'); submit.disabled = true; submit.textContent = 'Saving…'; try { await onSubmit(new FormData(event.currentTarget)); modal.close(); } catch (error) { toast(error.message, true); submit.disabled = false; submit.textContent = submitLabel; } });
  }
  function sourceForm() {
    showModal('Add source record', 'Define the authoritative field that downstream records depend on.', '<div class="form-grid"><div class="form-field"><label>Record title</label><input class="form-input" name="title" maxlength="160" required placeholder="e.g. Semester Examination"></div><div class="form-field"><label>Entity type</label><input class="form-input" name="entity_type" maxlength="80" required placeholder="e.g. Examination"></div><div class="form-field"><label>Field name</label><input class="form-input" name="field_name" maxlength="100" required placeholder="e.g. Exam Date"></div><div class="form-field"><label>Current value</label><input class="form-input" name="current_value" maxlength="500" required placeholder="e.g. 15 November 2026"></div></div>', 'Create source', async (form) => { await api.post('/sources', Object.fromEntries(form)); toast('Source record created.'); renderPage(); });
  }
  function dependentForm() {
    if (!sourceCache.length) { toast('Create a source record before registering a dependent.', true); return; }
    showModal('Register dependent record', 'Link a structured downstream record to its source field.', `<div class="form-grid"><div class="form-field"><label>Record name</label><input class="form-input" name="record_name" required maxlength="160" placeholder="e.g. Examination Timetable"></div><div class="form-field"><label>Record type</label><input class="form-input" name="record_type" required maxlength="100" placeholder="e.g. Timetable"></div><div class="form-field"><label>Source record</label><select class="form-input" name="source_record_id" required>${sourceCache.map((source) => `<option value="${source.id}">${escapeHtml(source.title)}</option>`).join('')}</select></div><div class="form-field"><label>Dependent field</label><input class="form-input" name="field_name" required maxlength="100" placeholder="Must match the source field"></div><div class="form-field"><label>Currently stored value</label><input class="form-input" name="stored_value" required maxlength="500"></div></div>`, 'Register record', async (form) => { await api.post('/dependents', Object.fromEntries(form)); toast('Dependent record registered.'); renderPage(); });
  }
  async function sourceDetail(id) {
    const { record, dependents } = await api.get(`/sources/${id}`);
    showModal(escapeHtml(record.title), 'Authoritative source record and its registered dependents.', `<div class="record-detail"><div class="detail-item"><small>Entity</small><strong>${escapeHtml(record.entity_type)}</strong></div><div class="detail-item"><small>Field</small><strong>${escapeHtml(record.field_name)}</strong></div><div class="detail-item"><small>Version</small><strong>v${record.version}</strong></div></div><div class="form-field"><label>Current value</label><input class="form-input" name="current_value" maxlength="500" required value="${escapeHtml(record.current_value)}"></div><p class="inline-note">Changing this value preserves the previous version and creates human-review proposals for matching registered dependent records.</p><div class="cell-sub">${dependents.length} linked records: ${dependents.map((item) => escapeHtml(item.record_name)).join(', ') || 'none'}</div>`, 'Save correction', async (form) => { if (!confirm(`Change “${record.field_name}” from “${record.current_value}” to “${form.get('current_value')}”?`)) throw new Error('Correction cancelled.'); const result = await api.patch(`/sources/${id}/value`, { current_value: form.get('current_value') }); toast(`${result.impact.totalIdentified} impact proposal(s) created. Review before applying.`); location.hash = '#impact'; });
  }
  function decisionConfirm(action, itemId) {
    const isApprove = action === 'approve';
    showModal(`${isApprove ? 'Approve' : 'Reject'} correction?`, isApprove ? 'This will update the dependent record, create an audit entry, then verify it.' : 'The dependent record will remain unchanged and this decision will be logged.', `<div class="confirm-box">${isApprove ? 'Only continue if this proposed value is correct for the dependent record.' : 'Rejected proposals cannot be applied without a new source correction.'}</div><div class="form-field"><label>Reviewer</label><input class="form-input" name="reviewer" required maxlength="100" value="Project Reviewer"></div>`, isApprove ? 'Approve & propagate' : 'Reject proposal', async (form) => { const route = isApprove ? 'approve' : 'reject'; await api.post(`/corrections/${itemId}/${route}`, { [isApprove ? 'approved_by' : 'rejected_by']: form.get('reviewer') }); toast(isApprove ? 'Decision recorded; propagation and verification completed.' : 'Proposal rejected; dependent value unchanged.'); renderPage(); });
  }
  root.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]'); if (!button) return;
    const { action, id } = button.dataset;
    if (action === 'retry-page') renderPage();
    else if (action === 'search-college-students') { collegeSearch = document.getElementById('college-search')?.value.trim() || ''; renderStudentTesting(); }
    else if (action === 'load-college-student') {
      const selectedId = document.getElementById('college-student-picker')?.value;
      if (!selectedId) return toast('Select a student record first.', true);
      collegeStudentId = selectedId;
      collegeRunId = null;
      collegeReportVisible = true;
      renderStudentTesting();
    }
    else if (action === 'detect-student') {
      try {
        if (!collegeRunId) return toast('Save a profile change before running impact detection.', true);
        const report = await api.get(`/college/runs/${collegeRunId}/report`);
        collegeReportVisible = true;
        toast(`Database comparison complete: ${report.summary.outdatedRecords} outdated, ${report.summary.missingRecords} missing.`);
        renderStudentTesting();
      } catch (error) { toast(error.message, true); }
    }
    else if (action === 'college-approve' || action === 'college-reject') {
      studentDecision(action === 'college-approve' ? 'approve' : 'reject', id);
    }
    else if (action === 'propagate-student') {
      try {
        const result = await api.post(`/college/runs/${collegeRunId}/propagate`, {});
        collegeReportVisible = true;
        const verified = result.results.filter((item) => item.status === 'VERIFIED').length;
        const failed = result.results.filter((item) => item.status === 'FAILED').length;
        toast(`Propagation checked in SQLite: ${verified} verified, ${failed} failed.` , failed > 0);
        renderStudentTesting();
      } catch (error) { toast(error.message, true); }
    }
    else if (action === 'verify-student') {
      try {
        const result = await api.post(`/college/runs/${collegeRunId}/verify`, {});
        collegeReportVisible = true;
        toast(`Verification complete: ${result.report.summary.verifiedCorrections} verified, ${result.report.summary.failedCorrections} failed.`);
        renderStudentTesting();
      } catch (error) { toast(error.message, true); }
    }
    else if (action === 'add-source') sourceForm();
    else if (action === 'add-dependent') dependentForm();
    else if (action === 'source-detail') { try { await sourceDetail(id); } catch (error) { toast(error.message, true); } }
    else if (action === 'approve' || action === 'reject') { if (action === 'approve' && !confirm('Approve and propagate this correction? The dependent value will be updated and verified.')) return; decisionConfirm(action, id); }
    else if (action === 'refresh') {
      try {
        const source = sourceCache[0];
        if (!source) return toast('No source record is available to analyze.', true);
        const result = await api.post('/impact/run', { source_id: source.id });
        toast(`Analysis complete: ${result.totalIdentified} pending proposal(s).`);
        renderPage();
      } catch (error) { toast(error.message, true); }
    }
    else if (action === 'run-verification') { try { const result = await api.post('/verification/run'); toast(`Verification complete: ${result.summary.verified} verified, ${result.summary.failed} failed.`); renderPage(); } catch (error) { toast(error.message, true); } }
    else if (action === 'open-demo') { location.hash = '#sources'; toast('Select Semester Examination, then choose View / correct.'); }
    else if (action === 'close-modal') modal.close();
  });
  document.getElementById('menu-toggle').addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    const expanded = sidebar.classList.toggle('open');
    document.getElementById('menu-toggle').setAttribute('aria-expanded', String(expanded));
  });
  document.getElementById('logout-button').addEventListener('click', (event) => logout(event.currentTarget));
  document.addEventListener('click', (event) => {
    const sidebar = document.getElementById('sidebar');
    if (sidebar.classList.contains('open') && event.target === document.body) {
      sidebar.classList.remove('open');
      document.getElementById('menu-toggle').setAttribute('aria-expanded', 'false');
    }
  });
  window.addEventListener('hashchange', renderPage);
  renderPage();
})();
