/**
 * Gives an organization a minimal, working loan configuration.
 *
 * # Why this exists
 *
 * `prisma/seed.ts` builds products and schemes for the DEMO and OTHERORG
 * fixtures only. An organization created any other way — through signup, or the
 * provisioning path — gets users, roles, master data and a chart of accounts,
 * but **no loan products and no schemes**. That organization looks broken in a
 * way that points at the wrong thing: the application wizard's Loan Type
 * dropdown comes up empty, because it offers only types with a selectable
 * scheme behind them, and there are none.
 *
 * Configuration is normally an admin's job through Loan Products and Loan
 * Schemes. This is for the case where you need a working org *now* — a fresh
 * dev database, a demo, a tenant to test against — without clicking through
 * three screens first.
 *
 * # What it creates
 *
 * One product per loan type named below, one scheme under each, and the
 * duration options that make those schemes selectable. All three layers are
 * required: `selectable=true` filters out a scheme whose product is inactive,
 * whose own status is not ACTIVE, or which has no ACTIVE duration row — so a
 * product and scheme alone would still leave the wizard empty.
 *
 * Idempotent by `code`, so re-running repairs rather than duplicates.
 *
 *   pnpm --filter @lms/api exec tsx scripts/bootstrap-loan-config.ts TEST
 *
 * The argument is an organization *code*. Without one, every organization that
 * currently has no products is bootstrapped.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL as string,
  }),
});

/**
 * Deliberately small: two unsecured types, covering the reducing-balance and
 * flat interest paths and a mix of repayment frequencies.
 *
 * GOLD and VEHICLE are omitted on purpose. Both are seeded `requiresCollateral`,
 * so an application against one cannot be submitted until a COLLATERAL document
 * is attached — a sensible rule, and a confusing first experience for someone
 * who just wants to see the wizard work. Add them through the admin screens
 * when you want to exercise that gate.
 */
const CONFIG = [
  {
    product: {
      code: 'PROD-PERSONAL',
      name: 'Personal Loan',
      loanType: 'PERSONAL',
    },
    schemes: [
      {
        code: 'SCH-PERS-RED',
        name: 'Personal Reducing 12%',
        interestType: 'REDUCING' as const,
        // Integer basis points, never a float: 12.00% a year.
        interestRateBps: 1_200n,
        durations: [
          { frequency: 'MONTHLY' as const, durationCount: 6 },
          { frequency: 'MONTHLY' as const, durationCount: 12 },
          { frequency: 'MONTHLY' as const, durationCount: 24 },
        ],
      },
      {
        code: 'SCH-PERS-FLAT',
        name: 'Personal Flat 10%',
        interestType: 'FLAT' as const,
        interestRateBps: 1_000n,
        // Daily and weekly options exist so the EMI calculator's non-monthly
        // paths are reachable from the UI, not only from its unit tests —
        // matching the convention in `prisma/seed.ts`. The wizard's Frequency
        // dropdown offers only frequencies the chosen scheme has a term for, so
        // without a DAILY row here "Daily" cannot appear anywhere in the app.
        //
        // 100 rather than 365: the schedule table renders every installment as
        // a row, so a year-long daily term is a heavy screen for no extra proof.
        durations: [
          { frequency: 'DAILY' as const, durationCount: 100 },
          { frequency: 'WEEKLY' as const, durationCount: 52 },
          { frequency: 'MONTHLY' as const, durationCount: 12 },
        ],
      },
    ],
  },
  {
    product: {
      code: 'PROD-BUSINESS',
      name: 'Business Loan',
      loanType: 'BUSINESS',
    },
    schemes: [
      {
        code: 'SCH-BUS-RED',
        name: 'Business Reducing 18%',
        interestType: 'REDUCING' as const,
        interestRateBps: 1_800n,
        durations: [
          { frequency: 'MONTHLY' as const, durationCount: 12 },
          { frequency: 'QUARTERLY' as const, durationCount: 8 },
        ],
      },
    ],
  },
];

