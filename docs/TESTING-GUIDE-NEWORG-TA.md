# LMS Testing Guide — Fresh Organization (Thanglish)

Intha guide **puthu organization** create panni, **zero-la irundhu** ovvoru flow-um
test panradhukku. Seed data illa — customer, product, scheme, loan **ellaam
neengaladhaan create pannuveenga**. Adhaan idhoda point: ovvoru screen-um,
ovvoru validation-um, ovvoru button-um neenga sondhamaa thodra maadhiri.

> **Vera oru guide-um irukku.** DEMO seed org-a (8 customer, 4 product, 3 branch
> ready-a irukku) vechu vega vegama test pannanumna
> [TESTING-GUIDE-TA.md](TESTING-GUIDE-TA.md) use pannunga. Rendum thaniya —
> confuse aagaadheenga. Intha file **புthu org-kku mattum**.

Tick panra checklist: [TESTING-CHECKLIST-NEWORG-TA.md](TESTING-CHECKLIST-NEWORG-TA.md)

**Neram:** full sweep ~5–7 mani neram (setup-um neenga dhaan panreenga,
adhanaala DEMO guide-a vida konjam jaasthi). Flow-flow-a pirichukalaam — aana
**order mukkiyam**, Flow 1-la irundhu varisaiya poganum. Customer illaama loan
create panna mudiyaadhu.

---

## Part 0 — App-a start panradhu

Full setup [START-THE-APP.md](START-THE-APP.md) la. Inga surukkama:

```bash
createdb lms_dev

pnpm install
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env
```

`apps/api/.env` la:

```
DATABASE_URL="postgresql://postgres:<un-password>@localhost:5432/lms_dev?schema=public"
AUTH_JWT_SECRET="<kammiya 32 characters>"
WEB_ORIGIN="http://localhost:3000"
ALLOW_PUBLIC_SIGNUP=true
```

### ⚠️ `ALLOW_PUBLIC_SIGNUP=true` — idhu kandippa vேnum

Idhu illaama `/signup` page **404** kaattum. Signup off-a irundha andha endpoint
irukkurathே theriyaadhu (vேnumnu adhை appadi design pannirukku).

```bash
pnpm --filter @lms/api db:generate
pnpm --filter @lms/api db:migrate:deploy
pnpm --filter @lms/api db:seed
pnpm dev
```

> **Seed-a run pannanumaa?** Puthu org-kku seed **vேndave vேndaam**. Aana
> automated e2e test run pannanumna adhukku DEMO seed vேnum. Rendum onnukkonnu
> thodarbu illa — seed run pannaalum unga puthu org-a adhu thoduvadhே illa.

| App | URL                               |
| --- | --------------------------------- |
| Web | http://localhost:3000             |
| API | http://localhost:3001 (`/api/v1`) |

---

## ⚠️ Moonu vishayam — idhu bug illa

### 1. Rate limit (429)

- API — **60 request / nimisham** (dashboard 240)
- Signup — **3 / nimisham / IP** (romba strict, vேnumnu)

Vega vegama click panna, illa moonu vaati signup panna, `429` varum. **Bug illa.**
Oru nimisham wait panni retry pannunga.

### 2. Super Admin-kku moonu permission illa

Puthu org-oda Super Admin-kku **vேnumnu** idhu kudukala:

- `field.checkin` — Field Employee mattum check-in pannanum
- `recovery.writeoff.post` — write-off system-la mikka irreversible act
- `retention.purge.run` — purge record-a azhikkum

**Design decision, bug illa.** Report panna vேndaam.

### 3. Branch address "Not set" nu irukkum

Signup form la branch detail kekkala (5 field mattum vேnum-nu). Adhanaala server
`MAIN` / "Head Office" nu oru branch create pannum, address `Not set`,
pincode `000000`. **Flow 2-la neenga adhை sari panneenga.**

---

## Part 1 — 🌟 Flow 0: Signup (idhula dhaan aarambam)

**Enga:** http://localhost:3000/signup

### Form la enna kekkum

| Field               | Enna kudukanum                                                               |
| ------------------- | ---------------------------------------------------------------------------- |
| Organization Name * | `Kestrel Finance` (unga ishtam)                                              |
| Organization Code * | `KESTREL` — **letters, digits, hyphen, underscore mattum**. Space koodaadhu. |
| Your Name *         | `Asha R`                                                                     |
| Mobile Number *     | `9876543210` — 10 digit, 6-9 la aarambikkanum                                |
| Password *          | `Falcon9Ridge2026` maadhiri — **12+ character, digit + upper + lower**       |
| Confirm Password *  | Same password                                                                |

