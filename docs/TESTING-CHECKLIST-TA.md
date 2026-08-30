# LMS Testing Checklist — DEMO Seed Org (Thanglish)

Print pannalaam. Ovvoru box-um tick pannunga. Fail aana box-a ✗ nu mark panni,
kadaisila irukkura **Bug log** table la ezhudhunga.

Vilakkam venumna: [TESTING-GUIDE-TA.md](TESTING-GUIDE-TA.md)

> Puthu organization create panni test pannanumna:
> [TESTING-CHECKLIST-NEWORG-TA.md](TESTING-CHECKLIST-NEWORG-TA.md)

**Login:** Org `DEMO` · Password `Kestrel7Vault`
**Roles:** Super Admin `9000000001` · Branch Admin A `9000000002` (BR001) ·
Branch Admin B `9000000003` (BR002) · Field Employee `9000000004`

⚠️ `9000000013/14/15` — **touch panna koodaadhu** (e2e accounts)
⚠️ `429` = rate limit, bug illa. 1 nimisham wait pannunga.

---

## Setup

- [ ] Postgres run aagudhu, `lms_dev` DB irukku
- [ ] `pnpm install` mudinjadhu
- [ ] `apps/api/.env` la `DATABASE_URL`, `AUTH_JWT_SECRET`, `WEB_ORIGIN` set aagirukku
- [ ] `pnpm --filter @lms/api db:generate` ✅ (bare `npx prisma generate` **illa**)
- [ ] `pnpm --filter @lms/api db:migrate:deploy` ✅
- [ ] `pnpm --filter @lms/api db:seed` ✅
- [ ] `pnpm dev` — web `:3000`, API `:3001` rendum up
- [ ] DevTools open (Console + Network tab)
- [ ] Rendu browser window ready (normal = Super Admin, incognito = Branch Admin)

---

## Flow 1 — Login & Session

- [ ] Logout state la `/customers` type panna → `/signin` ku pogudhu
- [ ] Login panna appuram thirumba `/customers` ku pogudhu (original path ninaivu)
- [ ] Sari-yaana credentials la login aagudhu
- [ ] Thappaana password → clear error message
- [ ] Thappaana password 5 vaati → account **lock** aagudhu
- [ ] `9000000005` (INACTIVE) login refuse aagudhu
- [ ] `9000000006` (LOCKED) login refuse aagudhu
- [ ] `OTHERORG` / `9000000001` login aagudhu, DEMO data theriyala
- [ ] `/forgot-password` → OTP **API terminal la print aagudhu**
- [ ] OTP verify → `/reset-password` ku pogudhu
- [ ] Thappaana OTP → refuse aagudhu
- [ ] `/change-password` work aagudhu (`9000000007` use pannunga)
- [ ] `/active-sessions` la session list varudhu
- [ ] Rendaavadhu browser session-um list la varudhu
- [ ] Session **revoke** panna, andha browser next click la logout aagudhu
- [ ] "Sign out everywhere else" work aagudhu
- [ ] Logout button work aagudhu

---

## Flow 2 — Organization & Branches

- [ ] `/company-settings` open aagudhu
- [ ] Org detail edit + save aagudhu
- [ ] `/branches` la BR001, BR002, BR003 varudhu
- [ ] `/branches/new` la puthu branch create aagudhu (`BRZZ1`)
- [ ] Branch edit aagudhu
- [ ] Branch **deactivate** aagudhu
- [ ] Deactivate panna branch-la puthu customer create panna mudiyala
- [ ] `BR003` **delete** aagudhu (child illa) ✅
- [ ] `BR001` delete **refuse aagudhu** (customer/loan irukku)
- [ ] Refuse message clear-a irukku (generic 503 illa)

---

## Flow 3 — Users, Roles & Permissions

- [ ] `/roles` list varudhu
- [ ] `SUPER_ADMIN` system role — delete panna mudiyala
- [ ] `/roles/new` la puthu role create aagudhu (`TESTZZ_ROLE`)
- [ ] Role-kku permission assign + save aagudhu
- [ ] Role edit aagudhu
- [ ] `/users` list varudhu
- [ ] `/users/new` la puthu user create aagudhu
- [ ] User-kku role assign aagudhu
- [ ] User **deactivate** aagudhu
- [ ] 🌟 Deactivate panna, andha user-oda **live session revoke aagudhu**
- [ ] `/employees` list varudhu
- [ ] Employee create + edit aagudhu
- [ ] Branch Admin-a login panni: avarukku illaadha permission-a innoru
      user-kku kudukka **mudiyala** (delegation subset rule)

