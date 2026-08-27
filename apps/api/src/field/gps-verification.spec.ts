import {
  GPS_FAILURE_REASON,
  GPS_VERIFICATION_STATUS,
  evaluateLocation,
  type GpsPolicy,
  type LocationCandidate,
} from './gps-verification';

/**
 * The verification rules, tested as pure functions.
 *
 * Every branch here maps to a numbered scenario in
 * `docs/user-stories/01 - Authentication & Session Management/Field-Employee-GPS-Check-in.md`.
 * The story's central requirement is that the system fails closed: no input
 * short of a complete, fresh, accurate position may produce VERIFIED. Most of
 * these cases therefore assert a *refusal*.
 */

const POLICY: GpsPolicy = {
  maxAccuracyMeters: 100,
  maxLocationAgeSeconds: 120,
  maxClockSkewSeconds: 60,
};

const NOW = new Date('2026-08-18T10:00:00.000Z');

/** A position that passes every rule; each test spoils exactly one thing. */
function validCandidate(
  overrides: Partial<LocationCandidate> = {},
): LocationCandidate {
  return {
    latitude: 13.0827,
    longitude: 80.2707,
    accuracyMeters: 12.5,
    locationTimestamp: new Date('2026-08-18T09:59:30.000Z'),
    permissionStatus: 'GRANTED',
    networkStatus: 'ONLINE',
    ...overrides,
  };
}