**Create organization** button click pannunga.

### Enna nadakkanum

1. `/signin?orgCode=KESTREL` ku redirect aagum
2. **Organization Code already fill aagirukkum** — and **UPPERCASE**-la irukkum
   (`kestrel` nu type panninaalum `KESTREL` nu save aagum)
3. Mobile + password kudunga → login aagum → dashboard varum

### 🔍 Idha check pannunga

| Check                                            | Edhirparadhu                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Org code lowercase-la type pannunga (`kestrel`)  | Signin page-la `KESTREL` nu varum                                                                |
| Adhே code-a thirumba signup panna try pannunga   | **Field-la error** varanum: "That organization code is already taken." **Banner illa, 503 illa** |
| Password `abc123` nu kudunga                     | Password field-la policy error varanum                                                           |
| Confirm password veaera-a kudunga                | "Passwords do not match" — **confirmPassword field-la**, password field-la illa                  |
| Moonu vaati signup panni naalavadhu try pannunga | **429** — oru nimisham wait                                                                      |
| Mandatory field kaali vitrunga                   | Ovvoru field-kum thani error                                                                     |

### 🔍 Login aana appuram — org kaali-yaa irukkaa?

Dashboard vandhadhukku appuram idha check pannunga. **Ellaam kaali-yaa
irukkanum:**

| Enga                  | Edhirparadhu                                        |
| --------------------- | --------------------------------------------------- |
| `/customers`          | **Kaali** — empty state message varanum, error illa |
| `/loans/products`     | **Kaali**                                           |
| `/loans/schemes`      | **Kaali**                                           |
| `/loans/applications` | **Kaali**                                           |
| `/overdues`           | **Kaali**                                           |

Kaali-ya irundhaalum **clean empty state** varanum — "No customers yet" maadhiri.
Blank white screen, illa error vandha adhu **P1**.

### 🔍 Mandatory data provision aagirukkaa?

Idhu dhaan signup-oda asli test. Ellaam **irukkanum:**

| Enga                             | Edhirparadhu                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| `/roles`                         | **3 role** — Super Admin, Branch Admin, Field Employee                               |
| `/roles` la Super Admin          | **System role** nu badge/indicator irukkanum. Delete option irukka koodaadhu         |
| `/settings/master-data`          | **26 value**, 4 category (Document Type 5, Gender 4, Relationship 8, Loan Purpose 9) |
| `/finance/accounts`              | **8 account** — 1100, 1200, 1210, 1220, 4100, 4200, 4300, 5100                       |
| `/admin/notifications/templates` | **16 template**                                                                      |
| `/admin/notifications/rules`     | **14 rule**                                                                          |
| `/branches`                      | **1 branch** — `MAIN` / Head Office                                                  |
| `/users`                         | **1 user** — neenga                                                                  |
| `/admin/audit`                   | **1 entry** — `ORG_SIGNUP_COMPLETED`                                                 |

> 🌟 **Edhaavadhu onnu illana adhu P0.** Master data illana customer form-oda
> Gender dropdown kaali-ya irukkum — form-e use panna mudiyaadhu. Ledger account
> illana modhal disbursal-la 409 varum, aana andha error ledger-la varum, adhu
> provisioning problem nu theriyaadhu.

### 🔍 Audit trail

`/admin/audit` ku pogunga. **Modhal entry `ORG_SIGNUP_COMPLETED`** aa irukkanum.
Adhை open panna:

- Actor = **neenga** (signup panna Super Admin — self-referential, sari dhaan)
- Metadata la counts irukkum: permissions 167, roles 3, grants 278, masterData 26,
  accounts 8, templates 16, eventRules 14
- IP address irukkanum

---

## Part 2 — Eppadi test panradhu

### Rendu browser window

Modhalla **oru window podhum** (Super Admin). Flow 4-la Branch Admin create
panna appuram, **rendaavadhu window** (incognito) thevaipadum — scope test-kku.

| Window      | Yaaru                                   | Eppo thevai         |
| ----------- | --------------------------------------- | ------------------- |
| Normal      | Super Admin (signup panna account)      | Aarambam-la irundhu |
| Incognito   | Branch Admin (neenga create panradhu)   | Flow 4-kku appuram  |
| Moonaavadhu | Field Employee (neenga create panradhu) | Flow 10-kku appuram |

### DevTools eppovum open

