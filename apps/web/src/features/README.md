# Features

All business code for the web app lives here, one folder per LMS domain.

```
features/<domain>/
  api/          server-only read fetchers, built on src/lib/api-fetch.ts
  actions/      server actions, built on src/lib/api-call.ts
  components/   feature UI
  index.ts      the feature's public surface (see rule 1 for the limit)

  hooks/        optional — add when the feature needs one
  schemas/      optional — most features import @lms/validation directly
  types/        optional — shared types belong in @lms/types
  utils/        optional
```

The four optional folders are genuinely optional: `types/` is used by none of
the nine features, `schemas/` and `hooks/` by one each. That is the correct
outcome, not drift — types belong in `@lms/types` and Zod schemas in
`@lms/validation`, where `apps/api` can share them.

## Domains

| Folder          | Owns                                                |
| --------------- | --------------------------------------------------- |
| `auth`          | Sign in, session, password reset, permission guards |
| `customers`     | Customer records, KYC, customer documents           |
| `guarantors`    | Guarantor records, guarantor KYC and documents      |
| `loans`         | Products, schemes, applications, approval, sanction |
| `disbursements` | Disbursal, ledger, repayment schedule display       |
| `users`         | Admin and employee accounts                         |
| `organizations` | Organisation settings and branches                  |
| `master-data`   | Master data values                                  |
| `field`         | GPS check-in and field agent flows                  |

## Rules

1. **Import a feature through `@/features/<domain>`** — its `index.ts` — for
   components and read functions. Two documented exceptions:
   - **Actions are imported directly** from `@/features/<domain>/actions/...`.
     They cannot live in the barrel: the barrel re-exports the `server-only`
     `api/` module, so a client component importing an action through it pulls
     the read layer into the browser bundle and **fails the build**.
   - **A client component importing another feature's presentational component**
     must import the module directly, for the same reason. Comment the import
     when you do — see `GuarantorDetail.tsx`.

   Never import another feature's `api/` by path.

2. **Features never import each other's internals** beyond rule 1's exceptions.
3. **Cross-app code goes to `packages/`, not here.** Anything `apps/api` also
   needs belongs in `@lms/types`, `@lms/validation`, or `@lms/constants`.
4. **App-wide code with no domain goes to `src/lib/`.** Formatting
   (`lib/format.ts`) and transport (`lib/api-call.ts`, `lib/api-fetch.ts`) live
   there — no `server-only`, so client components can reach them. This is the
   escape hatch when rule 1 would otherwise force a cross-feature import.
5. **Promote UI on the third use.** A component moves to `@lms/ui` when a third
   feature needs it — two is a coincidence.
6. **`app/` holds routes only.** A `page.tsx` imports from a feature and does
   little else.
7. **Authorize in the data layer**, never in a component. Tenant/branch scoping
   is a query concern.

## Example

```ts
// features/customers/index.ts
export * from "./api/customers"; // server-only — this is what limits rule 1
export { default as CustomerList } from "./components/CustomerList";
export { CustomerStatusBadge } from "./components/CustomerStatusBadge";
```

```tsx
// app/(admin)/customers/page.tsx — a server component, so the barrel is fine
import { CustomerList, fetchCustomers } from "@/features/customers";

export const metadata = { title: "Customers" };

export default async function CustomersPage() {
  const result = await fetchCustomers(); // authorize inside fetchCustomers
  return <CustomerList customers={result.customers} />;
}
```

```tsx
// features/customers/components/CustomerForm.tsx — a CLIENT component
"use client";

// Direct, not through the barrel: the barrel re-exports server-only api code.
import { createCustomerAction } from "../actions/customer-actions";
import { formatPaise } from "@/lib/format"; // lib/ has no server-only
```
