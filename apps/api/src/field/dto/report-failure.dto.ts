import { IsEnum, IsUUID } from 'class-validator';

/**
 * A failure the browser reported before any position existed — a denied
 * permission, a timeout, a provider error (Scenarios 6-8, 11, 12).
 *
 * The accepted reasons are deliberately a *subset* of `GpsFailureReason`. A
 * client may report what its own device did; it may not claim a server-side
 * verdict such as `ACCURACY_REJECTED` or `STALE_LOCATION`, which are reached by
 * `evaluateLocation` from evidence rather than asserted. `PERSISTENCE_FAILED`
 * is likewise server-only. Accepting those here would let a caller write a
 * misleading audit trail describing a judgement the server never made.
 */
export class ReportFailureDto {
  @IsUUID()
  clientAttemptId!: string;

  @IsEnum(['GRANTED', 'DENIED', 'UNAVAILABLE', 'UNKNOWN'])
  permissionStatus!: 'GRANTED' | 'DENIED' | 'UNAVAILABLE' | 'UNKNOWN';

  @IsEnum(['ONLINE', 'OFFLINE'])
  networkStatus!: 'ONLINE' | 'OFFLINE';

  @IsEnum([
    'PERMISSION_DENIED',
    'POSITION_UNAVAILABLE',
    'TIMEOUT',
    'PROVIDER_ERROR',
    'NETWORK_LOST',
    'CANCELLED',
  ])
  failureReason!:
    | 'PERMISSION_DENIED'
    | 'POSITION_UNAVAILABLE'
    | 'TIMEOUT'
    | 'PROVIDER_ERROR'
    | 'NETWORK_LOST'
    | 'CANCELLED';
}
