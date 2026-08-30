# LMS Documentation

Everything that specifies the Loan Management System. Source of truth for development.

```
docs/
  README.md                 ← you are here (index + status)
  START-THE-APP.md          ← run it locally: Postgres, env, migrate, seed, dev
  START-HERE-PROMPT.md      ← ⭐ paste this into a new chat to begin development
  PROMPT-DEVELOPMENT.md     ← reusable per-story prompt, for every story after the first
  AUDIT-PROMPT.md           ← black-box UI audit prompt, for an agent with a browser
  TESTING-GUIDE-TA.md       ← manual testing walkthrough (Thanglish) — DEMO seed org
  TESTING-CHECKLIST-TA.md   ← printable tick-box checklist + bug log — DEMO seed org
  TESTING-GUIDE-NEWORG-TA.md      ← same, but starting from /signup with a fresh org
  TESTING-CHECKLIST-NEWORG-TA.md  ← its checklist
  _shared/                  cross-module contracts — read before writing any story
    Database-Schema.md        PostgreSQL schema, all tables + ER diagram
    State-Machines.md         Application / Loan / EMI / Collection / Approval states
    NFR.md                    scale, performance, offline, security, EOD, backup
  user-stories/             one folder per module, one file per screen/feature
    01 - Authentication & Session Management/
    ... 17 - Settings, Audit & Maintenance/
  reference/flows/          source flow diagrams (the origin of every story)
  guides/                   how the codebase itself is built
    TEMPLATE-GUIDE.md         what the base is and why
    NEW-PROJECT.md            step-by-step setup on the base
    ENTERPRISE-FOLDER-STRUCTURE.md
  adr/                      architecture decision records
```

---

## Reading order

1. `reference/flows/` — the diagrams every requirement traces back to.
2. `_shared/State-Machines.md` — the statuses all modules share.
3. `_shared/Database-Schema.md` — the tables and column contracts.
4. `_shared/NFR.md` — the non-negotiable cross-cutting rules.
5. The module folder you are working on.

---

## Testing the built app

The application is implemented end to end. To exercise it by hand:

1. [START-THE-APP.md](START-THE-APP.md) — get it running locally.
2. Pick a starting point — the two tracks are independent, do not mix them:

   | You want to…                                                           | Use                                                                                                                                                                       |
   | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | Exercise the flows quickly against ready-made data                     | [TESTING-GUIDE-TA.md](TESTING-GUIDE-TA.md) + [checklist](TESTING-CHECKLIST-TA.md) — signs in as the `DEMO` seed org (8 customers, 4 products, 3 branches)                 |
   | Test signup, onboarding, empty states and the draft→activate lifecycle | [TESTING-GUIDE-NEWORG-TA.md](TESTING-GUIDE-NEWORG-TA.md) + [checklist](TESTING-CHECKLIST-NEWORG-TA.md) — creates a fresh org at `/signup` and builds everything from zero |

   Both cover the same 13 operational flows and both call out the two things
   that look like defects but are not (the 60 req/min throttle, and the three
   permissions deliberately withheld from Super Admin). The fresh-org track
   additionally needs `ALLOW_PUBLIC_SIGNUP=true` in `apps/api/.env`, and takes
   longer because you create the branches, roles, users, products, schemes and
   customers yourself before any loan can exist.

   A few checks only work on one track: KYC revision loops, locked accounts and
   cross-_organization_ isolation need the seed fixtures, while signup itself,
   empty states and draft→activate can only be seen on a fresh org.

For an agent-driven black-box audit instead, use [AUDIT-PROMPT.md](AUDIT-PROMPT.md).

---

## Module status

> ⚠️ **The table below is stale.** It tracks _story documents written_, not code.
> Modules 10–17 are marked pending here but are all implemented and covered by
> the Playwright suite in `apps/web/e2e/`. Treat this as a spec-coverage table,
> not a build-status one.

