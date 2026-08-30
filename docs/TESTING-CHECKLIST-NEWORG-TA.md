# LMS Testing Checklist — Fresh Organization (Thanglish)

Print pannalaam. Box tick pannunga, fail aanadhை ✗ podunga, kadaisi **Bug log**-la
ezhudhunga.

Vilakkam: [TESTING-GUIDE-NEWORG-TA.md](TESTING-GUIDE-NEWORG-TA.md)
DEMO seed org-kku vera checklist: [TESTING-CHECKLIST-TA.md](TESTING-CHECKLIST-TA.md)

⚠️ **Order mukkiyam** — Flow 0 → 14 varisaiya. Customer illaama loan create
panna mudiyaadhu.

**Unga credentials** (signup panna appuram inga ezhudhikkonga):

```
Org code : ______________
Mobile   : ______________
Password : ______________
```

---

## Setup

- [ ] Postgres run aagudhu, `lms_dev` DB irukku
- [ ] `pnpm install` mudinjadhu
- [ ] `apps/api/.env`-la `DATABASE_URL`, `AUTH_JWT_SECRET`, `WEB_ORIGIN` set
- [ ] 🌟 `apps/api/.env`-la **`ALLOW_PUBLIC_SIGNUP=true`**
- [ ] `pnpm --filter @lms/api db:generate` ✅
- [ ] `pnpm --filter @lms/api db:migrate:deploy` ✅
- [ ] `pnpm dev` — web `:3000`, API `:3001` rendum up
- [ ] DevTools open (Console + Network)

---

## Flow 0 — 🌟 Signup

- [ ] `/signup` open aagudhu (404 vandha `ALLOW_PUBLIC_SIGNUP` check pannunga)
- [ ] "Create Organization" heading theriyudhu
- [ ] Ellaa 6 field-um theriyudhu (Org Name, Org Code, Your Name, Mobile, Password, Confirm)
- [ ] Mandatory field kaali vittu submit → ovvoru field-kum error
- [ ] Org code-la space podunga → refuse aagudhu
- [ ] Weak password (`abc123`) → password field-la policy error
- [ ] Confirm password veaera → **"Passwords do not match"** on **confirmPassword** field
- [ ] Sari-yaana detail-oda submit → success
- [ ] 🌟 `/signin?orgCode=...` ku redirect aagudhu
- [ ] 🌟 Org code **UPPERCASE**-la prefill aagirukku (lowercase type panninaalum)
- [ ] Mobile + password kudukka login aagudhu
- [ ] Dashboard load aagudhu

### Collision & rate limit

- [ ] Adhே org code thirumba signup → **field-la** "already taken" error
- [ ] Andha error **banner illa, 503 illa**
- [ ] Lowercase-la thirumba try (`kestrel`) → adhuvum collision aagudhu
- [ ] Moonu signup panni naalavadhu → **429**

### 🔍 Org kaali-yaa irukkaa

- [ ] `/customers` kaali + clean empty state
- [ ] `/loans/products` kaali
- [ ] `/loans/schemes` kaali
- [ ] `/loans/applications` kaali
- [ ] `/overdues` kaali
- [ ] Empty state message irukku (blank screen illa)

### 🔍 Mandatory data provision aagirukkaa

- [ ] `/roles` — **3 role** (Super Admin, Branch Admin, Field Employee)
- [ ] Super Admin **system role** badge irukku, delete option illa
- [ ] `/settings/master-data` — **26 value**, 4 category
- [ ] Document Type 5, Gender 4, Relationship 8, Loan Purpose 9
- [ ] `/finance/accounts` — **8 account** (1100, 1200, 1210, 1220, 4100, 4200, 4300, 5100)
- [ ] `/admin/notifications/templates` — **16 template**
- [ ] `/admin/notifications/rules` — **14 rule**
- [ ] `/branches` — **1 branch** (`MAIN` / Head Office)
- [ ] `/users` — **1 user** (neenga)