describe('evaluateLocation', () => {
  describe('Scenario 4: GPS location is successfully acquired and verified', () => {
    it('verifies a fresh, accurate position from a permitted, online device', () => {
      expect(evaluateLocation(validCandidate(), POLICY, NOW)).toEqual({
        status: GPS_VERIFICATION_STATUS.VERIFIED,
      });
    });

    it('accepts accuracy exactly at the threshold', () => {
      // The rule is "worse than 100m is rejected", not "100m is rejected" —
      // a device reporting exactly the limit has met it.
      const result = evaluateLocation(
        validCandidate({ accuracyMeters: 100 }),
        POLICY,
        NOW,
      );

      expect(result.status).toBe(GPS_VERIFICATION_STATUS.VERIFIED);
    });

    it('accepts a location timestamp exactly at the freshness limit', () => {
      const result = evaluateLocation(
        validCandidate({
          locationTimestamp: new Date(NOW.getTime() - 120_000),
        }),
        POLICY,
        NOW,
      );

      expect(result.status).toBe(GPS_VERIFICATION_STATUS.VERIFIED);
    });

    it.each([
      ['equator/prime meridian', 0, 0],
      ['north pole', 90, 180],
      ['south pole', -90, -180],
    ])('accepts the extreme valid coordinate %s', (_label, lat, lng) => {
      const result = evaluateLocation(
        validCandidate({ latitude: lat, longitude: lng }),
        POLICY,
        NOW,
      );

      expect(result.status).toBe(GPS_VERIFICATION_STATUS.VERIFIED);
    });
  });

  describe('Scenarios 7, 8: permission denied or location services unavailable', () => {
    it.each(['DENIED', 'UNAVAILABLE', 'UNKNOWN'] as const)(
      'refuses a %s permission even when the coordinates are otherwise valid',
      (permissionStatus) => {
        // A client could send coordinates alongside a DENIED permission; the
        // permission state is checked first precisely so that combination
        // cannot verify.
        expect(
          evaluateLocation(validCandidate({ permissionStatus }), POLICY, NOW),
        ).toEqual({
          status: GPS_VERIFICATION_STATUS.FAILED,
          reason: GPS_FAILURE_REASON.PERMISSION_DENIED,
        });
      },
    );
  });

  describe('Scenario 17: network lost before verification completes', () => {
    it('refuses an OFFLINE attempt', () => {
      expect(
        evaluateLocation(
          validCandidate({ networkStatus: 'OFFLINE' }),
          POLICY,
          NOW,
        ),
      ).toEqual({
        status: GPS_VERIFICATION_STATUS.FAILED,
        reason: GPS_FAILURE_REASON.NETWORK_LOST,
      });
    });

    it('reports permission failure ahead of network failure', () => {
      // Both are wrong; the permission problem is the one the user must fix
      // first, and it is the more specific fact.
      const result = evaluateLocation(
        validCandidate({
          permissionStatus: 'DENIED',
          networkStatus: 'OFFLINE',
        }),
        POLICY,
        NOW,
      );

      expect(result).toEqual({
        status: GPS_VERIFICATION_STATUS.FAILED,
        reason: GPS_FAILURE_REASON.PERMISSION_DENIED,
      });
    });
  });

  describe('Scenario 9: location result is unavailable or invalid', () => {
    it.each([
      ['latitude missing', { latitude: undefined }],
      ['longitude missing', { longitude: undefined }],
      ['both missing', { latitude: undefined, longitude: undefined }],
      ['latitude NaN', { latitude: Number.NaN }],
      ['longitude NaN', { longitude: Number.NaN }],
      ['latitude Infinity', { latitude: Number.POSITIVE_INFINITY }],
      ['latitude above 90', { latitude: 90.0001 }],
      ['latitude below -90', { latitude: -90.0001 }],
      ['longitude above 180', { longitude: 180.0001 }],
      ['longitude below -180', { longitude: -180.0001 }],
    ])('rejects %s as invalid coordinates', (_label, overrides) => {
      expect(evaluateLocation(validCandidate(overrides), POLICY, NOW)).toEqual({
        status: GPS_VERIFICATION_STATUS.FAILED,
        reason: GPS_FAILURE_REASON.INVALID_COORDINATES,
      });
    });
  });

  describe('Scenario 21: a stale location is not treated as current', () => {
    it('rejects a position older than the freshness window', () => {
      expect(
        evaluateLocation(
          validCandidate({
            locationTimestamp: new Date(NOW.getTime() - 121_000),
          }),
          POLICY,
          NOW,
        ),
      ).toEqual({
        status: GPS_VERIFICATION_STATUS.FAILED,
        reason: GPS_FAILURE_REASON.STALE_LOCATION,
      });
    });

    it('rejects a missing location timestamp', () => {
      // Absent freshness evidence is not evidence of freshness.
      const result = evaluateLocation(
        validCandidate({ locationTimestamp: undefined }),
        POLICY,
        NOW,
      );

      expect(result).toEqual({
        status: GPS_VERIFICATION_STATUS.FAILED,
        reason: GPS_FAILURE_REASON.STALE_LOCATION,
      });
    });

    it('rejects a timestamp far in the future', () => {
      // A device clock is attacker-controlled: without this, setting the clock
      // forward would make any stale position look permanently fresh.
      const result = evaluateLocation(
        validCandidate({
          locationTimestamp: new Date(NOW.getTime() + 61_000),
        }),
        POLICY,
        NOW,
      );

      expect(result).toEqual({
        status: GPS_VERIFICATION_STATUS.FAILED,
        reason: GPS_FAILURE_REASON.STALE_LOCATION,
      });
    });

    it('tolerates minor forward skew within the allowance', () => {
      // Real client clocks drift by seconds; rejecting that would fail honest
      // devices for no security gain.
      const result = evaluateLocation(
        validCandidate({
          locationTimestamp: new Date(NOW.getTime() + 30_000),
        }),
        POLICY,
        NOW,
      );

      expect(result.status).toBe(GPS_VERIFICATION_STATUS.VERIFIED);
    });
  });

  describe('Scenario 10: accuracy does not satisfy the finalized rule', () => {
    it('rejects a position worse than the accuracy threshold', () => {
      expect(
        evaluateLocation(
          validCandidate({ accuracyMeters: 100.1 }),
          POLICY,
          NOW,
        ),
      ).toEqual({
        status: GPS_VERIFICATION_STATUS.FAILED,
        reason: GPS_FAILURE_REASON.ACCURACY_REJECTED,
      });
    });

    it('rejects a missing accuracy reading', () => {
      // Unknown accuracy cannot be shown to satisfy the threshold, so it fails
      // closed rather than being assumed good.
      const result = evaluateLocation(
        validCandidate({ accuracyMeters: undefined }),
        POLICY,
        NOW,
      );

      expect(result).toEqual({
        status: GPS_VERIFICATION_STATUS.FAILED,
        reason: GPS_FAILURE_REASON.ACCURACY_REJECTED,
      });
    });

    it.each([Number.NaN, -1])(
      'rejects a nonsensical accuracy of %s',
      (accuracyMeters) => {
        const result = evaluateLocation(
          validCandidate({ accuracyMeters }),
          POLICY,
          NOW,
        );

        expect(result).toEqual({
          status: GPS_VERIFICATION_STATUS.FAILED,
          reason: GPS_FAILURE_REASON.ACCURACY_REJECTED,
        });
      },
    );

    it('disables the accuracy rule when the threshold is 0', () => {
      // 0 means "unset" for every other tunable in this codebase
      // (AUTH_MAX_CONCURRENT_SESSIONS, idleTimeoutMs); keep that consistent so
      // a deployment can switch the rule off without a code change.
      const result = evaluateLocation(
        validCandidate({ accuracyMeters: 5000 }),
        { ...POLICY, maxAccuracyMeters: 0 },
        NOW,
      );

      expect(result.status).toBe(GPS_VERIFICATION_STATUS.VERIFIED);
    });
  });

  describe('rule ordering', () => {
    it('reports invalid coordinates ahead of staleness and accuracy', () => {
      // With nothing usable to check, the freshness and accuracy of "no
      // position" are not meaningful facts to report.
      const result = evaluateLocation(
        validCandidate({
          latitude: undefined,
          accuracyMeters: 9999,
          locationTimestamp: new Date(NOW.getTime() - 999_000),
        }),
        POLICY,
        NOW,
      );

      expect(result).toEqual({
        status: GPS_VERIFICATION_STATUS.FAILED,
        reason: GPS_FAILURE_REASON.INVALID_COORDINATES,
      });
    });

    it('reports staleness ahead of accuracy', () => {
      const result = evaluateLocation(
        validCandidate({
          accuracyMeters: 9999,
          locationTimestamp: new Date(NOW.getTime() - 999_000),
        }),
        POLICY,
        NOW,
      );

      expect(result).toEqual({
        status: GPS_VERIFICATION_STATUS.FAILED,
        reason: GPS_FAILURE_REASON.STALE_LOCATION,
      });
    });
  });

  describe('purity', () => {
    it('does not mutate its input', () => {
      const candidate = validCandidate();
      const snapshot = JSON.stringify(candidate);

      evaluateLocation(candidate, POLICY, NOW);

      expect(JSON.stringify(candidate)).toBe(snapshot);
    });

    it('returns the same verdict for the same inputs', () => {
      const candidate = validCandidate();

      expect(evaluateLocation(candidate, POLICY, NOW)).toEqual(
        evaluateLocation(candidate, POLICY, NOW),
      );
    });
  });
});