|   # | Module                                 | Stories | Status     |
| --: | -------------------------------------- | ------: | ---------- |
|  01 | Authentication & Session Management    |       7 | ✅ Done    |
|  02 | Organizations & Branches               |       1 | ✅ Done    |
|  03 | Users, Roles & Permissions             |       1 | ✅ Done    |
|  04 | Customers & KYC                        |       1 | ✅ Done    |
|  05 | Guarantors                             |       0 | ➖ Merged  |
|  06 | Loan Products & Configuration          |       1 | ✅ Done    |
|  07 | Loan Applications                      |       1 | ✅ Done    |
|  08 | Approval Workflow                      |       1 | ✅ Done    |
|  09 | Disbursal                              |       1 | ✅ Done    |
|  10 | Repayment Schedule                     |       0 | ⬜ Pending |
|  11 | EMI Collection                         |       0 | ⬜ Pending |
|  12 | Field Collection & Cash Reconciliation |       0 | ⬜ Pending |
|  13 | Overdue & Recovery                     |       0 | ⬜ Pending |
|  14 | Accounting & Ledger                    |       0 | ⬜ Pending |
|  15 | Reports & Analytics                    |       0 | ⬜ Pending |
|  16 | Notifications                          |       0 | ⬜ Pending |
|  17 | Settings, Audit & Maintenance          |       0 | ⬜ Pending |

**12 of 17 modules have no stories yet.** Modules 06–17 are empty folders.

Module 05 is marked _merged_ rather than pending: the Customers & KYC story
defines guarantors as part of the customer record — linked to a customer, with
their own consent and their own document store — so they were built with Module
04 rather than as a separate module. What Module 05 would still own is the rule
deciding _when_ a guarantor is required, and the story places that with the loan
product (Rules 16, 17), so it belongs to Loan Management rather than here.

All 7 stories in module 01 are implemented end to end, most recently
Field-Employee-GPS-Check-in. Offline caching and synchronization remain
unbuilt — see the known deviation in
[OPEN-QUESTIONS.md](OPEN-QUESTIONS.md).

Module 02 is implemented: Company Settings, Branch Management with
activate/deactivate, and a delete guarded against downstream references, all
confined by organization and branch scope server-side. One deliberate exclusion
remains, recorded with reasoning in [OPEN-QUESTIONS.md §8](OPEN-QUESTIONS.md):
organization create/delete is not built, because no cross-tenant actor exists to
perform it. The inactive-branch guard is no longer uncalled — Module 04's
customer registration is its first real caller.

Module 03 is implemented: Admin Management, Employee Management, and Roles &
Permissions over one `users` table split by two permission families, with live
per-request authorization, a delegation subset rule and system-role protection.
Decisions are recorded in [OPEN-QUESTIONS.md §9](OPEN-QUESTIONS.md).

Module 04 is implemented: customer registration for both KYC and LOCAL types,
search by name/ID/phone, the KYC document and review workflow with its revision
loop, guarantors with consent, LOCAL→KYC conversion, and a delete guarded against
financial history. KYC documents are stored outside the web root and are
reachable only through an endpoint that re-checks scope and audits the read; a
LOCAL customer's mobile is verified by a real OTP. The 41 questions the story
left open are answered in [OPEN-QUESTIONS.md §15](OPEN-QUESTIONS.md). Two areas
are deliberately out of scope and recorded there: the offline scenarios (42-44),
which the story itself marks unresolved, and document retention, which is blocked
on the statutory-retention question `Q-AUDIT-11`.

---

## Starting development

**First session — start here.** Open a new chat at the project root and paste the
prompt from [START-HERE-PROMPT.md](START-HERE-PROMPT.md). It reads the specs, sets
up PostgreSQL + Prisma, builds the backend and frontend auth foundation, and
delivers the Sign-In story end to end.

**Every story after that.** Use [PROMPT-DEVELOPMENT.md](PROMPT-DEVELOPMENT.md) — a
reusable prompt that builds any single story as a full-stack vertical slice:
shared contracts, Prisma models, NestJS API, Next.js UI, and tests derived from
the story's Gherkin scenarios.

Sign-In comes first because it has no upstream dependency and lays the auth,
database, scope and audit foundation the other 16 modules assume.

Stories are ready for modules 01–03 (9 files). Modules 04–17 need stories written
before they can be built.

---

## Conventions

- **File naming** — `Kebab-Case-With-Hyphens.md`. No spaces.
- **Folder naming** — `NN - Module Name` (zero-padded, space-hyphen-space).
- **One file per screen or feature**, not one file per module. A module with six
  screens gets six files.
- **Never invent a requirement.** If the flow diagrams do not define it, it goes
  in `# Open Questions` at the bottom of the file.