---

## Flow 4 — Customer & KYC

- [ ] `/customers` la 8 customer varudhu
- [ ] Name la search (`Anitha`) work aagudhu
- [ ] Mobile la search (`9100000001`) work aagudhu
- [ ] Customer ID la search work aagudhu
- [ ] `/customers/new` open aagudhu
- [ ] Mandatory field kaaliya vittu submit → ovvoru field-kum error
- [ ] Error message **user-kku puriyara maadhiri** irukku (raw enum illa)
- [ ] Puthu KYC customer create aagudhu
- [ ] Document upload aagudhu (PNG / PDF)
- [ ] Thappaana file type upload panna refuse aagudhu
- [ ] KYC **submit** → status `SUBMITTED`
- [ ] KYC **approve** → status `APPROVED`, customer `ACTIVE`
- [ ] 🌟 `CUST003` (document illa) approve panna **refuse aagudhu**
- [ ] `CUST004` (REVISION_REQUIRED) resubmit work aagudhu
- [ ] `CUST007` **LOCAL → KYC conversion** aagudhu
- [ ] KYC → LOCAL thirumba **poga mudiyala** (one-way)
- [ ] `CUST008` **delete** aagudhu ✅
- [ ] `CUST001` delete **refuse aagudhu** (loan irukku)
- [ ] 🔒 Branch Admin A la `/customers` — **CUST002/CUST008 theriyala**
- [ ] 🔒 Branch Admin A la `/customers/CUST002` URL direct-a → **403 / not found**

---

## Flow 5 — Guarantors

- [ ] `/guarantors` list varudhu
- [ ] Puthu guarantor create aagudhu
- [ ] Guarantor customer-oda link aagudhu (CUST001)
- [ ] Consent record aagudhu
- [ ] Guarantor document upload aagudhu
- [ ] Readiness status clear-a theriyudhu (enna miss aagudhu-nu solludhu)
- [ ] Customer detail page la guarantor theriyudhu
- [ ] Guarantor edit aagudhu
- [ ] 🔒 Branch Admin A-kku BR002 guarantor theriyala

---

## Flow 6 — Loan Products & Schemes

- [ ] `/loans/products` la 4 product varudhu
- [ ] `PROD-VEHICLE` **inactive** nu theriyudhu
- [ ] Puthu product create aagudhu (`PRODZZ1`)
- [ ] Product edit aagudhu
- [ ] `/loans/schemes` la 5 scheme varudhu
- [ ] `SCH-GOLD-OLD` **inactive** nu theriyudhu
- [ ] Puthu scheme create aagudhu (`SCHZZ1`)
- [ ] Application wizard dropdown la `PROD-VEHICLE` **varala**
- [ ] Application wizard dropdown la `SCH-GOLD-OLD` **varala**
- [ ] `SCH-GOLD-EMPTY` select panna app **crash aagala** (clean message)

---

## Flow 7 — 🌟 Loan Lifecycle (main)

Customer: **CUST001**

### 7a. Application

- [ ] `/loans/applications` open aagudhu
- [ ] `/loans/applications/new` — wizard open aagudhu
- [ ] **Step 1** — customer search work aagudhu (`Anitha`)
- [ ] Search panra pothu loading spinner theriyudhu
- [ ] CUST001 select aagudhu
- [ ] **Step 2** — product + scheme select aagudhu
- [ ] **Step 3** — amount + tenure kudukka mudiyudhu
- [ ] **Step 4** — review la ellaa detail-um sari-yaa theriyudhu
- [ ] Ovvoru step-lum mandatory field kaaliya vittu Next → error, next step ku pogala
- [ ] 🌟 Step 4 → Step 2 back pona, **data poga-la**
- [ ] Submit aagudhu
- [ ] Application number **`APP-`** la aarambikkidhu

### 7b. Approval

- [ ] Application detail page la status `SUBMITTED`
- [ ] Credit assessment create aagudhu
- [ ] 🌟 Assessment illaama sanction panna **refuse aagudhu**
- [ ] Sanction aagudhu, number **`SL-`** la aarambikkidhu
- [ ] Sanction terms (amount/rate/tenure) sari-yaa theriyudhu
- [ ] Agreement sign aagudhu
- [ ] Vera oru application **reject** aagudhu → status `REJECTED`

