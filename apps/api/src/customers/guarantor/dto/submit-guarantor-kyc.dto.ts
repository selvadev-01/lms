import { IsString } from 'class-validator';

/**
 * Submits the assembled guarantor KYC pack for review (Scenario 20).
 *
 * Carries only the concurrency token: what is submitted is whatever documents
 * are currently attached, so there is nothing else for the caller to state.
 */
export class SubmitGuarantorKycDto {
  @IsString()
  expectedVersion!: string;
}
