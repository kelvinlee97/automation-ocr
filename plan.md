# ClaimFlow Project Optimization Plan

## Overview status

| Phase | title | state | rely |
|-------|------|------|------|
| Phase 1 | Critical bug fixes + dead code cleanup | ✅ done | none |
| Phase 2 | SQLite data layer migration | ✅ done | Phase 1 |
| Phase 3 | Routing integration test completion | ✅ done | Phase 2 |
| Phase 4 | adminServer.js split | ✅ done (pending manual visual review) | Phase 3 |
| Phase 5 | Security Hardening + Observability + Campaign Features | ⏳ pending | Phase 4 |

---

## Phase 5: Security hardening + Campaign function (about 3-5 days)

### Target
Introducing Helmet/CSP/CSRF, Docker healthcheck, structured indicators, and adding new Campaign functions (activity management, multi-activity support, data isolation by activity).

### task list

#### 5A: Security hardening (about 1-2 days)
- [ ] **Helmet + CSP**: Integrate helmet in `admin/middleware/security.js`
  - CSP: `scriptSrc: ["'self'", nonce]`, `styleSrc: ["'self'", "'unsafe-inline'"]` (manage background style dependency inlining)
  - X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Referrer-Policy: strict-origin-when-cross-origin
- [ ] **CSP nonce injection**: Each GET request generates `crypto.randomBytes(16).toString('base64')` to inject `res.locals.cspNonce`
- [ ] **CSRF protection**: New `wa-bot/src/utils/csrfToken.js` (double-submit cookie mode)
  - GET response injects `csrfToken` into cookie + session
  - POST verifies that `x-csrf-token` header or `form._csrf` is consistent with session
  - Each view template form adds a hidden field `<input type="hidden" name="_csrf" value="${csrfToken}">`
- [ ] **Docker HEALTHCHECK**: Add `HEALTHCHECK CMD wget -q --spider http://127.0.0.1:3000/health || exit 1` in Dockerfile
- [ ] **Security CI**:
  - Create new `.github/workflows/security.yml`: npm audit + gitleaks-action + dependency-review-action (PR trigger)
  - Update `ci.yml`: add `npm audit --audit-level=high`
- [ ] **Error tracing**: `traceId` (`req.id = crypto.randomUUID()`) is generated in Express error middleware, all winston output contains traceId
- [ ] **PII desensitization improvement**: Views layer IC display changed to `XXXXXX-XX-****` (Excel export plain text remains unchanged, business needs)
- [ ] **CSP Report-Only phase**: First go online in `Content-Security-Policy-Report-Only` mode, observe no violation for 24h and then switch to enforce

#### 5B: Campaign function (about 2-3 days)
- [ ] **Campaign Database Migration**:
  - `campaigns` table: `id` (PK), `name` (TEXT UNIQUE), `brand` (TEXT), `start_date` (TEXT), `end_date` (TEXT), `min_amount` (INTEGER), `is_active` (INTEGER DEFAULT 1), `created_at` (TEXT)
  - The `receipts` table adds a `name` field (added in front of `ic`) and a `campaign_id` field (foreign key -> campaigns.id, which can be NULL)
  - `messageHandler.js` fixes the bug of mixed images and text (when the same message contains images + text, the IC text is ignored)
  - `messageHandler.js` fixes the out-of-order sending bug (when the receipt is sent first and then the IC, the ic field of the first receipt is NULL, and all NULL ic records in the same Session need to be backtracked and filled in)
- [ ] **Campaign Admin management interface**:
  - Added "Activity Management" navigation entry (visible only to super admin)
  - Campaign list page: displays all activities, status (active/ended/upcoming), action buttons (edit/delete/switch active)
  - Campaign new/edit page: form fields (name, brand, start_date, end_date, min_amount)
  - Switch active Campaign: Change `is_active=1` to 0, and change the currently selected one to 1 (single case mode)
- [ ] **Bot quarantine by activity**:
  - `receiptHandler.js` writes the current active campaign_id when saving the receipt
  - `sessionManager.js` isolates sessions by campaign (or shares sessions, but filters receipts by campaign)
  - Admin background filters receipt list by campaign
- [ ] **AI automatic recognition**:
  - `receiptHandler.js` automatically calls `aiService.js` to identify the amount after saving the receipt
  - The recognition results are written into `ai_result_json` (existing fields are reused)
  - The Admin background displays the AI recognition amount. If < min_amount, a warning sign is displayed.
  - Failure of AI recognition will not affect the process, and Admin can manually review it.
- [ ] **Message template management** (Campaign advanced function, can be iterated later):
  - Campaign configuration contains "Reject template" (multiple entries)
  - Admin can choose a template to send WhatsApp messages when reviewing rejects

### success criteria
- CSRF fake cross-site form POST returns 403
- `docker inspect` show healthcheck `healthy`
- CSP Report-Only runs for 24h without violation error.
- security.yml CI all green
- Campaign function manual acceptance passed:
  - Create 2 Campaigns, upload receipts respectively, and filter by Campaign in the background to display correctly
  - When there is no active Campaign, the receipt is saved as usual, and the Admin background displays "No associated activities"
  - AI automatically recognizes the amount, and the min_amount warning is displayed correctly

---

## Technical constraints (confirmed)
| Constraints | decision making |
|-------|------|
| storage base | Introduce SQLite (`better-sqlite3`) to replace JSON files |
| PII Compliance | Weak (log/UI desensitization, disk plaintext acceptable) |
| template engine | Not introduced (to avoid SSR rendering overhead) |
| Splitting principle | Just move but not change, route by route is equivalent. |
| Rollback strategy | Each Phase has independent PR and can be rolled back independently |
| Campaign multiple campaigns | Singleton active mode (there is only one active Campaign at the same time) |
| Bot automated messages | **BANNED** - All messages sent to consumers must be manually clicked to send by the Admin |
| AI recognition | Automatically triggered (after receipt is submitted), does not rely on Admin's manual click |

---

## Identified risks and mitigations
| risk | ease |
|------|------|
| SQLite migration is irreversible | Provide `--dry-run` + automatic backup to `data/backup/<timestamp>/` |
| adminServer.js split introduces regression | Phase 3 integration testing must precede Phase 4 |
| CSP nonce implementation is complex | First set the Report-Only mode, observe if there is no violation for 24h, and then enforce |
| Campaign features impact existing processes | Default campaign_id = NULL, compatible with old data, gradually migrated |
| Fixed the bug of mixed sending of images and texts + sending out of order | First write the test to cover the two scenarios, and then modify messageHandler.js |
| AI automatic recognition failed | Does not block the process, Admin can manually review (approve/reject) |