### 7c. Disbursal

- [ ] `/loans/disbursements/new` open aagudhu
- [ ] Sanction aana application select aagudhu
- [ ] Bank transfer select panna, **reference number mandatory** aagudhu
- [ ] Reference illaama submit panna **refuse aagudhu**
- [ ] Disburse aagudhu, loan number **`LN-`** la aarambikkidhu
- [ ] 🌟 **Repayment schedule generate aagudhu**
- [ ] EMI count = tenure
- [ ] EMI total = principal + interest (calculation sari)
- [ ] 🌟 `/finance/journals` la **`JE-`** entry varudhu
- [ ] 🌟 `/finance/ledger` la **debit total = credit total**
- [ ] Loan detail page la ellaa detail-um theriyudhu

---

## Flow 8 — 🌟 Collection → Ledger → Reports

### 8a. Collection

- [ ] `/loans/collections/new` open aagudhu
- [ ] Flow 7 loan select aagudhu
- [ ] EMI amount collect aagudhu (Cash)
- [ ] Receipt number **`RCP-<branch>-NNNNNN`** format la varudhu (per-branch sequence)
- [ ] Loan detail la andha EMI **PAID** aagudhu
- [ ] 🌟 EMI-a vida jaasthi amount → **refuse aagudhu** (overpay)
- [ ] Partial amount → **pazhaya EMI modhalla** allocate aagudhu (oldest-first)
- [ ] Payment mode ellaam (cash / bank / UPI) work aagudhu
- [ ] Collection **reverse** aagudhu
- [ ] Reverse panna EMI thirumba UNPAID aagudhu
- [ ] Reverse-kku ledger la reversal journal entry varudhu
- [ ] **Partial reversal mudiyala** (full mattum)

### 8b. 🔢 Number agreement (romba mukkiyam)

Oru collection amount-a note pannunga: `____________`

- [ ] `/loans/collections` la same amount
- [ ] `/finance/journals` la `JE-` entry, same amount
- [ ] `/finance/ledger` la cash account la same amount
- [ ] `/finance/trial-balance` la **debit total = credit total**
- [ ] `/reports/collections` la same period, same total
- [ ] `/reports/financial` la same numbers
- [ ] 🌟 **Ellaa 6 idathulaiyum number match aagudhu**

---

## Flow 9 — Field Operations (📱 375px)

Field Employee `9000000004` · DevTools device toolbar ON, width **375px**

- [ ] Login aagudhu
- [ ] Sidebar la **kammiya item** dhaan irukku
- [ ] Finance / Reports / Admin **sidebar la illa**
- [ ] `/finance/journals` URL direct-a → **403**
- [ ] `/users` URL direct-a → **403**
- [ ] `/field/check-in` — GPS permission kekkudhu
- [ ] Check-in aagudhu, location record aagudhu
- [ ] `/field` dashboard open aagudhu
- [ ] `/field/collections` la collection create aagudhu
- [ ] `/field/cash-handovers/new` — handover create aagudhu, **`CH-`** number
- [ ] `/field/cash-reconciliation/new` — reconciliation, **`CR-`** number
- [ ] `/field/sync-queue` open aagudhu
- [ ] 📱 375px la table horizontal scroll aagudhu (page odayala)
- [ ] 📱 375px la button thumb-kku reach aagudhu
- [ ] 📱 375px la text padikka mudiyudhu
- [ ] 📱 375px la form field-gal usable-a irukku
- [ ] 📱 768px (tablet) la ellaa screen-um sari-yaa irukku
- [ ] 📱 1280px (desktop) la sari-yaa irukku

---

## Flow 10 — Overdue & Recovery

- [ ] `/overdues` open aagudhu
- [ ] Backdated loan create aagudhu (disbursement date 3 maasam munnadi)
- [ ] Andha loan `/overdues` la varudhu
- [ ] Overdue days calculation sari-yaa irukku
- [ ] `/overdues/<loanId>` detail open aagudhu
- [ ] Penal interest calculate aagudhu
- [ ] `/recovery-cases` open aagudhu
- [ ] Recovery case create aagudhu, **`RC-`** number
- [ ] Case-kku user assign aagudhu
- [ ] Vera user-kku reassign aagudhu
- [ ] 🌟 Assignment **history la rendum irukku** (pazhaya record delete aagala)
- [ ] Recovery action add aagudhu
- [ ] 🌟 **Write-off refuse aagudhu** (yaarukkume permission illa)