`F12`. Rendu tab:

- **Console** — sivappu error irukkaa?
- **Network** — status column:
  - `500` / `503` → **serious**. URL + request body + response body copy pannunga
  - `403` → permission illa. Sari-yaana-nu yosikkanum
  - `429` → rate limit, wait pannunga
  - `404` → route illa, bug

> 💡 Intha codebase-la **pala database error-um `503`-aa** dhaan theriyum,
> message onnu maadhiri irukkum ("Authentication service unavailable" maadhiri).
> Adhanaala `503` vandha message-a mattum nambaadheenga — **URL, request body,
> response body moonaiyum** copy pannunga.

### Severity

| Level  | Enna maadhiri                                                                                     |
| ------ | ------------------------------------------------------------------------------------------------- |
| **P0** | Data thappu, security leak (vera branch data theriyudhu), screen open aagala, audit record aagala |
| **P1** | Flow mudikka mudiyala, save aagala, wrong error message                                           |
| **P2** | UI polish — alignment, dark mode, mobile, loading spinner illa                                    |

### Bug note panra vidham

1. URL · 2. Role · 3. Enna panneenga (step by step) · 4. Enna edhirparthinga ·
2. Enna nadandhadhu · 6. Screenshot · 7. Console/Network error

---

## Part 3 — Setup flows (idhை modhalla mudinga)

Puthu org kaali. Loan test pannanumna, modhalla **branch → role → user →
product → scheme → customer** create pannanum. Intha order-la dhaan.

---

### Flow 1 — Branch setup

**Yaaru:** Super Admin · **Enga:** `/branches`

#### 1a. MAIN branch-a sari pannunga

1. `/branches` → `MAIN` mattum irukkum
2. Adhை click panni **edit** pannunga
3. Address `Not set` nu irukkum — **real address kudunga**:
   - Address * → `12 Anna Salai`
   - City * → `Chennai`
   - State * → `Tamil Nadu`
   - Pincode * → `600002`
4. **Save changes**

> **Branch Code edit panna mudiyaadhu** — create panna appuram read-only.
> Adhu sari dhaan, bug illa.

#### 1b. Rendaavadhu branch create pannunga (scope test-kku mukkiyam)

1. `/branches/new`
2. Fill pannunga:
   - Branch Code * → `BR002`
   - Branch Name * → `Coimbatore Branch`
   - Address * → `45 Avinashi Road`
   - City * → `Coimbatore` · State * → `Tamil Nadu` · Pincode * → `641018`
   - Branch Status * → `Active`
3. **Create branch**

#### 1c. Moonaavadhu branch (delete test-kku)

1. `/branches/new` → `BR003` / `Madurai Branch` / edhaavadhu address
2. **Idhula onnume attach panna koodaadhu** — user illa, customer illa.
   Idhu delete test panradhukku mattum.

#### 🔍 Check

- [ ] Duplicate code (`BR002` thirumba) → clean error, 503 illa
- [ ] Mandatory field kaali → ovvoru field-kum error
- [ ] Branch **deactivate** pannunga → appuram andha branch-la customer create
      panna mudiya koodaadhu
- [ ] `BR003` **delete** → aaganum ✅ (child illa)
- [ ] `MAIN` **delete** try → **refuse aaganum** (unga user adhula irukku).
      Error message clear-a irukkanum — generic 503 vandha **P1**

---

### Flow 2 — Roles

**Yaaru:** Super Admin · **Enga:** `/roles`

1. `/roles` → **3 role** irukkum (Super Admin, Branch Admin, Field Employee)
2. **Super Admin** open pannunga → system role, **delete option irukka koodaadhu**
3. `/roles/new` → puthu role:
   - Role Code * → `AUDITOR` (**uppercase, digit, underscore mattum**)
   - Role Name * → `Auditor`
   - Description → `Read-only access for audit review`
4. **Create role** → **draft-a create aagum**
5. Detail page-la **permission assign** pannunga — module-wise checkbox grid.
   `audit.view`, `reports.dashboard.view` maadhiri konjam select pannunga
6. **Save permissions** → appuram **activate** pannunga

#### 🔍 Check

- [ ] Lowercase role code (`auditor`) → refuse aaganum
- [ ] Permission onnum select pannaama activate panna → refuse aaganum
- [ ] Super Admin role-la permission remove panna try → refuse aaganum
      (system role protection)
- [ ] Andha role-a delete pannunga → aaganum (yaarukkum assign pannala)

---

### Flow 3 — Users & Employees

