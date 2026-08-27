import { IsNotEmpty, IsString } from 'class-validator';

/**
 * KYC submission (Scenario 6).
 *
 * Carries nothing but the version handle: the documents are already uploaded
 * through their own endpoint, and the submission is a state transition rather
 * than a payload. A DTO listing document ids would let a caller submit a pack
 * different from the one actually stored.
 */
export class SubmitKycDto {
  /** See `UpdateCustomerDto.expectedVersion` (Q-CUST-22, Scenario 40). */
  @IsString()
  @IsNotEmpty()
  expectedVersion!: string;
}
