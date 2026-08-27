import { ConfigService } from '@nestjs/config';

import { PasswordService } from './password.service';

/** Low argon2 cost so the suite stays fast; production values come from config. */
const config = {
  get: (key: string) =>
    ({
      'auth.argon2MemoryKib': 1024,
      'auth.argon2TimeCost': 1,
      'auth.argon2Parallelism': 1,
    })[key],
} as unknown as ConfigService;

describe('PasswordService', () => {
  let service: PasswordService;

  beforeAll(async () => {
    service = new PasswordService(config);
    await service.onModuleInit();
  });

  // Scenario 21: verification happens against a stored hash.
  it('verifies a correct password against its hash', async () => {
    const hash = await service.hash('Password@123');
    await expect(service.verify(hash, 'Password@123')).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await service.hash('Password@123');
    await expect(service.verify(hash, 'WrongPassword')).resolves.toBe(false);
  });

  // Rule 16: plaintext is never stored.
  it('never stores the plaintext in the hash', async () => {
    const hash = await service.hash('Password@123');
    expect(hash).not.toContain('Password@123');
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('produces a different hash for the same password (salted)', async () => {
    const [a, b] = await Promise.all([
      service.hash('Password@123'),
      service.hash('Password@123'),
    ]);
    expect(a).not.toBe(b);
  });

  // Rule 15 / Scenario 3: a null hash must not short-circuit, or response
  // timing would reveal which mobile numbers exist.
  it('returns false for a null hash without throwing', async () => {
    await expect(service.verify(null, 'anything')).resolves.toBe(false);
    await expect(service.verify(undefined, 'anything')).resolves.toBe(false);
  });

  it('spends comparable time on a null hash as on a real mismatch', async () => {
    const hash = await service.hash('Password@123');

    const startReal = process.hrtime.bigint();
    await service.verify(hash, 'WrongPassword');
    const realNs = Number(process.hrtime.bigint() - startReal);

    const startNull = process.hrtime.bigint();
    await service.verify(null, 'WrongPassword');
    const nullNs = Number(process.hrtime.bigint() - startNull);

    // Generous bound: asserts the dummy-hash path runs real work, not that the
    // two are precisely equal, which would be flaky under CI scheduling.
    expect(nullNs).toBeGreaterThan(realNs / 10);
  });

  it('treats a malformed stored hash as a failed verification', async () => {
    await expect(service.verify('not-a-hash', 'anything')).resolves.toBe(false);
  });
});