**Yaaru:** Super Admin · **Enga:** `/users`, `/employees`

#### 3a. Branch Admin create (BR001/MAIN)

1. `/users/new`
   - Full Name * → `Bala Kumar`
   - Mobile Number * → `9876543211`
   - Branch → `Head Office` (MAIN)
   - Roles * → `Branch Admin` check pannunga
   - Account Status * → `Pending — awaiting a password`
   - **Temporary Password** → `Falcon9Ridge2026`
   - **Confirm Password** → same
2. **Create user**

> 🌟 **Password kuduthaa enna nadakkum:**
>
> - Account **udanē `ACTIVE`** aagum. Status-la `Pending` nu select
>   panninaalum server `ACTIVE` aa maathidum — password irukku, adhanaala
>   `Pending` porundhaadhu.
> - Create panna appuram **password oru vaati screen-la kaattum**, copy
>   button-oda.
> - Andha password **thirumba paakka mudiyaadhu** — refresh panna poidum.
>   Server-la argon2 hash mattum irukku.
> - Andha user modhal login panna **kandippa password maathanum** — vera
>   entha screen-kkum poga mudiyaadhu (Flow 4-la test panreenga).
>
> ⚠️ **Password kudukkalana** account `PENDING` aa irukkum — adhu **login-um
> aagaadhu, forgot-password-um velai aagaadhu** (recovery ACTIVE/LOCKED mattum
> allow pannum). Andha account-a use panna vazhiyē illa. Adhanaala **password
> kudunga**.

#### 3b. Rendaavadhu Branch Admin (BR002)

Same maadhiri, aana:

- Full Name → `Chitra Devi` · Mobile → `9876543212`
- Branch → `Coimbatore Branch` (BR002)
- Roles → `Branch Admin`

**Idhu dhaan scope test-kku key** — BR002-oda admin, BR001 data paakka koodaadhu.

#### 3c. Field Employee create

1. `/employees/new`
   - Full Name * → `Dinesh Kumar`
   - **Employee ID *** → `EMP001` (employee-kku mattum kekkum)
   - Mobile Number * → `9876543213`
   - Branch → `Head Office`
   - Roles * → `Field Employee`
   - Account Status * → `Pending`
2. **Create employee**

#### 🔍 Check

- [ ] Duplicate mobile → clean error
- [ ] Role select pannaama create → refuse
- [ ] Employee-kku Employee ID kaali vittu → refuse
- [ ] `/users/new`-la Account Status dropdown-la **`Active` option irukka
      koodaadhu** (Pending / Inactive mattum) — puthu account-kku password
      illa, adhanaala active-a start panna mudiyaadhu
- [ ] User **deactivate** pannunga → andha browser-la next click-la logout aaganum
      (live session revoke)

---

### Flow 4 — 🔒 Scope test (ippo dhaan panna mudiyum)

Ippo unga kitta rendu branch, rendu Branch Admin irukku. **Idhu dhaan puthu
org-la scope test panra idam.**

1. Incognito window-la **BR002 admin** (`9876543212`) login pannunga
   (password recovery pannitu)
2. `/branches` → **BR002 mattum theriyanum**, MAIN/BR003 theriya koodaadhu
3. `/users` → BR002 user mattum
4. URL-la direct-a MAIN branch-oda id-a podunga → **403 / not found**

> 🌟 Data theriñjaa **P0 security leak.**

Sidebar-um check pannunga:

- [ ] `/reports/financial` — Branch Admin-kku **vara koodaadhu**
- [ ] `/finance/reconciliation` — **vara koodaadhu**
- [ ] URL-la direct-a poga → **403**

---

### Flow 5 — Loan Products & Schemes

**Yaaru:** Super Admin · **Enga:** `/loans/products`

> ⚠️ Idhukku thani `/new` page **illa**. List page-lē **Add product** nu oru
> link irukkum, adhை click panna inline-a form virriyum.

#### 5a. Product

1. `/loans/products` → **Add product** click
   - Product Code * → `PROD-PERSONAL` (uppercase, digit, hyphen, underscore)
   - Product Name * → `Personal Loan`
   - Loan Type * → `Personal`
2. **Create Product** → **draft-a create aagum**
3. Detail page-la **activate** pannunga

Innoru product create pannunga — `PROD-BUSINESS` / `Business Loan` / `Business`.

#### 5b. Scheme

