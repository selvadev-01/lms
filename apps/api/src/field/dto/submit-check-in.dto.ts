import { Type } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

/**
 * One GPS check-in attempt submitted from the field-operations screen.
 *
 * Deliberately carries no `userId`, `orgId`, `branchId` or `sessionId`. All
 * four are read from the authenticated session server-side, which is what makes
 * "GPS cannot change your branch, role or organization" (Scenarios 23, 24, 26)
 * true by construction. `main.ts` sets `forbidNonWhitelisted: true`, so a
 * request that invents any of them is a 400 rather than a silently ignored
 * field.
 *
 * Coordinates are optional here because the same endpoint records a failed
 * attempt. Whether a position is *required* is a verification rule, not a parse
 * rule: it lives in `evaluateLocation`, so a client that omits coordinates gets
 * a recorded, audited failure rather than a 400 that leaves no trace of the
 * attempt (Scenario 9).
 */
export class SubmitCheckInDto {
  /**
   * Client-minted per attempt. The idempotency key that stops a retried fetch
   * or a double submit from creating two authoritative check-ins (Scenario 37).
   * A retry after a failure uses a *new* id, so each attempt keeps its own
   * outcome (Scenarios 13, 15).
   */
  @IsUUID()
  clientAttemptId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(-180)
  @Max(180)
  longitude?: number;

  /** Metres of uncertainty as reported by the device. Never negative. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  accuracyMeters?: number;

  /**
   * Device clock, ISO-8601. Accepted as evidence, never trusted as authority:
   * the server judges its freshness and uses its own clock for `verified_at`.
   */
  @IsOptional()
  @IsISO8601({ strict: true })
  locationTimestamp?: string;

  @IsEnum(['GRANTED', 'DENIED', 'UNAVAILABLE', 'UNKNOWN'])
  permissionStatus!: 'GRANTED' | 'DENIED' | 'UNAVAILABLE' | 'UNKNOWN';

  @IsEnum(['ONLINE', 'OFFLINE'])
  networkStatus!: 'ONLINE' | 'OFFLINE';
}