### 🔍 Audit

- [ ] `/admin/audit` — modhal entry **`ORG_SIGNUP_COMPLETED`**
- [ ] Actor = neenga (signup panna admin)
- [ ] Metadata-la counts irukku (permissions 167, roles 3, grants 278, ...)
- [ ] IP address irukku

---

## Flow 1 — Branch setup

### MAIN branch sari pannunga

- [ ] `/branches`-la `MAIN` mattum irukku
- [ ] Address `Not set` nu irukku (signup-la kekkala)
- [ ] Edit panni real address kudunga → save aagudhu
- [ ] Branch Code **read-only** (edit panna mudiyala) — idhu sari

### Rendaavadhu branch (scope test-kku)

- [ ] `/branches/new` open aagudhu
- [ ] `BR002` / Coimbatore create aagudhu
- [ ] Mandatory field kaali → ovvoru field-kum error
- [ ] Duplicate code (`BR002` thirumba) → clean error, 503 illa

### Moonaavadhu branch (delete test-kku)

- [ ] `BR003` create aagudhu (idhula onnume attach panna koodaadhu)
- [ ] `BR003` **delete** aagudhu ✅
- [ ] `MAIN` delete try → **refuse** (user irukku)
- [ ] Refuse message clear-a irukku (generic 503 illa)
- [ ] Branch **deactivate** aagudhu
- [ ] Deactivate panna branch-la customer create panna mudiyala

---

## Flow 2 — Roles

- [ ] `/roles`-la 3 role irukku
- [ ] Super Admin — delete option **illa** (system role)
- [ ] Super Admin-la permission remove panna → **refuse**
- [ ] `/roles/new` — puthu role create aagudhu (`AUDITOR`)
- [ ] Lowercase role code → **refuse**
- [ ] Role **draft-a** create aagudhu
- [ ] Detail page-la permission checkbox grid varudhu (module-wise)
- [ ] Permission select panni **Save permissions** aagudhu
- [ ] Permission illaama activate → **refuse**
- [ ] Permission-oda **activate** aagudhu
- [ ] Andha role **delete** aagudhu (yaarukkum assign pannala)

---

## Flow 3 — Users & Employees

### Branch Admin (MAIN)

- [ ] `/users/new` open aagudhu
- [ ] Account Status dropdown-la **`Active` option illa** (Pending / Inactive mattum)
- [ ] Branch Admin create aagudhu (mobile `9876543211`, branch MAIN)
- [ ] Role select pannaama create → **refuse**
- [ ] Duplicate mobile → clean error

### Branch Admin (BR002) — scope test-kku

- [ ] Rendaavadhu Branch Admin create aagudhu (mobile `9876543212`, branch BR002)

### Field Employee

- [ ] `/employees/new`-la **Employee ID** field kekkudhu (user form-la illa)
- [ ] Employee ID kaali vittu → **refuse**
- [ ] Field Employee create aagudhu (mobile `9876543213`)

### Admin-set password

- [ ] Form-la **Temporary Password** and **Confirm Password** field irukku
- [ ] Rendum veaera-a kudukka → **"Passwords do not match"** on confirm field
- [ ] Weak password (`short`) → policy error (12+ char, character classes)
- [ ] Sari-yaana password-oda create → success
- [ ] 🌟 Create panna appuram **password screen-la kaattudhu** (once)
- [ ] **Copy** button work aagudhu
- [ ] "This is shown once" warning theriyudhu
- [ ] Page refresh panna **password poidudhu** (thirumba paakka mudiyala)
- [ ] Andha account **`ACTIVE`** aa irukku (`Pending` select panninaalum)

### Forced password change

- [ ] Andha mobile + temporary password vechu login aagudhu
- [ ] 🌟 Login panna udanē **`/change-password` ku redirect aagudhu**
- [ ] URL-la `/customers` type panna → **thirumba change-password ku varudhu**
- [ ] 🌟 API-a direct-a call panna → **403** (server-side enforcement,
      browser redirect mattum illa)