1. `/loans/schemes` → **Add scheme**
   - Loan Product * → `Personal Loan (PROD-PERSONAL)`
   - Scheme Code * → `SCH-PERS-RED`
   - Scheme Name * → `Personal Reducing 12%`
   - Interest Type * → `Reducing balance`
   - **Interest Rate (basis points) *** → `1200`
2. **Create Scheme** → draft

> 💡 **Basis points, percentage illa.** 12% = `1200`. `12` nu podaadheenga —
> adhu 0.12% aagum. Hint-um adhை sollum.

3. Detail page-la **duration option add pannunga** — `Monthly` / `12`
4. Appuram **activate** pannunga

#### 🔍 Check

- [ ] Duration add pannaama scheme activate panna → **refuse aaganum**
- [ ] Interest rate-la decimal (`12.5`) podunga → refuse (integer basis points mattum)
- [ ] Product-a **deactivate** pannunga → application wizard dropdown-la
      **vara koodaadhu**
- [ ] Duplicate product code → clean error

---

### Flow 6 — Customer & KYC

**Yaaru:** Super Admin · **Enga:** `/customers/new`

#### 6a. KYC customer (main path)

1. `/customers/new`
2. **Customer Type *** — rendu radio card. **Default select aagala** (vேnumnu).
   **KYC Customer** select pannunga
3. Fill:
   - Full Name * → `Anitha Raman`
   - Mobile Number * → `9100000001`
   - Email / Date of Birth / Gender → optional (Gender dropdown-la master data
     varanumnu check pannunga — **kaali-ya irundha P0**)
   - Branch * → `Head Office`
   - Address Line 1 * → `18 Gandhi Street` (matha address field optional)
4. **Create Customer**

#### 6b. KYC documents

Customer profile page-la KYC panel irukkum:

1. **Upload** — ID, Address, Photo (moonum vேnum)
2. **Mark Verified** — ovvondrukum
3. **Submit for Review** → status `SUBMITTED`
4. **Record Decision** → approve → customer `ACTIVE`

#### 6c. Edge case customers

| Customer                       | Enna panradhu                                                  | Edhukku                                 |
| ------------------------------ | -------------------------------------------------------------- | --------------------------------------- |
| `Chitra Devi` / `9100000003`   | KYC type, **document upload pannaadheenga**, approve panna try | **Refuse aaganum.** Aayiduchu-na **P0** |
| `Eswari Selvam` / `9100000005` | **Local Customer** type                                        | LOCAL flow                              |
| `Bhaskar Nair` / `9100000002`  | KYC, aana **Branch → Coimbatore (BR002)**                      | Flow 4 scope test-kku                   |

#### 🔍 Check

- [ ] Customer Type select pannaama submit → refuse
- [ ] Mandatory field kaali → **user-kku puriyara message** varanum.
      Raw enum message (`Invalid enum value`) vandha **P1**
- [ ] Duplicate mobile → warning panel + **Create anyway** button varanum
- [ ] Search: name, mobile, customer ID — moonulaiyum work aaganum
- [ ] LOCAL customer-a **KYC-kku convert** pannunga → aaganum.
      Thirumba KYC → LOCAL **poga mudiyaadhu** (one-way)
- [ ] 🔒 BR002 admin-a login panni `/customers` → **Bhaskar Nair mattum**,
      Anitha theriya koodaadhu

---

### Flow 7 — Guarantors

**Yaaru:** Super Admin

> ⚠️ `/guarantors` **read-only directory** — inga create panna mudiyaadhu.
> Guarantor-a **customer profile-la** irundhu dhaan add pannanum.

1. `/customers/<Anitha-oda-id>` ku pogunga
2. **Guarantors** section → **Add Guarantor**
   - Full Name * → `Gopal Raman`
   - Mobile Number * → `9876500401`
   - **Address *** → `22 Nehru Road, Chennai` (idhu **mandatory** — customer-oda
     address-a vida strict)
   - Relationship → `Spouse` (master data dropdown)
3. **Add Guarantor**
4. **Record Consent** button click pannunga
5. Document upload pannunga

#### 🔍 Check

- [ ] Address kaali vittu → refuse (customer form-la line 2 optional, aana
      guarantor-kku address mandatory)
- [ ] `/guarantors` directory-la andha guarantor varanum
- [ ] Search (name / mobile / customer) work aaganum
- [ ] **Deactivate** aaganum, aana **Remove/delete** — permission illa-na refuse

---

## Part 4 — 🌟 Money flows (asli test)

Ippo unga kitta customer, product, scheme ellaam irukku. **Idhu dhaan main test.**

