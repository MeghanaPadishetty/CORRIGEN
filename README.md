# CORRIGEN

**Correct Once. Trace Everywhere. Verify Everything.**

CORRIGEN is a local-first demonstration MVP for identifying registered dependent records affected by a source correction, requesting human review, propagating approved changes, verifying stored values, and preserving an audit trail. It is not production-ready for hospitals, banks, government records, or other high-risk use.

## Features

- Persistent SQLite source, dependent, correction, and audit records.
- Server-side validation and parameterized SQL queries.
- Deterministic field matching with transparent HIGH / MEDIUM / LOW confidence and reasons.
- Human approval or rejection; low-confidence values are never silently overwritten.
- Transactional propagation followed by a read-back verification.
- Dashboard metrics sourced from SQLite; search, filters, empty/loading states, and responsive navigation.
- Idempotent demo data initialization on first server launch.
- Server-side demo authentication gates the dashboard and all data APIs.

## Stack

- HTML5, CSS3, vanilla JavaScript
- Node.js 20+, Express 5
- express-session for local server-side demo sessions
- SQLite with better-sqlite3
- Node.js built-in test runner

## Structure

- `server.js`: Express app and local server entry point
- `database/`: schema, connection, and idempotent demo seeding
- `routes/`: dashboard, source, dependent, correction, verification, and audit APIs
- `routes/authRoutes.js` and `middleware/requireAuth.js`: login/logout endpoints and protected page/API middleware
- `auth/demoAccount.js`: configured local demonstration account
- `services/`: impact classification and correction/verification workflow
- `public/`: browser application
- `tests/`: API-level end-to-end test

## Install and run

1. Install Node.js 20 or newer.
2. From the project root, run `npm install`.
3. Run `npm start`.
4. Open http://localhost:3000.
5. Sign in with the demo credentials below; use the Student Testing page for the college dataset workflow.
6. Run `npm test` for the automated API workflow test.

## Demo Sign-In

- Email: `demo@corrigen.com`
- Password: `Corrigen@123`

The **Continue with Demo Access** button also requests a server-side session for this configured demo account. The password is not stored in browser storage. The dashboard shell and `/api` data routes require an authenticated session.

## Mobile On-LAN Access

Run `npm start` on the laptop. The development server binds to `0.0.0.0` on port `3000` by default and prints detected same-network URLs. On Windows, the laptop's IPv4 address can also be found with:

```powershell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.AddressState -eq 'Preferred' -and $_.IPAddress -notlike '127.*' } | Select-Object InterfaceAlias,IPAddress
```

Connect the phone and laptop to the same Wi-Fi network, then open `http://<laptop-ipv4>:3000/` on the phone and sign in. If Windows Firewall prompts, allow Node.js only on the private network profile; do not create a public-network exposure. Keep `PORT` consistent if you change the server port. Frontend API requests are relative to the page origin, so the phone uses the laptop address for both pages and APIs. Local HTTP cookies remain `HttpOnly` and `SameSite=Lax`; set `CORRIGEN_SECURE_COOKIE=true` only when serving over HTTPS.

The SQLite database is created at `database/corrigen.sqlite`. Set `DB_PATH` to use another database file and `PORT` to change the server port. `npm run dev` starts Node's watch mode.

## Demo Authentication

Opening http://localhost:3000 shows the CORRIGEN sign-in page. Use the fixed demonstration account:

- Email: `demo@corrigen.com`
- Password: `Corrigen@123`

The form and **Continue with Demo Access** both authenticate through Express and establish an `express-session` server-side session. The dashboard and all `/api` data routes require that session. Sign out from the dashboard header to destroy the session. The default Express memory store and local session secret are for this single-process college demonstration only; use a persistent session store, managed secrets, HTTPS, and proper account management before any real deployment. Never use real student or sensitive personal data here.

## Demo workflow

1. Open Dashboard and review the live counts.
2. Open Source Records and select Semester Examination.
3. Change Exam Date from **15 November 2026** to **18 November 2026**.
4. Open Impact Analysis or Correction Approvals. Three exact-value matches are HIGH confidence. Eligibility Report is LOW confidence because its stored value differs; it remains a manual decision. Library Reminder is linked to a different source and is not included.
5. Approve matching records and reject or leave the low-confidence proposal pending.
6. Open Verification Reports and run verification. The system reads the dependent values back from SQLite and reports the results.
7. Open Audit History to inspect source changes, proposals, decisions, propagation, and verification events.

## REST API

All request and response bodies use JSON.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/api/auth/login` | Validate demo email/password and establish a session |
| POST | `/api/auth/demo` | Establish the configured demo account session |
| GET | `/api/auth/session` | Check current session |
| POST | `/api/auth/logout` | Destroy the current session |
| GET | `/api/dashboard` | Database-backed metrics and recent activity |
| GET | `/api/sources?search=` | List/search source records |
| POST | `/api/sources` | Create source (`title`, `entity_type`, `field_name`, `current_value`) |
| GET | `/api/sources/:id` | Source detail and linked dependents |
| PATCH | `/api/sources/:id/value` | Correct source (`current_value`); preserves old value and proposes impacts |
| GET | `/api/dependents?sourceId=&status=` | List registered dependent records |
| POST | `/api/dependents` | Register a dependent record |
| GET | `/api/impact?sourceId=` | Pending impact proposals and summary |
| POST | `/api/impact/run` | Re-run analysis (`source_id`) without duplicating existing decisions |
| GET | `/api/corrections?status=` | Correction decisions and summary |
| POST | `/api/corrections/:id/approve` | Approve (`approved_by`) and propagate, then verify |
| POST | `/api/corrections/:id/reject` | Reject (`rejected_by`) without changing dependent value |
| POST | `/api/verification/run` | Re-read and verify approved correction records |
| GET | `/api/verification` | Correction results and summary |
| GET | `/api/audit?limit=` | Audit history (maximum 250 rows) |

Successful creates return `201`; validation errors return `400`; missing records return `404`; repeated decisions return `409`. API errors are returned as `{ "error": "..." }` without exposing stack traces.

## Confidence rules

- HIGH (98): exact stored value equals the source's previous value.
- MEDIUM (82): normalized text/date values match after case/whitespace/date normalization.
- LOW (35): values differ; the proposal is for human review and is never automatically applied.

Only records registered in CORRIGEN and linked to that source and field are considered. No files, emails, or external systems are scanned.

## Limitations and future enhancements

Authentication is deliberately a single fixed demo account, not production user management or role-based access control. `express-session` uses its in-memory store and a local fallback secret by default; sessions are lost on server restart. Do not deploy this configuration for real accounts or sensitive data. A production deployment needs a persistent session store, managed secrets, HTTPS, account lifecycle controls, authenticated roles, concurrency controls, migration tooling, backups, PostgreSQL support, and integrations with explicitly registered systems. Matching is limited to registered structured fields; no external files or systems are scanned. Audit records are retained; there is no delete API for correction history.