- [ ] Password maathina appuram → ellaa screen-um normal-a work aagudhu
- [ ] Thirumba login panna → **redirect varala**

### Password illaama create (old behaviour)

- [ ] Password field kaali vittu create → account **`PENDING`** aagudhu
- [ ] ⚠️ Andha account **login aagala** (design)
- [ ] ⚠️ `/forgot-password` **velai aagala** (recovery ACTIVE/LOCKED mattum)
- [ ] Adhanaala real use-kku **password kudunga**

### Live session revoke

- [ ] Innoru browser-la andha user login pannunga
- [ ] Super Admin window-la avara **deactivate** pannunga
- [ ] 🌟 Andha browser-la next click-la **logout aagudhu**

---

## Flow 4 — 🔒 Scope test

BR002 admin (`9876543212`) incognito-la login pannunga.

- [ ] `/branches` — **BR002 mattum**, MAIN/BR003 theriyala
- [ ] `/users` — BR002 user mattum
- [ ] MAIN branch URL direct-a → **403 / not found**
- [ ] `/reports/financial` **sidebar-la illa**
- [ ] `/reports/financial` URL direct-a → **403**
- [ ] `/finance/reconciliation` **sidebar-la illa**
- [ ] 🌟 Vera branch data theriñjaa **P0** nu note pannunga

---

## Flow 5 — Products & Schemes

### Product

- [ ] `/loans/products`-la **Add product** link irukku (thani `/new` page illa)
- [ ] Click panna inline form virriyudhu
- [ ] `PROD-PERSONAL` / Personal Loan / Personal create aagudhu
- [ ] **Draft-a** create aagudhu
- [ ] Detail page-la **activate** aagudhu
- [ ] Rendaavadhu product (`PROD-BUSINESS`) create aagudhu
- [ ] Duplicate product code → clean error

### Scheme

- [ ] `/loans/schemes`-la **Add scheme** link irukku
- [ ] `SCH-PERS-RED` create aagudhu
- [ ] Interest Rate **basis points**-la (`1200` = 12%)
- [ ] Decimal rate (`12.5`) → **refuse** (integer mattum)
- [ ] Scheme **draft-a** create aagudhu
- [ ] Duration add pannaama activate → **refuse**
- [ ] Duration option (`Monthly` / `12`) add aagudhu
- [ ] Scheme **activate** aagudhu

### Inactive check

- [ ] Product **deactivate** pannunga
- [ ] Application wizard dropdown-la andha product **varala**

---

## Flow 6 — Customer & KYC

### KYC customer

- [ ] `/customers/new` open aagudhu
- [ ] **Customer Type** rendu radio card, **default select aagala**
- [ ] Type select pannaama submit → **refuse**
- [ ] 🌟 **Gender dropdown-la master data varudhu** (kaali-ya irundha **P0**)
- [ ] KYC customer create aagudhu (Anitha Raman, `9100000001`)
- [ ] Mandatory field kaali → **puriyara message** (raw enum vandha **P1**)
- [ ] Duplicate mobile → warning panel + **Create anyway** button

### KYC documents

- [ ] Document **Upload** aagudhu (ID, Address, Photo)
- [ ] **Mark Verified** aagudhu
- [ ] **Submit for Review** → status `SUBMITTED`
- [ ] **Record Decision** → approve → customer `ACTIVE`

### Edge cases

- [ ] Document illaama customer create panni approve try → 🌟 **refuse aaganum**
- [ ] **Local Customer** type create aagudhu
- [ ] LOCAL → KYC **convert** aagudhu
- [ ] KYC → LOCAL thirumba **poga mudiyala** (one-way)
- [ ] BR002 branch-la oru customer create pannunga (scope test-kku)

### Search & scope