---

## Flow 11 — Reports & Dashboard

### Dashboard

- [ ] `/` landing dashboard load aagudhu
- [ ] Ellaa KPI widget-um load aagudhu (429 vandha 1 nim wait panni refresh)
- [ ] Ovvoru widget-um click panna sari-yaana page-kku pogudhu (drill-down)
- [ ] Drill-down page la number match aagudhu
- [ ] `/branch` branch dashboard open aagudhu
- [ ] Loading state theriyudhu (blank screen illa)

### Reports (9)

- [ ] `/reports/dashboard`
- [ ] `/reports/portfolio`
- [ ] `/reports/applications`
- [ ] `/reports/disbursals`
- [ ] `/reports/collections`
- [ ] `/reports/field-collections`
- [ ] `/reports/financial`
- [ ] `/reports/overdue-recovery`
- [ ] `/reports/saved`
- [ ] Date filter maathina number maarudhu
- [ ] Empty date range → clean empty state (crash illa)
- [ ] CSV export download aagudhu
- [ ] CSV Excel la open panna special character sari-yaa theriyudhu
- [ ] Report save aagudhu, `/reports/saved` la thirumba open aagudhu

### 🔒 Branch Admin check

- [ ] `/reports/financial` **sidebar la illa**
- [ ] `/reports/financial` URL direct-a → **403**
- [ ] `/finance/reconciliation` **sidebar la illa**
- [ ] Matha report la **BR001 data mattum** (BR002 number illa)

---

## Flow 12 — Notifications

- [ ] `/notifications` list varudhu
- [ ] Flow 7/8 vேlai-kku notification vandhirukku
- [ ] Notification click panna **read** aagudhu
- [ ] Unread badge count kuraiyudhu
- [ ] `/notifications/<id>` detail open aagudhu
- [ ] `/notifications/preferences` maathi save aagudhu
- [ ] `/admin/notifications/templates` list varudhu
- [ ] Template edit aagudhu
- [ ] `/admin/notifications/rules` list varudhu
- [ ] Rule enable / disable aagudhu
- [ ] `/admin/notifications/deliveries` la status (sent/failed) theriyudhu
- [ ] Template disable panna, andha event-kku notification varala

---

## Flow 13 — Settings, Config Transfer & Audit

### Settings

- [ ] `/admin/settings/organization` open + save aagudhu
- [ ] 🌟 Org setting save panna, **org-level la dhaan** apply aagudhu
      (thappaana branch-kku mattum apply aagala)
- [ ] `/admin/settings/branch` — branch override work aagudhu
- [ ] `/admin/settings/operational` open + save aagudhu
- [ ] `/admin/settings/retention` open aagudhu
- [ ] 🌟 **Purge run refuse aagudhu** (permission yaarukkume illa)
- [ ] `/admin/settings/changes` change history varudhu
- [ ] `/admin/maintenance/jobs` open aagudhu

### Config transfer

- [ ] `/admin/settings/transfer` open aagudhu
- [ ] Config **export** → JSON download aagudhu
- [ ] 🔒 JSON la password / secret **illa**
- [ ] Same file thirumba **import** → conflict message varudhu (silent overwrite illa)
- [ ] Udanja (invalid) JSON import → clean error, per-entry problem list
- [ ] Invalid import la app **crash aagala**

### 🌟 Audit trail (ellaam inga record aaganum)

- [ ] `/admin/audit` open aagudhu
- [ ] Settings change audit la irukku
- [ ] User create audit la irukku
- [ ] User deactivate audit la irukku
- [ ] Customer create audit la irukku
- [ ] KYC approve audit la irukku
- [ ] Loan sanction audit la irukku
- [ ] Disbursal audit la irukku
- [ ] Collection audit la irukku
- [ ] Collection reversal audit la irukku
- [ ] Config import audit la irukku
- [ ] `/admin/audit/<id>` detail la **yaaru / eppo / old value / new value** theriyudhu
- [ ] Audit filter (date, user, action) work aagudhu

---

## Part 5 — Role permission sweep

### Branch Admin A (`9000000002`, BR001)

