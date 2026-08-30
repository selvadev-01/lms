# LMS Manual Testing Guide — DEMO Seed Org (Thanglish)

Intha guide, LMS-a **browser la kai-yaala** full-a test panradhukku. Ovvoru flow-um
step by step irukku — yaaraa login pannanum, enga poganum, enna click pannanum,
enna nadakkanum-nu.

Idhu **`DEMO` seed organization**-a vechu test panradhukku — 8 customer, 4 product,
5 scheme, 3 branch ellaam ready-a irukkum, adhanaala udanē flow test panna
aarambikkalaam.

> **Puthu organization create panni, zero-la irundhu test pannanumaa?**
> [TESTING-GUIDE-NEWORG-TA.md](TESTING-GUIDE-NEWORG-TA.md) use pannunga —
> `/signup`-la aarambichu, customer/product/scheme ellaam neengaladhaan create
> panreenga. Rendum thaniya, **kalandhu use panna vேndaam.**
>
> | Edhukku                                                | Enda guide                           |
> | ------------------------------------------------------ | ------------------------------------ |
> | Vega vegama flow check pannanum                        | **Intha file** (DEMO)                |
> | Signup / onboarding / empty state test pannanum        | New Org guide                        |
> | Draft → activate lifecycle paakkanum                   | New Org guide                        |
> | KYC revision loop, locked account, cross-org isolation | **Intha file** (seed fixture thevai) |
> | Automated e2e suite run pannanum                       | **Intha file** (DEMO seed thevai)    |

Tick panra checklist thani file la irukku: [TESTING-CHECKLIST-TA.md](TESTING-CHECKLIST-TA.md).
Intha guide-a **onnu-rendu vaati padichuttu**, appuram checklist-a vechukittu
test pannunga.

**Neram:** full sweep-kku ~4–6 mani neram. Oru naal la mudikka mudiyaadhu-na,
flow-flow-a pirichukalaam — ovvoru flow-um thaniya nikkum.

---

## Part 0 — App-a start panradhu

Full setup steps [START-THE-APP.md](START-THE-APP.md) la irukku. Inga surukkama:

### Onnu — Postgres

`lms_dev` nu oru empty database venum. Repo la `docker-compose.yml` illa, adhanaala
Postgres-a neenga dhaan start pannanum.

```bash
createdb lms_dev
```