- [ ] Name-la search work aagudhu
- [ ] Mobile-la search work aagudhu
- [ ] Customer ID-la search work aagudhu
- [ ] 🔒 BR002 admin-a `/customers` → avanga customer mattum theriyudhu

---

## Flow 7 — Guarantors

- [ ] `/guarantors` **read-only directory** (create button illa)
- [ ] Customer profile-la **Add Guarantor** button irukku
- [ ] Guarantor create aagudhu
- [ ] **Address mandatory** (kaali vittu → refuse)
- [ ] Relationship dropdown-la master data varudhu
- [ ] **Record Consent** aagudhu
- [ ] Document upload aagudhu
- [ ] `/guarantors` directory-la andha guarantor varudhu
- [ ] Directory search (name / mobile / customer) work aagudhu
- [ ] **Deactivate** aagudhu

---

## Flow 8 — 🌟 Loan Lifecycle

### Application wizard

- [ ] `/loans/applications/new` open aagudhu
- [ ] **Step 1** — customer search work aagudhu
- [ ] Search-la loading indicator theriyudhu
- [ ] Vera branch customer **varala** ("Only customers in your branch")
- [ ] **Step 2** — Loan Type, Amount, Purpose kudukka mudiyudhu
- [ ] Purpose dropdown-la **master data varudhu**
- [ ] **Step 3** — Scheme select panna Interest Type + Rate **prefill aagudhu**
- [ ] Rate maathina **"Rate differs from the scheme"** warning varudhu
- [ ] Duration dropdown-la scheme-la add panna duration mattum varudhu
- [ ] **Step 4** — **Calculate EMI** work aagudhu
- [ ] Schedule panel + Review block varudhu
- [ ] Ovvoru step-lum mandatory kaali → error, next step ku pogala
- [ ] 🌟 Step 4 → Step 2 **Back** panna **data poga-la**
- [ ] **Create Draft** aagudhu
- [ ] Application number **`APP-`**-la aarambikkidhu

### Approval

- [ ] Document upload + submit aagudhu
- [ ] Credit assessment record aagudhu
- [ ] 🌟 Assessment illaama sanction → **refuse**
- [ ] Sanction aagudhu, number **`SL-`**
- [ ] Sanction terms sari-yaa theriyudhu
- [ ] Agreement sign record aagudhu
- [ ] Vera oru application **reject** aagudhu

### Disbursal

- [ ] "Schedule Disbursement" page open aagudhu
- [ ] Loan summary-la sanctioned amount theriyudhu
- [ ] **Amount edit field illa** (sanction-la irundhu varudhu) — idhu sari
- [ ] Date + Account select panni **Schedule** aagudhu
- [ ] Record transfer aagudhu
- [ ] **Confirm** aagudhu

### 🌟 Confirm panna appuram — naalu check

- [ ] Loan number **`LN-`** create aagudhu
- [ ] 🌟 **Repayment schedule generate aagudhu**
- [ ] EMI count = tenure (12)
- [ ] EMI total = principal + interest (calculation sari)
- [ ] 🌟 `/finance/journals`-la **`JE-`** entry varudhu
- [ ] 🌟 `/finance/ledger`-la **debit total = credit total**

---

## Flow 9 — 🌟 Collection → Ledger → Reports

### Collection

- [ ] "Collect EMI" page open aagudhu
- [ ] Header-la customer, loan number, **Outstanding** theriyudhu
- [ ] **Pay in full** button work aagudhu
- [ ] Collection Date default = today
- [ ] **Allocation panel** live-a update aagudhu
- [ ] Payment Mode `Cash` → reference field **illa**
- [ ] Payment Mode `UPI` / `Bank transfer` → **Payment Reference mandatory aagudhu**
- [ ] Reference illaama submit → **refuse** (aayiduchu-na **P1**)
- [ ] **Post collection** aagudhu
- [ ] Receipt **`RCP-<branch>-NNNNNN`** format-la varudhu
- [ ] Loan detail-la andha EMI **PAID** aagudhu
- [ ] 🌟 EMI-ya vida jaasthi amount → **refuse** (overpay)
- [ ] Partial amount → **pazhaya EMI modhalla** allocate aagudhu
- [ ] Collection **reverse** aagudhu
- [ ] Reverse panna EMI thirumba UNPAID
- [ ] Reversal journal entry varudhu
- [ ] **Partial reversal mudiyala** (full mattum)