- [ ] Sidebar la Financial report **illa**
- [ ] Sidebar la Reconciliation **illa**
- [ ] Customers la BR001 mattum
- [ ] Loans la BR001 mattum
- [ ] Collections la BR001 mattum
- [ ] Reports la BR001 number mattum
- [ ] BR002 record URL direct-a → 403
- [ ] Theriyara button ellaam actually work aagudhu (403 varala)

### Branch Admin B (`9000000003`, BR002)

- [ ] BR002 data mattum theriyudhu
- [ ] BR001 data **theriyala**

### Field Employee (`9000000004`)

- [ ] Sidebar la kammi item mattum
- [ ] `/finance/*` → 403
- [ ] `/reports/*` → 403
- [ ] `/users`, `/roles` → 403
- [ ] `/admin/*` → 403
- [ ] Collection / cash handover / check-in work aagudhu

### Cross-org (`OTHERORG` / `9000000001`)

- [ ] 🔒 DEMO customer **onnume theriyala**
- [ ] 🔒 DEMO branch (BR001/BR002/BR003) **theriyala**
- [ ] 🔒 DEMO product / scheme **theriyala**
- [ ] 🔒 DEMO loan / collection **theriyala**

---

## Cross-cutting (ellaa screen-lum paarunga)

- [ ] Ovvoru list page-lum **loading state** irukku (blank illa)
- [ ] Ovvoru list page-lum **empty state** message irukku
- [ ] Ovvoru form-lum submit panra pothu button disable aagudhu (double submit illa)
- [ ] Ovvoru form-lum error clear-a theriyudhu
- [ ] **Dark mode** ellaa screen-lum work aagudhu (text theriyudhu, contrast sari)
- [ ] Sidebar la active item **highlight** aagudhu
- [ ] Detail page la irukkum pothu, parent menu item highlight aagudhu
- [ ] **Global search** (header) work aagudhu
- [ ] Breadcrumb sari-yaa irukku
- [ ] Browser back button ellaa idathulaiyum sari-yaa work aagudhu
- [ ] Page refresh panna data poga-la
- [ ] Table pagination work aagudhu
- [ ] Table sort work aagudhu
- [ ] Console la **red error illa** (ellaa page-lum)
- [ ] Network la **500 / 503 illa**
- [ ] Broken link illa (404 varala)
- [ ] Date picker ellaa idathulaiyum onnu maadhiri irukku
- [ ] Date la timezone prachanai illa (naethikku select panna naethikku dhaan save aagudhu)

---

## Bug log

| #   | Severity | Route | Role | Flow | Enna nadandhadhu | Screenshot |
| --- | -------- | ----- | ---- | ---- | ---------------- | ---------- |
| 1   |          |       |      |      |                  |            |
| 2   |          |       |      |      |                  |            |
| 3   |          |       |      |      |                  |            |
| 4   |          |       |      |      |                  |            |
| 5   |          |       |      |      |                  |            |
| 6   |          |       |      |      |                  |            |
| 7   |          |       |      |      |                  |            |
| 8   |          |       |      |      |                  |            |
| 9   |          |       |      |      |                  |            |
| 10  |          |       |      |      |                  |            |
| 11  |          |       |      |      |                  |            |
| 12  |          |       |      |      |                  |            |
| 13  |          |       |      |      |                  |            |
| 14  |          |       |      |      |                  |            |
| 15  |          |       |      |      |                  |            |
| 16  |          |       |      |      |                  |            |
| 17  |          |       |      |      |                  |            |
| 18  |          |       |      |      |                  |            |
| 19  |          |       |      |      |                  |            |
| 20  |          |       |      |      |                  |            |

**Severity:** P0 = data thappu / security leak / screen open aagala ·
P1 = flow mudikka mudiyala · P2 = UI polish

---

## Test panra pothu create panna data (kadaisila delete panna)

- [ ] `CUSTZZ*` customers
- [ ] `PRODZZ1` product
- [ ] `SCHZZ1` scheme
- [ ] `BRZZ1` branch
- [ ] `TESTZZ_ROLE` role
- [ ] Puthu users
- [ ] Test loan applications / disbursements / collections

⚠️ Seed data (`CUST001`–`CUST008`, `BR001`–`BR003`, `PROD-*`, `SCH-*`,
`9000000001`–`9000000022`) **delete panna koodaadhu.**
