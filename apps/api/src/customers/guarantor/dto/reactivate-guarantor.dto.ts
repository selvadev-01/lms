import { IsString } from 'class-validator';

/**
 * Guarantor reactivation.
 *
 * Carries no reason, unlike deactivation: switching a guarantor back on restores
 * the default state rather than departing from it, and the audit record already
 * carries the actor and the time.
 */
export class ReactivateGuarantorDto {
  @IsString()
  expectedVersion!: string;
}