### 🌟 Number agreement

Collection amount: `____________`

- [ ] `/loans/collections`-la same amount
- [ ] `/finance/journals`-la `JE-` entry, same amount
- [ ] `/finance/ledger`-la cash account debit same
- [ ] `/finance/trial-balance` — **debit = credit**
- [ ] `/reports/collections`-la same total
- [ ] `/reports/financial`-la same numbers
- [ ] 🌟 **Ellaa 6 idathulaiyum match aagudhu**

---

## Flow 10 — Field Ops (📱 375px)

Field Employee login, DevTools device toolbar ON, 375px.

- [ ] Login aagudhu
- [ ] Sidebar-la **kammi item mattum**
- [ ] Finance / Reports / Admin sidebar-la **illa**
- [ ] `/finance/journals` URL direct-a → **403**
- [ ] `/users` → **403**
- [ ] `/reports/*` → **403**
- [ ] `/field/check-in` — GPS permission kekkudhu
- [ ] Check-in aagudhu, location record aagudhu
- [ ] `/field` dashboard open aagudhu
- [ ] `/field/collections`-la collection create aagudhu
- [ ] `/field/cash-handovers/new` → **`CH-`** number
- [ ] `/field/cash-reconciliation/new` → **`CR-`** number
- [ ] `/field/sync-queue` open aagudhu
- [ ] 📱 375px — table scroll aagudhu (page odayala)
- [ ] 📱 375px — button reach aagudhu, text padikka mudiyudhu
- [ ] 📱 768px sari
- [ ] 📱 1280px sari

---

## Flow 11 — Overdue & Recovery

- [ ] Backdated loan create aagudhu (disbursement date 3 maasam munnadi)
- [ ] `/overdues`-la andha loan varudhu
- [ ] Overdue days calculation sari
- [ ] `/overdues/<loanId>` detail open aagudhu
- [ ] Penal interest calculate aagudhu
- [ ] `/recovery-cases` — case create, **`RC-`** number
- [ ] Case-kku user assign aagudhu
- [ ] Vera user-kku reassign aagudhu
- [ ] 🌟 Assignment **history-la rendum irukku** (pazhaya record delete aagala)
- [ ] Recovery action record aagudhu
- [ ] 🌟 **Write-off refuse aagudhu** (yaarukkume permission illa)

---

## Flow 12 — Reports & Dashboard

- [ ] `/` dashboard load aagudhu
- [ ] Ellaa widget-um load aagudhu (429 vandha 1 nim wait panni refresh)
- [ ] Ovvoru widget click → sari-yaana page-kku pogudhu
- [ ] Drill-down page-la number match aagudhu
- [ ] `/branch` open aagudhu
- [ ] Loading state theriyudhu (blank screen illa)

### 9 report

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
- [ ] CSV Excel-la special character sari-yaa theriyudhu
- [ ] Report save aagudhu, `/reports/saved`-la thirumba open aagudhu

### 🔒 Branch Admin

- [ ] `/reports/financial` sidebar-la illa
- [ ] URL direct-a → **403**
- [ ] Matha report-la avanga branch data mattum

---

## Flow 13 — Notifications

- [ ] `/notifications`-la Flow 8/9 vேlai-kku notification vandhirukku
- [ ] Click panna **read** aagudhu, badge count kuraiyudhu
- [ ] `/notifications/<id>` detail open aagudhu
- [ ] `/notifications/preferences` maathi save aagudhu
- [ ] `/admin/notifications/templates` — **16 template**
- [ ] Template edit aagudhu
- [ ] `/admin/notifications/rules` — **14 rule**
- [ ] Rule enable / disable aagudhu
- [ ] `/admin/notifications/deliveries` status theriyudhu
- [ ] Template disable panna andha event-kku notification varala

