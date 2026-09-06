/**
 * Restore the e2e password fixtures to the seed password.
 *
 * WHY THIS EXISTS
 * `change-password.spec.ts` and `recovery.spec.ts` rotate a real account's
 * password. `9000000007` in particular cannot restore itself — with a password
 * history depth of 5, writing the seed password back is refused as reuse, and
 * `prisma/seed.ts` says exactly that in the comment on that user. An
 * interrupted run therefore strands the account on a password nobody knows,
 * and `db:seed` is idempotent so it will not repair it: every test in the
 * affected `describe.serial` block then fails at its shared sign-in, naming a
 * different test each run and looking exactly like a regression in whatever
 * you last changed.
 *
 * This resets only those fixtures — the hash AND the history, because leaving
 * the history in place would make the seed password itself a reuse violation
 * the next time a spec sets it.
 *
 * Touches no other user and no business data.
 *
 *   pnpm --filter @lms/api exec tsx scripts/reset-e2e-password-fixtures.ts
 *
 * Verify by signing in for one of the mobiles below against a control account
 * (9000000001), which is never mutated by these specs.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';

import { PrismaClient } from '../src/generated/prisma/client';

/** Must match `SEED_PASSWORD` and the hash parameters in prisma/seed.ts. */
const SEED_PASSWORD = 'Kestrel7Vault';

/** The accounts the password-mutating specs own. */
const FIXTURE_MOBILES = [
  '9000000007', // change-password.spec.ts
  '9000000004', // recovery.spec.ts — full recovery
  '9000000021', // recovery.spec.ts — password policy
  '9000000022', // recovery.spec.ts — password history
];

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL as string,
  }),
});

async function main(): Promise<void> {
  const passwordHash = await argon2.hash(SEED_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  for (const mobile of FIXTURE_MOBILES) {
    const user = await prisma.user.findFirst({
      where: { mobile },
      select: { orgId: true, userId: true, name: true },
    });

    if (!user) {
      console.log(`${mobile}: not found — skipped`);
      continue;
    }

    // History first: with it in place, the seed password would itself be
    // rejected as a reuse the next time a spec tries to set it.
    const { count } = await prisma.passwordHistory.deleteMany({
      where: { orgId: user.orgId, userId: user.userId },
    });

    await prisma.user.update({
      where: { orgId_userId: { orgId: user.orgId, userId: user.userId } },
      data: { passwordHash },
    });

    console.log(
      `${mobile} (${user.name}): password reset, ${count} history rows cleared`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