async function bootstrap(orgId: string, orgCode: string): Promise<void> {
  console.log(`\n${orgCode}`);

  for (const entry of CONFIG) {
    // The loan type must exist as an ACTIVE LOAN_TYPE option, exactly as the
    // API requires of a product created through the UI. Creating a product
    // whose type no dropdown offers would be a row nobody could edit.
    const type = await prisma.masterDataValue.findUnique({
      where: {
        orgId_category_code: {
          orgId,
          category: 'LOAN_TYPE',
          code: entry.product.loanType,
        },
      },
      select: { status: true },
    });

    if (type?.status !== 'ACTIVE') {
      console.log(
        `  skipped ${entry.product.code}: loan type ${entry.product.loanType} is ${type ? type.status : 'missing'}`,
      );
      continue;
    }

    const product = await prisma.loanProduct.upsert({
      where: { orgId_code: { orgId, code: entry.product.code } },
      update: { name: entry.product.name, status: 'ACTIVE' },
      create: {
        orgId,
        code: entry.product.code,
        name: entry.product.name,
        loanType: entry.product.loanType,
        status: 'ACTIVE',
      },
    });
    console.log(`  product ${product.code} (${entry.product.loanType})`);

    for (const spec of entry.schemes) {
      const scheme = await prisma.loanScheme.upsert({
        where: { orgId_code: { orgId, code: spec.code } },
        // Status re-asserted on every run for the same reason the seed does it:
        // a run that deactivated a scheme must not leave the next one
        // unselectable.
        update: {
          name: spec.name,
          interestType: spec.interestType,
          interestRateBps: spec.interestRateBps,
          status: 'ACTIVE',
        },
        create: {
          orgId,
          loanProductId: product.loanProductId,
          code: spec.code,
          name: spec.name,
          interestType: spec.interestType,
          interestRateBps: spec.interestRateBps,
          status: 'ACTIVE',
        },
      });

      for (const duration of spec.durations) {
        const existing = await prisma.loanSchemeDuration.findUnique({
          where: {
            orgId_loanSchemeId_frequency_durationCount: {
              orgId,
              loanSchemeId: scheme.loanSchemeId,
              frequency: duration.frequency,
              durationCount: duration.durationCount,
            },
          },
          select: { loanSchemeDurationId: true },
        });

        if (existing) {
          await prisma.loanSchemeDuration.update({
            where: {
              orgId_loanSchemeDurationId: {
                orgId,
                loanSchemeDurationId: existing.loanSchemeDurationId,
              },
            },
            data: { status: 'ACTIVE' },
          });
        } else {
          await prisma.loanSchemeDuration.create({
            data: {
              orgId,
              loanSchemeId: scheme.loanSchemeId,
              frequency: duration.frequency,
              durationCount: duration.durationCount,
              status: 'ACTIVE',
            },
          });
        }
      }

      console.log(
        `    scheme ${scheme.code} — ${spec.durations.length} duration options`,
      );
    }
  }
}

async function main(): Promise<void> {
  const wanted = process.argv[2];

  const orgs = await prisma.organization.findMany({
    select: { orgId: true, code: true, name: true },
  });

  const targets = wanted
    ? orgs.filter((o) => o.code.toUpperCase() === wanted.toUpperCase())
    : // No argument: only organizations that have nothing, so this cannot
      // quietly reshape a tenant that is already configured.
      (
        await Promise.all(
          orgs.map(async (o) => ({
            org: o,
            products: await prisma.loanProduct.count({
              where: { orgId: o.orgId },
            }),
          })),
        )
      )
        .filter((row) => row.products === 0)
        .map((row) => row.org);

  if (targets.length === 0) {
    console.log(
      wanted
        ? `No organization with code ${wanted}.`
        : 'Every organization already has at least one loan product.',
    );
    return;
  }

  for (const org of targets) {
    await bootstrap(org.orgId, org.code);
  }

  console.log(
    '\nDone. The application wizard will now offer these loan types.',
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