---

## Flow 14 — Settings, Config Transfer & Audit

### Settings

- [ ] `/admin/settings/organization` open + save aagudhu
- [ ] 🌟 Org setting **org-level-la** apply aagudhu (branch-kku mattum illa)
- [ ] `/admin/settings/branch` override work aagudhu
- [ ] `/admin/settings/operational` save aagudhu
- [ ] `/admin/settings/retention` open aagudhu
- [ ] 🌟 **Purge run refuse aagudhu**
- [ ] `/admin/settings/changes` history varudhu
- [ ] `/admin/maintenance/jobs` open aagudhu

### Config transfer

- [ ] `/admin/settings/transfer` — **export** JSON download aagudhu
- [ ] 🔒 JSON-la password / secret **illa**
- [ ] Same file **import** → conflict message (silent overwrite illa)
- [ ] Udanja JSON import → clean error + per-entry problem list
- [ ] Invalid import-la app **crash aagala**

### 🌟 Audit trail

- [ ] `/admin/audit` open aagudhu
- [ ] **`ORG_SIGNUP_COMPLETED`** modhal entry-a irukku
- [ ] Branch create / edit audit-la irukku
- [ ] Role create + permission assign audit-la irukku
- [ ] User create audit-la irukku
- [ ] User deactivate audit-la irukku
- [ ] Customer create audit-la irukku
- [ ] KYC approve audit-la irukku
- [ ] Product / scheme create audit-la irukku
- [ ] Loan sanction audit-la irukku
- [ ] Disbursal audit-la irukku
- [ ] Collection audit-la irukku
- [ ] Reversal audit-la irukku
- [ ] Settings change audit-la irukku
- [ ] Config import audit-la irukku
- [ ] Detail-la **yaaru / eppo / old value / new value** theriyudhu
- [ ] Audit filter (date, user, action) work aagudhu

---

## Cross-cutting (ellaa screen-lum)

- [ ] Ovvoru list page-lum **loading state** irukku
- [ ] Ovvoru list page-lum **empty state** message irukku
- [ ] Form submit panra pothu button disable aagudhu (double submit illa)
- [ ] Form error clear-a theriyudhu
- [ ] **Dark mode** ellaa screen-lum work aagudhu
- [ ] Sidebar active item highlight aagudhu
- [ ] Detail page-la parent menu highlight aagudhu
- [ ] **Global search** (header) work aagudhu
- [ ] Breadcrumb sari
- [ ] Browser back button work aagudhu
- [ ] Page refresh panna data poga-la
- [ ] Table pagination work aagudhu
- [ ] Table sort work aagudhu
- [ ] Console-la **red error illa**
- [ ] Network-la **500 / 503 illa**
- [ ] Broken link illa (404 varala)
- [ ] Date picker ellaa idathulaiyum onnu maadhiri
- [ ] Date timezone prachanai illa (naethikku select panna naethikku save aagudhu)

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

**Severity:** P0 = data thappu / security leak / screen open aagala / audit
record aagala · P1 = flow mudikka mudiyala · P2 = UI polish

---

## Idha bug-a report panna vேndaam

- [ ] 429 rate limit (API 60/min, signup 3/min)
- [ ] Super Admin-kku `field.checkin`, `recovery.writeoff.post`,
      `retention.purge.run` illa — deliberate
- [ ] Branch address "Not set" — Flow 1-la neenga sari panreenga
- [ ] Puthu account PENDING (password illa) — password recovery-la set pannanum
- [ ] Product / scheme / role draft-a create aagum — activate pannanum
- [ ] `/basic-tables`, `/blank`, `/line-chart`, `/bar-chart` — template leftover
