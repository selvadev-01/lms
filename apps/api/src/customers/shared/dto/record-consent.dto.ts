import { IsIn, IsString } from 'class-validator';

/**
 * Guarantor consent (Scenario 25).
 *
 * Carries no timestamp and no actor. Both are the server's: a consent record
 * whose timestamp was supplied by the party recording it proves considerably
 * less than one the system stamped on receipt, and the actor comes from the JWT
 * (Rule 23).
 */
export class RecordConsentDto {
  @IsIn(['PENDING', 'GIVEN', 'REJECTED'], {
    message: 'A consent decision is required',
  })
  consentStatus!: 'PENDING' | 'GIVEN' | 'REJECTED';

  /** The `updatedAt` the caller last read — see `GuarantorService`. */
  @IsString()
  expectedVersion!: string;
}
