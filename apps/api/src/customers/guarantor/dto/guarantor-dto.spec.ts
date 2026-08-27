import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateGuarantorDto } from './create-guarantor.dto';
import { DeactivateGuarantorDto } from './deactivate-guarantor.dto';

/**
 * Guarantor DTO validation (Module 05 Scenarios 9, 28).
 *
 * These exist because the zod schemas in `@lms/validation` do **not** cover this
 * layer. The web actions parse with zod; the API validates with class-validator,
 * and a request made by any other client — or by a form that skipped the action
 * — meets only these decorators. A rule enforced in one place and not the other
 * is a rule that holds for the UI and not for the API.
 *
 * The regression they pin down: an earlier attempt to tidy the duplicated
 * "Address is required" messages used `@ValidateIf`, which skips *every*
 * remaining validator on the property when its predicate is false — including
 * `@IsNotEmpty`. The result silently accepted a guarantor with no address at
 * all, and smoke testing caught it only because the created row was inspected.
 */

async function messagesFor<T extends object>(
  dto: object,
  type: new () => T,
): Promise<string[]> {
  const instance = plainToInstance(type, dto);
  const errors = await validate(instance);

  return errors.flatMap((error) => Object.values(error.constraints ?? {}));
}

describe('CreateGuarantorDto', () => {
  const valid = {
    fullName: 'Ravi Shankar',
    mobile: '9876543211',
    address: '12 Nehru Street, Coimbatore',
  };

  it('accepts the three mandatory fields', async () => {
    await expect(messagesFor(valid, CreateGuarantorDto)).resolves.toEqual([]);
  });

  // The regression. A missing address must never produce a valid DTO.
  it('rejects a guarantor with no address at all', async () => {
    const messages = await messagesFor(
      { fullName: valid.fullName, mobile: valid.mobile },
      CreateGuarantorDto,
    );

    expect(messages).toContain('Address is required');
  });

  it('rejects an address of only whitespace', async () => {
    const messages = await messagesFor(
      { ...valid, address: '   ' },
      CreateGuarantorDto,
    );

    expect(messages).toContain('Address is required');
  });

  /**
   * Decorators evaluate bottom-up, so `@MaxLength` sits last in source order to
   * be evaluated first. That ordering is what puts the actionable message at the
   * head of the array — which is the one the web form renders.
   */
  it('leads with the useful message when the address is missing', async () => {
    const messages = await messagesFor(
      { fullName: valid.fullName, mobile: valid.mobile },
      CreateGuarantorDto,
    );

    expect(messages[0]).toBe('Address is required');
  });

  it('keeps a length-specific message for an over-long address', async () => {
    const messages = await messagesFor(
      { ...valid, address: 'a'.repeat(501) },
      CreateGuarantorDto,
    );

    expect(messages).toEqual(['Address must be 500 characters or fewer']);
  });

  it('rejects a malformed mobile', async () => {
    const messages = await messagesFor(
      { ...valid, mobile: 'abc' },
      CreateGuarantorDto,
    );

    expect(messages).toContain('Enter a valid 10-digit mobile number');
  });
});

describe('DeactivateGuarantorDto', () => {
  const valid = {
    reason: 'Guarantor withdrew',
    expectedVersion: '2026-08-01T00:00:00.000Z',
  };

  it('accepts a stated reason', async () => {
    await expect(messagesFor(valid, DeactivateGuarantorDto)).resolves.toEqual(
      [],
    );
  });

  // Deactivation replaces a refused delete, so the reason is the only record of
  // why the non-destructive path was taken.
  it('rejects deactivation with no reason', async () => {
    const messages = await messagesFor(
      { expectedVersion: valid.expectedVersion },
      DeactivateGuarantorDto,
    );

    expect(messages[0]).toBe('A reason is required');
  });

  it('rejects a reason of only whitespace', async () => {
    const messages = await messagesFor(
      { ...valid, reason: '   ' },
      DeactivateGuarantorDto,
    );

    expect(messages).toContain('A reason is required');
  });
});