---

### Flow 8 — 🌟 Loan Lifecycle

**Yaaru:** Super Admin · Customer: **Anitha Raman** (KYC approved)

#### 8a. Application (4-step wizard)

1. `/loans/applications/new`
2. **Step 1 — Customer**
   - Search box: `Anitha` type pannunga
   - Result list-la radio select pannunga
   - > Hint: "Only customers in your branch are listed" — adhanaala BR002
     > customer inga vara koodaadhu
3. **Step 2 — Loan Details**
   - Loan Type * → `Personal`
   - Loan Amount (₹) * → `100000`
   - Purpose * → master data dropdown (`Business expansion` maadhiri)
   - Purpose detail → optional, max 280
4. **Step 3 — Scheme & Terms**
   - Loan Scheme * → `Personal Reducing 12% (SCH-PERS-RED) — 12%`
   - Interest Type * → scheme-la irundhu **prefill aagum**
   - Interest Rate (% a year) * → prefill. **Maathina "Rate differs from the
     scheme" warning varanum**
   - Frequency * → `Monthly`
   - Duration (periods) * → `12` (scheme-la add panna duration mattum varum)
5. **Step 4 — EMI Preview**
   - **Calculate EMI** click → server round-trip
   - Schedule panel + Review block varum
6. **Create Draft** → application number **`APP-`**-la aarambikkum

#### 🔍 Wizard check

- [ ] Ovvoru step-lum mandatory kaali vittu **Next** → error, next step ku pogala
- [ ] 🌟 Step 4-la irundhu **Back** panni Step 2 ku pogunga → **data poga koodaadhu**
- [ ] Inactive product / scheme dropdown-la **vara koodaadhu**
- [ ] Scheme-la illaadha duration select panna mudiya koodaadhu

#### 8b. Approval

1. Application detail page → status `DRAFT` / `SUBMITTED`
2. Document upload + submit
3. **Credit assessment** record pannunga
4. 🌟 Assessment illaama sanction panna try → **refuse aaganum**
5. **Sanction** → number **`SL-`**
6. Sanction terms **snapshot aagum** — appuram scheme-la rate maathinaalum
   intha sanction-la pazhaya rate dhaan irukkum
7. **Agreement sign** record pannunga

#### 8c. Disbursal

1. `/loans/disbursements/new?applicationId=…` → page title "Schedule Disbursement"
2. **Loan summary read-only** — sanctioned amount inga theriyum.
   > ⚠️ **Amount edit panra field illa** — sanction letter-la irundhu varum.
   > Adhu sari dhaan
3. Fill:
   - Disbursement Date * → today
   - Disbursement Account * → `1200 Bank Account` maadhiri
   - Notes → optional
4. **Schedule Disbursement** → _"Scheduling moves no money"_
5. Appuram **record transfer** → **confirm** pannunga

#### 🌟 8d. Confirm panna appuram — moonu vishayam nadakkanum

| Check                                   | Enga                                                       |
| --------------------------------------- | ---------------------------------------------------------- |
| **Loan number `LN-`** create aaganum    | Loan detail page                                           |
| **Repayment schedule generate aaganum** | Loan detail — EMI count = 12, total = principal + interest |
| **Journal entry `JE-` varanum**         | `/finance/journals`                                        |
| **Ledger balance aaganum**              | `/finance/ledger` — debit total = credit total             |

> 🌟 **Intha naalula edhaavadhu fail aana P0.**

---

### Flow 9 — 🌟 Collection → Ledger → Reports

**Yaaru:** Super Admin · Flow 8 mudinja appuram

#### 9a. Collection

1. `/loans/collections/new?loanId=…` → "Collect EMI"
2. Header-la customer name, loan number, **Outstanding** amount varum
3. Fill:
   - Collected Amount * → EMI amount (illa **Pay in full** button click)
   - Collection Date * → today (Kolkata date default)
   - Payment Mode * → `Cash`
   - Notes → optional
4. **Allocation panel** live-a update aagum — penalty / interest / principal / fees
   split kaattum
5. **Post collection** → receipt **`RCP-<branch>-NNNNNN`**
   (per-branch sequence, adhanaala MAIN-kku separate, BR002-kku separate)

#### 🔍 Collection check

- [ ] EMI-ya vida **jaasthi** amount → **refuse aaganum**
- [ ] Payment Mode `UPI` illa `Bank transfer` select panna → **Payment Reference
      field mandatory aaganum**. Reference illaama submit aayiduchu-na **P1**