### Rendu — Env files

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env
```

`apps/api/.env` la idha set pannunga:

```
DATABASE_URL="postgresql://postgres:<un-password>@localhost:5432/lms_dev?schema=public"
AUTH_JWT_SECRET="<kammiya 32 characters>"
WEB_ORIGIN="http://localhost:3000"
```

`AUTH_JWT_SECRET` illana API **start aagaadhu**. Adhukku default value kidaiyaadhu.

### Moonu — Database

```bash
pnpm --filter @lms/api db:generate
pnpm --filter @lms/api db:migrate:deploy
pnpm --filter @lms/api db:seed
```

> ⚠️ **`npx prisma generate` nu thaniya run panna koodadhu.** Kandippa
> `db:generate` dhaan use pannanum — adhu appuram oru CJS patch step
> (`scripts/patch-prisma-client.mjs`) run pannum. Adha skip panna, ellaa Jest
> test-um `import.meta` error-oda udanjidum.

Seed idempotent — thirumba thirumba run pannalaam, prachanai illa.

### Naalu — Run

```bash
pnpm dev
```

| App           | URL                                             |
| ------------- | ----------------------------------------------- |
| Web (Next.js) | http://localhost:3000                           |
| API (NestJS)  | http://localhost:3001 — routes `/api/v1` keezha |

---

## ⚠️ Rendu vishayam — idhu bug illa, therinjukkonga

### 1. Rate limit (429)

API la **60 request / oru nimisham** limit irukku (dashboard controller mattum
240/min). Neenga vega vegama click pannaa, sidebar la vegama page maathinaa,
`429 Too Many Requests` varum. Page konjam vெறumaya theriyum, illa error
kaattum.

**Idhu bug illa.** Rate limit dhaan. 1 nimisham wait panni refresh pannunga.

Dashboard la 8 widget onna load aagum — adhu limit-a thoduthudum. Adhanaala
dashboard-la kadaisi widget-gal "load aagala" nu therinja, modhalla oru nimisham
wait panni refresh pannunga. Appovum varudhu-na dhaan bug.

### 2. Super Admin-kku 3 permission illa

Super Admin-kku **vேணumnu** intha 3 permission koduka-la:

- `field.checkin`
- `recovery.writeoff.post`
- `retention.purge.run`

Adhanaala Super Admin-a intha vேlai-ya panna mudiyaadhu. **Idhu design decision,
bug illa.** Report panna vேndaam.

---

## Part 1 — Login credentials

Login-kku **moonu vishayam** venum: Organization Code + Mobile Number + Password.
Email login kidaiyaadhu.

- Organization code: **`DEMO`**
- Password (ellarukkum onnu dhaan): **`Kestrel7Vault`**

### Main-a intha 4 account-a use pannunga

| Role               | Mobile       | Scope — enna paakka mudiyum                                                         |
| ------------------ | ------------ | ----------------------------------------------------------------------------------- |
| **Super Admin**    | `9000000001` | Full organization. Ellaa branch-um, ellaa screen-um.                                |
| **Branch Admin A** | `9000000002` | `BR001` (Chennai Main) mattum. Padikka mudiyum, aana pala maatram panna mudiyaadhu. |
| **Branch Admin B** | `9000000003` | `BR002` (Coimbatore) mattum.                                                        |
| **Field Employee** | `9000000004` | `BR001`. Collections, cash handover, GPS check-in mattum.                           |

### Kai vaikka koodaadha account-gal

`9000000013`, `9000000014`, `9000000015` — idhu **e2e test suite** use panra
account. Ivatha vechu login panna vேndaam, password maathavum vேndaam. Illana
automated test ellaam fail aagum.

`9000000005`–`9000000022` la mathadhu ellaam test fixture — vேணumnu `INACTIVE`,
`LOCKED`, `PENDING` nu vechirukkaanga.

### Innoru organization

`OTHERORG` nu innoru org irukku. Adhula same mobile `9000000001` la innoru admin
irukku. Idhu **tenant isolation** test panradhukku — `DEMO` la irukkuradhu
`OTHERORG` la theriya koodaadhu, vice versa.

---

## Part 2 — Seed data cheat sheet

Test panradhukku ready-a irukkura data. **Idha delete panna koodaadhu** — e2e
test suite idha depend pannirukku. Neenga puthusa create panradhu ellaam
delete pannalaam.

### Branches

| Code    | Name         | Note                                                                      |
| ------- | ------------ | ------------------------------------------------------------------------- |
| `BR001` | Chennai Main | Main branch. Ellaa customer/loan-um inga.                                 |
| `BR002` | Coimbatore   | Cross-branch scope test panradhukku.                                      |
| `BR003` | Madurai      | **Kaali branch** — child illa. Delete test panradhukku idha use pannunga. |

### Customers — edhu edhukku

| Code      | Name           | Branch | Status                           | Edhukku use panradhu                                             |
| --------- | -------------- | ------ | -------------------------------- | ---------------------------------------------------------------- |
| `CUST001` | Anitha Raman   | BR001  | KYC APPROVED, ACTIVE             | ✅ **Happy path.** Ellaa loan flow-um idha vechu pannunga.       |
| `CUST002` | Bhaskar Nair   | BR002  | KYC APPROVED, ACTIVE             | Branch scope test — BR001 admin-kku idhu **theriya koodaadhu**.  |
| `CUST003` | Chitra Devi    | BR001  | KYC SUBMITTED, document **illa** | Document illama approve panna try pannunga → **refuse aaganum**. |
| `CUST004` | Dinesh Kumar   | BR001  | REVISION_REQUIRED                | Revision loop test.                                              |
| `CUST005` | Eswari Selvam  | BR001  | LOCAL, verified, ACTIVE          | LOCAL customer flow.                                             |
| `CUST006` | Farhan Basha   | BR001  | LOCAL, mobile **verify aagala**  | Unverified state enna kaattudhu-nu paarunga.                     |
| `CUST007` | Gayathri Mohan | BR001  | LOCAL, verified                  | **LOCAL → KYC conversion** test panradhukku.                     |
| `CUST008` | Hari Prasad    | BR002  | KYC REJECTED, INACTIVE           | Delete pannalaam (financial history illa).                       |

Customer mobile numbers: `9100000001` – `9100000008` (CUST001 = ...001).

### Loan products

| Code            | Name          | Status                                                |
| --------------- | ------------- | ----------------------------------------------------- |
| `PROD-PERSONAL` | Personal Loan | Active                                                |
| `PROD-BUSINESS` | Business Loan | Active                                                |
| `PROD-GOLD`     | Gold Loan     | Active                                                |
| `PROD-VEHICLE`  | Vehicle Loan  | **INACTIVE** (withdrawn) — dropdown la vara koodaadhu |

### Loan schemes

| Code             | Note                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------- |
| `SCH-PERS-RED`   | Personal, reducing interest 12% — main-a idha use pannunga                            |
| `SCH-PERS-FLAT`  | Personal, flat 10%                                                                    |
| `SCH-BUS-RED`    | Business, reducing 18%                                                                |
| `SCH-GOLD-OLD`   | **INACTIVE** — dropdown la vara koodaadhu                                             |
| `SCH-GOLD-EMPTY` | Active, aana **terms onnume illa** — edge case, select panna enna aagudhu-nu paarunga |

### 📌 Loan seed la illa

**Loan application, disbursement, collection — onnume seed la illa.** Ellaam
neenga dhaan create pannanum. Adhanaala Flow 7 (loan lifecycle) modhalla
pannunga, appuram dhaan Flow 8 (collection) pannalaam.

---

## Part 3 — Eppadi test panradhu

### Rendu browser window vechukkonga

| Window           | Yaaru                           |
| ---------------- | ------------------------------- |
| Normal window    | **Super Admin** (`9000000001`)  |
| Incognito window | **Branch Admin** (`9000000002`) |

Rendulaiyum same screen-a open panni pakkam pakkama paarunga. Branch Admin-kku
enna theriyudhu, enna theriyala nu udane theriyum. Idhu dhaan permission test
panradhukku easy-aana vazhi.

Field Employee-kku moonaavadhu window (vera browser, illa vera profile) use pannunga.

### DevTools eppovum open-a vechukkonga

`F12` press pannunga. Rendu tab mukkiyam:

- **Console** — sivappu (red) error irukka? Adhu note pannunga.
- **Network** — status column paarunga:
  - `500` / `503` → **serious.** URL + request payload + response body copy pannunga.
  - `403` → permission illa. Sari-yaana-nu yosikkanum.
  - `429` → rate limit. Bug illa, wait pannunga.
  - `404` → route illa. Bug.

> 💡 Intha codebase la **pala vithamaana database error-um `503` aa dhaan
> theriyum**, message onnu maadhiri irukkum. Adhanaala `503` vandhaa
> "Authentication service unavailable" nu message vandhaalum, adhu auth
> prachanai-ya illama vera edhaavadhu-a irukkalaam. Adhanaala **URL,
> request body, response body — moonaiyum** copy pannunga. Message-a mattum
> nambaadheenga.

### Bug kandupidichaa enna note panradhu

Ovvoru bug-kum idha ezhudhunga:

1. **URL** — enda page la
2. **Role** — yaaraa login pannirundheenga
3. **Enna panneenga** — step by step, thirumba pannradhukku
4. **Enna edhirparthinga**
5. **Enna nadandhadhu**
6. **Screenshot**
7. **Console / Network error** — irundhaa

### Severity — evlo mukkiyam

| Level  | Enna maadhiri                                                                                                                     |
| ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| **P0** | Data thappaa irukku (number match aagala), security leak (vera branch data theriyudhu), screen-e open aagala, audit record aagala |
| **P1** | Flow-a mudikka mudiyala, button work aagala, save aagala, wrong error message                                                     |
| **P2** | UI polish — alignment, spacing, dark mode, mobile la konjam odanju irukku, loading spinner illa                                   |

---

## Part 4 — Flows

Order mukkiyam. **Flow 1 → 13 nu varisaiya pannunga.** Flow 7 mudikkaama Flow 8
panna mudiyaadhu (loan illaama collection panna mudiyaadhu).

---

### Flow 1 — Login & Session

**Yaaru:** ellaarum · **Enga:** `/signin`

1. Logout state la `/customers` nu type pannunga → `/signin` ku pogum, **and**
   login pannadhukku appuram thirumba `/customers` ku poganum. (Original path
   ninaivu vechukkanum.)
2. Thappaana password 5 vaati kudunga → account **lock** aaganum.
3. `9000000005` (INACTIVE) la login panna try pannunga → refuse aaganum.
4. `9000000006` (LOCKED) la login panna try pannunga → refuse aaganum.
5. Org code `OTHERORG`, mobile `9000000001` → vera user-a login aaganum
   (DEMO-oda Super Admin illa). Sidebar la DEMO data theriya koodaadhu.
6. **Forgot password** → `/forgot-password`. OTP **terminal la print aagum**
   (`SMS_PROVIDER=console` — API terminal-a paarunga). Andha OTP-a
   `/forgot-password/verify` la kudunga → `/reset-password` ku pogum.
7. Login panni `/change-password` → password maathunga.
   ⚠️ **Kavanam:** `9000000001` password-a maathaadheenga. Vேndumna `9000000007`
   (Password Changer) use pannunga — adhu idhukkaaga dhaan.
8. `/active-sessions` → session list varanum. Rendaavadhu browser la login
   pannunga → andha session-um list la varanum. Adha **revoke** pannunga →
   andha browser la next click la logout aaganum.

---

### Flow 2 — Organization & Branches

**Yaaru:** Super Admin

1. `/company-settings` → organization detail edit panni save pannunga.
2. `/branches` → moonu branch (BR001, BR002, BR003) varanum.
3. `/branches/new` → puthusa oru branch create pannunga (`BRZZ1` nu vechukkonga).
4. Andha branch-a edit panni, appuram **deactivate** pannunga.
5. `/branches/BR003` → **delete** pannunga. BR003 la child illa, adhanaala
   delete aaganum. ✅
6. `/branches/BR001` → **delete** panna try pannunga. Idhula customer, loan
   ellaam irukku → **refuse aaganum.** Error message clear-a irukkanum
   ("this branch has customers" maadhiri). Generic 503 vandhaa **P1**.

---

### Flow 3 — Users, Roles & Permissions

**Yaaru:** Super Admin

1. `/roles` → role list. `SUPER_ADMIN` **system role**, adha delete panna
   mudiyaadhu (option-e vara koodaadhu, illa refuse aaganum).
2. `/roles/new` → puthusa role create pannunga (`TESTZZ_ROLE`).
3. Andha role-kku konjam permission assign pannunga. Save pannunga.
4. `/users` → admin list. `/users/new` → puthu user create, andha role kudunga.
5. Andha user-a **deactivate** pannunga.
6. **Live session revoke test:** modhalla andha user-a innoru browser la login
   pannunga. Appuram Super Admin window la avara deactivate pannunga. Andha
   browser la next click la **logout aaganum.**
7. `/employees` → employee list, create, edit.
8. **Delegation rule:** Branch Admin-a login panni `/roles` ku pogunga. Avarukku
   illaadha permission-a innoru user-kku kudukka mudiya koodaadhu.

---

### Flow 4 — Customer & KYC

**Yaaru:** Super Admin (appuram Branch Admin la thirumba check)

1. `/customers` → 8 customer varanum (BR001 + BR002).
2. Search box la `Anitha` type pannunga → CUST001 varanum. Mobile
   `9100000001` la search pannunga → adhuvum varanum. Customer ID la search
   pannunga → varanum.
3. `/customers/new` → puthu KYC customer create pannunga (`CUSTZZ1` maadhiri
   oru name kudunga, appuram identify panna easy).
4. Mandatory field-a **kaaliya vittu** submit pannunga → ovvoru field-kum
   error message varanum. Raw enum message (`Invalid enum value`) vandhaa
   **P1** — user-kku puriyara message venum.
5. Document upload pannunga (PNG/PDF). Upload aagudha paarunga.
6. KYC **submit** → status `SUBMITTED` aaganum.
7. KYC **approve** → status `APPROVED`, customer `ACTIVE` aaganum.
8. `/customers/CUST003` → idhula **document illa**. Approve panna try pannunga
   → **refuse aaganum.** Aaganum-nu solli approve aayidichu-na **P0**.
9. `/customers/CUST004` → `REVISION_REQUIRED`. Document thirumba upload panni
   resubmit pannunga.
10. `/customers/CUST007` (LOCAL) → **LOCAL → KYC conversion** pannunga.
    Onnu thaan direction — KYC → LOCAL thirumba போga mudiyaadhu.
11. `/customers/CUST008` → **delete** pannunga (financial history illa) ✅
12. `/customers/CUST001` → **delete** panna try pannunga. Idhula loan
    irundhaa **refuse aaganum.**
13. 🔒 **Scope test:** Branch Admin A (`9000000002`, BR001) la login pannunga.
    `/customers` la **CUST002 and CUST008 (BR002) theriya koodaadhu.**
    URL la direct-a `/customers/CUST002` nu போgunga → **403 / not found**
    varanum. Data theriñjaa **P0 security leak.**

---

### Flow 5 — Guarantors

**Yaaru:** Super Admin

1. `/guarantors` → list varanum.
2. Puthu guarantor create pannunga. Mobile `98765004xx` range vera edhaavadhu
   number kudunga (seed la use aagalai-nna).
3. Guarantor-a oru customer-oda **link** pannunga (CUST001).
4. **Consent** record aaganum.
5. Guarantor-oda **document** upload pannunga.
6. Guarantor detail page la **readiness** status paarunga — enna miss aagudhu-nu
   clear-a solla-numa.
7. Customer detail page (`/customers/CUST001`) la andha guarantor theriya-numa
   nu paarunga.

---

### Flow 6 — Loan Products & Schemes

**Yaaru:** Super Admin

1. `/loans/products` → 4 product varanum. `PROD-VEHICLE` **inactive** nu
   theriyanum.
2. `/loans/products` la puthu product create pannunga (`PRODZZ1`).
3. `/loans/schemes` → 5 scheme. `SCH-GOLD-OLD` inactive.
4. Puthu scheme create pannunga (`SCHZZ1`), interest type + rate + tenure
   kudunga.
5. **Edge case:** Loan application create panra pothu, `SCH-GOLD-EMPTY`
   select pannunga (adhula terms illa). App crash aaga koodaadhu — clean-aana
   message varanum, illa andha scheme dropdown la varave koodaadhu.
6. **Inactive test:** Loan application wizard la `PROD-VEHICLE` and
   `SCH-GOLD-OLD` dropdown la **vara koodaadhu.**

---

### Flow 7 — 🌟 Full Loan Lifecycle (main flow)

**Yaaru:** Super Admin · **Idhu dhaan romba mukkiyam.** Mella pannunga.

Customer: **CUST001 Anitha Raman**.

#### 7a. Application create

1. `/loans/applications` → list (kaaliya irukkalaam, seed la loan illa).
2. `/loans/applications/new` → **4-step wizard**.
3. **Step 1** — customer search. `Anitha` type pannunga. Server la search
   aagum, adhanaala konjam neram edukkum — spinner varanuma nu paarunga.
   CUST001 select pannunga.
4. **Step 2** — product + scheme select. `PROD-PERSONAL` + `SCH-PERS-RED`.
5. **Step 3** — amount, tenure kudunga.
6. **Step 4** — review. Ellaa detail-um sari-yaa theriyanum.
7. **Back button test:** Step 4 la irundhu Step 2 ku thirumba pogunga →
   **data poga koodaadhu.** Poyiruchu-na **P1**.
8. **Validation test:** Ovvoru step-lum mandatory field kaaliya vittu Next
   press pannunga → error varanum, next step ku **poga koodaadhu.**
9. Submit pannunga → application number `APP-` la aarambikkanum.

#### 7b. Approval

10. `/loans/applications/<id>` → status `SUBMITTED`.
11. **Credit assessment** create pannunga. Score / decision kudunga.
12. Assessment illaama sanction panna try pannunga → **refuse aaganum.**
13. Sanction pannunga → sanction number `SL-` la aarambikkanum.
14. Sanction terms (amount, rate, tenure) **snapshot** aagum — appuram product
    la rate maathinaalum, intha sanction la old rate dhaan irukkanum.
15. **Agreement sign** pannunga.
16. Reject flow-um test pannunga: **innoru** application create panni,
    adha **reject** pannunga → status `REJECTED`.

#### 7c. Disbursal

17. `/loans/disbursements/new` → sanction aana application select pannunga.
18. Disbursement mode select pannunga. **Bank transfer** select pannaa,
    reference number mandatory-a irukkanumaa nu paarunga. Reference illaama
    submit aayiduchu-na **P1** (idhu munnadi oru bug-a irundhadhu).
19. Disburse pannunga → loan number `LN-` la aarambikkanum.
20. ✅ **Repayment schedule generate aaganum.** Loan detail page la EMI list
    varanum. EMI count = tenure. Total = principal + interest.
21. ✅ **Ledger la journal entry varanum.** `/finance/journals` ku pogunga →
    `JE-` la aarambikkura entry irukkanum, andha disbursement-kku.
22. `/finance/ledger` → moonu account affect aagirukkanum (cash/bank, loan
    receivable, ...). Debit total = Credit total.

**Intha 3 check-um (schedule, journal, balanced ledger) fail aanaa — P0.**

---

### Flow 8 — 🌟 EMI Collection → Ledger → Reports

**Yaaru:** Super Admin · Flow 7 mudinjadhukku appuram dhaan.

#### 8a. Collection

1. `/loans/collections/new` → Flow 7 la create panna loan-a select pannunga.
2. Modhal EMI amount collect pannunga. Payment mode: Cash.
3. Submit → receipt number varanum. Format: **`RCP-<branch code>-NNNNNN`**
   (udhaaranam `RCP-BR001-000001`) — receipt number **branch-kku thaniya**
   run aagum, adhanaala BR001 and BR002 la separate sequence irukkum.
4. Loan detail page la andha EMI **PAID** nu maaranum.
5. **Overpay test:** EMI amount-a vida jaasthi amount kudunga → **refuse
   aaganum.** Accept aayiduchu-na **P1**.
6. **Allocation test:** Rendu-moonu EMI due-a vitrunga (Flow 10 la backdate
   pannalaam). Appuram partial amount collect pannunga → **pazhaya EMI
   modhalla** allocate aaganum (oldest-first).
7. **Reversal:** oru collection-a reverse pannunga → EMI thirumba UNPAID
   aaganum, **and** ledger la reversal journal entry varanum. **Partial
   reversal mudiyaadhu** — full mattum dhaan.

#### 8b. 🔢 Number agreement — idhu dhaan asli test

Oru collection panniteenga. Ippo **naalu idathula** andha number match
aaganum:

| Enga                     | Enna paakkanum                                |
| ------------------------ | --------------------------------------------- |
| `/loans/collections`     | Collection amount                             |
| `/finance/journals`      | Andha collection-oda `JE-` entry, same amount |
| `/finance/ledger`        | Cash account la andha amount debit            |
| `/finance/trial-balance` | Debit total = Credit total                    |
| `/reports/collections`   | Same period la same total                     |
| `/reports/financial`     | Same numbers                                  |

**Edhaavadhu rendu idathula number veaera-veaera irundhaa → P1 (illa P0).**
Andha rendu screenshot-um edunga.

---

### Flow 9 — Field Operations (📱 mobile width la pannunga)

**Yaaru:** Field Employee (`9000000004`)

DevTools la device toolbar on pannunga (`Ctrl+Shift+M`), width **375px** vechukkonga.
Field employee mobile la dhaan use panuvaanga.

1. Login → sidebar la **konjam item mattum** theriyanum (collections, cash
   handover, check-in). Finance, Reports, Admin **theriya koodaadhu.**
2. `/field/check-in` → GPS permission kekkum, allow pannunga. Check-in
   pannunga. Location record aaganum.
3. `/field` → field dashboard. Anaikku-nu collection list varanum.
4. `/field/collections` → collection create pannunga (Flow 7 loan-kku).
5. `/field/cash-handovers/new` → collect panna cash-a branch-kku handover
   pannunga. Number `CH-` la aarambikkanum.
6. `/field/cash-reconciliation/new` → reconciliation, number `CR-` la.
7. `/field/sync-queue` → queue screen open aaganum.
8. **375px la ovvoru screen-um paarunga:** table horizontal-a scroll aaguthaa,
   illa page-e odanjirukkaa? Button-gal thumb-kku reach aagudhaa? Text
   padikka mudiyudhaa?
9. Same screen-a **768px** (tablet) la paarunga.

---

### Flow 10 — Overdue & Recovery

**Yaaru:** Super Admin

1. `/overdues` → overdue loan list. Flow 7 loan **innum overdue illa** (due
   date varala). Adhanaala list kaaliya irukkalaam.
2. Overdue-a paakka, oru loan-a **backdate** pannanum — puthu application
   create panni, disbursement date-a 3 maasam munnadi kudunga. Appuram
   `/overdues` la varanum.
3. `/overdues/<loanId>` → overdue detail, evlo naal late, penal interest.
4. `/recovery-cases` → recovery case create pannunga → number `RC-` la.
5. Recovery case-kku oru user assign pannunga. Appuram vera oru user-kku
   reassign pannunga → **assignment history** la rendum irukkanum
   (append-only — pazhaya record delete aaga koodaadhu).
6. Recovery action add pannunga (visit, call maadhiri).
7. **Write-off** panna try pannunga → **refuse aaganum.** Intha permission
   yaarukkume illa (Super Admin-kkum illa). Aayiduchu-na **P0.**

---

### Flow 11 — Reports & Dashboard

**Yaaru:** Super Admin, appuram Branch Admin

1. `/` (landing dashboard) → KPI widget-gal load aaganum.
   ⚠️ 8 widget onna load aagum → rate limit thodalaam. Kadaisi widget error
   kaattinaa, oru nimisham wait panni refresh. Appovum error-na dhaan bug.
2. Ovvoru widget-lum **click** pannunga → sari-yaana detail page-kku poganum
   (drill-down). Andha page la number match aaganum.
3. `/branch` → branch dashboard.
4. Ellaa 9 report-um open pannunga:
   `/reports/dashboard`, `/portfolio`, `/applications`, `/disbursals`,
   `/collections`, `/field-collections`, `/financial`, `/overdue-recovery`,
   `/saved`
5. Ovvoru report-lum **date filter** maathunga → number maaranum.
6. **Export** pannunga (CSV). File download aaganum, Excel la open panna
   Tamil/special character correct-a theriyanum (BOM prachanai).
7. `/reports/saved` → oru report-a save panni, thirumba open pannunga.
8. 🔒 **Branch Admin check:** `9000000002` la login pannunga.
   - `/reports/financial` **sidebar la vara koodaadhu**, URL la direct-a
     போnaalum **403**.
   - Matha report la **BR001 data mattum** irukkanum. BR002 number
     theriñjaa **P0.**
   - `/finance/reconciliation` **theriya koodaadhu.**

---

### Flow 12 — Notifications

**Yaaru:** Super Admin

1. `/notifications` → notification list. Flow 7/8 la panna vேlai-kku
   notification vandhirukkanum.
2. Onna click pannunga → **unread → read** aaganum, badge count kuraiyanum.
3. `/notifications/preferences` → preference maathi save pannunga.
4. `/admin/notifications/templates` → template list, onna edit pannunga.
5. `/admin/notifications/rules` → event rule list. Oru rule-a
   enable/disable pannunga.
6. `/admin/notifications/deliveries` → delivery monitoring. Status
   (sent/failed) theriyanum.
7. Template-a disable panni, appuram andha event-a trigger pannunga →
   notification vara koodaadhu.

---

### Flow 13 — Settings, Config Transfer & Audit

**Yaaru:** Super Admin

1. `/admin/settings/organization` → org-level setting maathi save pannunga.
   ⚠️ Idhu **org-level** — save panna appuram, edhaavadhu branch-kku mattum
   apply aagi irundhaa **P1**.
2. `/admin/settings/branch` → branch-level override.
3. `/admin/settings/operational` → operational controls.
4. `/admin/settings/retention` → data retention policy. **Purge run** panna
   try pannunga → **refuse aaganum** (permission yaarukkume illa).
5. `/admin/settings/transfer` → **config export** pannunga → JSON file
   download aaganum. Adha open panni paarunga — password / secret
   maadhiri edhaavadhu irundhaa **P0.**
6. Andha file-a thirumba **import** pannunga → "already exists" nu conflict
   solla-num, silent-a overwrite panna koodaadhu.
7. Andha JSON-a konjam **udachu** (invalid) import pannunga → clean error
   varanum, per-entry problem list kaattanum. Crash aana **P1.**
8. `/admin/settings/changes` → configuration change history.
9. 🌟 `/admin/audit` → **idhu dhaan mukkiyam.** Mela panna ovvoru maatramum
   inga record aagirukkanum:
   - Settings change
   - User create/deactivate
   - Customer create, KYC approve
   - Loan sanction, disbursal
   - Collection, reversal
   - Config import

   **Edhaavadhu onnu audit la varala-na → P0.**

10. `/admin/audit/<id>` → audit detail. Yaaru, eppo, enna maathinaanga —
    old value + new value theriyanum.
11. `/admin/maintenance/jobs` → maintenance job list.

---

## Part 5 — Role permission check (kadaisila pannunga)

Flow 1–13 mudinjadhukku appuram, **same screen-a vera role la** thirumba
paarunga.

### Branch Admin A (`9000000002`, BR001)

- Sidebar la **Financial report** and **Reconciliation** vara koodaadhu.
- Ellaa list-lum **BR001 data mattum**. BR002 customer / loan / collection
  theriya koodaadhu.
- URL la direct-a BR002 record-a open panna try pannunga → **403 / not found**.
- Mutation button (create/edit/delete) — evlo theriyudhu? Theriyara button-a
  click panna work aagudhaa? **Button theriyudhu aana click panna 403** vandhaa
  adhu **P2** (button-e kaatta koodaadhu). **Button theriyala aana API la
  panna mudiyudhu** nu irundhaa adhu **P0**.

### Branch Admin B (`9000000003`, BR002)

- Adhே maadhiri, aana BR002 side la. BR001 data theriya koodaadhu.

### Field Employee (`9000000004`, BR001)

- Sidebar la **romba kammi item** dhaan irukkanum.
- `/finance/*`, `/reports/*`, `/users`, `/roles`, `/admin/*` — ellaam
  **403** varanum (URL la direct-a போnaalum).
- Collection, cash handover, check-in mattum work aaganum.

### Cross-organization (`OTHERORG` / `9000000001`)

- Login panni ellaa list-um paarunga. **DEMO data onnu koodaadhu.**
  CUST001, BR001, PROD-PERSONAL — onnume theriya koodaadhu.
- Theriñjaa **P0 — tenant leak.**

---

## Part 6 — Idha bug-a report panna vேndaam

### Template leftover pages

Intha page ellaam TailAdmin template-la irundhu vandhadhu, LMS-oda pakuthi
illa. Delete pannanum, aana **bug-a report panna vேndaam**:

- `/basic-tables`
- `/blank`
- `/line-chart`
- `/bar-chart`

Sidebar la "Others → Authentication" nu oru group irundhaa, adhuvum leftover.

### Vera vishayangal

- **429 rate limit** — Part 0 la sonna maadhiri, bug illa.
- **Super Admin-kku 3 permission illa** — deliberate.
- **`docs/README.md` la module status table stale** — module 10–17
  "Pending" nu irukku, aana ellaame build aagiduchu. Documentation issue,
  application bug illa.

---

## Part 7 — Bug report template

Ovvoru bug-kum idha copy panni fill pannunga:

```
### Bug #__

| | |
|---|---|
| **Severity** | P0 / P1 / P2 |
| **Route** | /customers/CUST003 |
| **Role** | Super Admin (9000000001) |
| **Flow** | Flow 4, step 8 |

**Steps:**
1.
2.
3.

**Edhirparthadhu:**

**Nadandhadhu:**

**Console error:**

**Network:** (500/503 vandha — URL, request body, response body)

**Screenshot:** [file name]
```

Ellaa bug-um oru table la sேrthu vekka, checklist file-oda kadaisila
bug log irukku.

---

## Kadaisila — enna panradhu

1. Bug list-a severity varisaila (P0 → P1 → P2) sort pannunga.
2. P0 ellaam modhalla fix pannanum.
3. Bug list-a en kitta kudunga — naan fix panradhukku plan pannuven.

**Test panradhukku munnadi** oru `git status` edunga, appuram test panradhukkaaga
create panna data (`CUSTZZ1`, `PRODZZ1`, `BRZZ1`, `TESTZZ_ROLE` maadhiri) enna
enna-nu ninaivu irukkum. Aduthadhaa fresh-a test panna vேndumnaa,
`pnpm --filter @lms/api db:seed` thirumba run pannunga — seed idempotent, aana
neenga create panna data delete aagaadhu. Full-a clean venumna database-a drop
panni thirumba migrate + seed pannunga.