- [ ] Payment Mode `Cash` → reference field kaanaama pogum
- [ ] Rendu-moonu EMI due-a vitrunga, partial amount kudunga →
      **pazhaya EMI modhalla** allocate aaganum (oldest-first)
- [ ] Collection **reverse** pannunga → EMI thirumba UNPAID + reversal journal entry
- [ ] **Partial reversal mudiyaadhu** — full mattum

#### 🌟 9b. Number agreement — idhu dhaan asli test

Oru collection amount note pannunga: `____________`

Aaru idathula **same number** varanum:

| Enga                     | Enna                           |
| ------------------------ | ------------------------------ |
| `/loans/collections`     | Collection amount              |
| `/finance/journals`      | `JE-` entry, same amount       |
| `/finance/ledger`        | Cash account debit             |
| `/finance/trial-balance` | **Debit total = Credit total** |
| `/reports/collections`   | Same period, same total        |
| `/reports/financial`     | Same numbers                   |

> 🌟 **Rendu idathula veaera number vandha → P1 (illa P0).** Rendu screenshot-um
> edunga.

---

### Flow 10 — Field Operations (📱 375px)

**Yaaru:** Field Employee (`9876543213`, Flow 3-la create panniyirukkeenga)

DevTools device toolbar ON (`Ctrl+Shift+M`), width **375px**.

1. Password recovery panni login pannunga
2. **Sidebar-la kammi item mattum** irukkanum — Finance, Reports, Admin
   **theriya koodaadhu**
3. `/field/check-in` → GPS permission allow → check-in
4. `/field/collections` → collection create
5. `/field/cash-handovers/new` → **`CH-`** number
6. `/field/cash-reconciliation/new` → **`CR-`** number

#### 🔍 Check

- [ ] `/finance/journals` URL direct-a → **403**
- [ ] `/users` → **403**
- [ ] `/reports/*` → **403**
- [ ] 📱 375px-la table horizontal scroll aagudhu (page odayala)
- [ ] 📱 Button thumb-kku reach aagudhu, text padikka mudiyudhu
- [ ] 📱 768px, 1280px-lum sari-yaa irukku

---

### Flow 11 — Overdue & Recovery

**Yaaru:** Super Admin

> ⚠️ Unga loan innum overdue illa (due date varala). Overdue paakka **oru loan-a
> backdate pannanum** — puthu application create panni, disbursement date-a
> 3 maasam munnadi kudunga.

1. `/overdues` → backdate panna loan varanum
2. `/overdues/<loanId>` → evlo naal late, penal interest
3. `/recovery-cases` → case create → **`RC-`**
4. Case-kku user assign → appuram **vera user-kku reassign**
5. 🌟 **Assignment history-la rendum irukkanum** (append-only — pazhaya record
   delete aaga koodaadhu)
6. Recovery action record pannunga
7. 🌟 **Write-off** try pannunga → **refuse aaganum** (yaarukkume permission illa)

---

### Flow 12 — Reports & Dashboard

1. `/` → KPI widget load aaganum
   > ⚠️ 8 widget onnaa load aagum → rate limit thodalaam. Kadaisi widget error
   > kaattina, oru nimisham wait panni refresh. **Appovum error-na dhaan bug**
2. Ovvoru widget-um click → sari-yaana detail page, number match aaganum
3. Ellaa 9 report-um open pannunga:
   `/reports/dashboard`, `/portfolio`, `/applications`, `/disbursals`,
   `/collections`, `/field-collections`, `/financial`, `/overdue-recovery`, `/saved`
4. Date filter maathunga → number maaranum
5. **CSV export** → download aaganum, Excel-la special character sari-yaa varanum
6. Report save panni `/reports/saved`-la thirumba open pannunga

#### 🔒 Branch Admin check

- [ ] `/reports/financial` sidebar-la **illa**, URL direct-a → **403**
- [ ] Matha report-la **avanga branch data mattum**

---

### Flow 13 — Notifications

1. `/notifications` → Flow 8/9 vேlai-kku notification vandhirukkanum
2. Click → **unread → read**, badge count kuraiyanum
3. `/notifications/preferences` → maathi save
4. `/admin/notifications/templates` → **16 template**, onnai edit pannunga
5. `/admin/notifications/rules` → **14 rule**, enable/disable
6. `/admin/notifications/deliveries` → status (sent/failed)
7. Template disable panni andha event trigger pannunga → notification vara koodaadhu

---

### Flow 14 — Settings, Config Transfer & Audit

1. `/admin/settings/organization` → maathi save.
   🌟 **Org-level-la dhaan apply aaganum** — thappaana branch-kku mattum apply
   aana **P1**
2. `/admin/settings/branch` → branch override
3. `/admin/settings/operational` → save
4. `/admin/settings/retention` → **Purge run** try → **refuse aaganum**
5. `/admin/settings/transfer` → **export** → JSON download
   - 🔒 JSON-la **password / secret irukka koodaadhu**
6. Adhே file **import** → "already exists" conflict, silent overwrite koodaadhu
7. JSON-a udachu import → clean error, crash koodaadhu
8. 🌟 `/admin/audit` → **ovvoru maatramum inga irukkanum:**

| Action                         | Audit-la varanum                      |
| ------------------------------ | ------------------------------------- |
| Org signup                     | `ORG_SIGNUP_COMPLETED` (modhal entry) |
| Branch create/edit             | ✓                                     |
| Role create, permission assign | ✓                                     |
| User create, deactivate        | ✓                                     |
| Customer create, KYC approve   | ✓                                     |
| Product/scheme create          | ✓                                     |
| Loan sanction, disbursal       | ✓                                     |
| Collection, reversal           | ✓                                     |
| Settings change, config import | ✓                                     |

> 🌟 **Edhaavadhu onnu varala → P0.**

9. Audit detail → **yaaru / eppo / old value / new value** theriyanum

---

## Part 5 — Puthu org vs DEMO org

Intha rendu vishayam **puthu org-la mattum** test panna mudiyum:

| Enna                                               | Edhukku mukkiyam                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| Signup flow-e                                      | DEMO-la idhu test panna mudiyaadhu                                 |
| Empty state ellaa screen-lum                       | Seed org-la data irukku, adhanaala empty state paakkave mudiyaadhu |
| Draft → activate lifecycle (product, scheme, role) | Seed-la ellaam already active                                      |
| "Modhal customer" / "modhal loan" experience       | Onboarding UX sari-yaa irukkaa                                     |
| Provisioning correctness                           | 167 permission, 8 account, 26 master data — ellaam vandhirukkaa    |

Idhu **DEMO-la mattum** test panna mudiyum (seed fixture thevai):

| Enna                             | Yen                                               |
| -------------------------------- | ------------------------------------------------- |
| KYC `REVISION_REQUIRED` loop     | Seed-la CUST004 andha state-la irukku             |
| Cross-**organization** isolation | `OTHERORG` seed-la mattum irukku                  |
| Locked / inactive account login  | Seed-la andha fixture irukku                      |
| E2E automated suite              | `9000000013/14/15` storageState-a depend pannudhu |

---

## Part 6 — Idha bug-a report panna vேndaam

- **429 rate limit** — API 60/min, signup 3/min
- **Super Admin-kku moonu permission illa** — deliberate
- **Branch address "Not set"** — signup-la kekkala, Flow 1-la neenga sari panreenga
- **Password kudukkaama create panna account `PENDING` aagum** — adhu login-um
  aagaadhu, forgot-password-um velai aagaadhu. Bug illa, aana andha account use
  panna mudiyaadhu — password kudunga.
- **Product/scheme draft-a create aagum** — design, activate pannanum
- **Template leftover pages** — `/basic-tables`, `/blank`, `/line-chart`, `/bar-chart`
- **`docs/README.md` module status table stale** — documentation issue, app bug illa

---

## Part 7 — Bug report template

```
### Bug #__

| | |
|---|---|
| **Severity** | P0 / P1 / P2 |
| **Route** | /customers/new |
| **Role** | Super Admin |
| **Org** | KESTREL (fresh signup) |
| **Flow** | Flow 6, step 3 |

**Steps:**
1.
2.

**Edhirparthadhu:**

**Nadandhadhu:**

**Console error:**

**Network:** (500/503 vandha — URL, request body, response body)

**Screenshot:**
```

---

## Kadaisila

1. Bug-a severity varisaila (P0 → P1 → P2) sort pannunga
2. En kitta kudunga — fix panna plan pannuven

### Thirumba fresh-a aarambikkanumna

Innoru org code vechu **thirumba signup pannunga** (`KESTREL2` maadhiri).
Pazhaya org-a delete panna mudiyaadhu — audit log append-only, adhanaala
organization delete-e build pannala (deliberate). Puthu org create panradhu
dhaan vazhi.

Full-a clean vேnumna: database drop → migrate → seed → thirumba signup.
