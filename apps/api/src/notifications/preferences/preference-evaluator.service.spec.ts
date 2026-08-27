import { PrismaService } from '../../prisma/prisma.service';
import { PreferenceEvaluatorService } from './preference-evaluator.service';

const ORG = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';

interface Stored {
  inAppEnabled: boolean;
  emailEnabled: boolean;
  smsEnabled: boolean;
  eventPreferences: Record<string, boolean>;
}

/** Counts reads so the mandatory short-circuit can be asserted, not assumed. */
function build(row: Stored | null): {
  service: PreferenceEvaluatorService;
  reads: () => number;
} {
  let reads = 0;
  const prisma = {
    notificationPreference: {
      findUnique: () => {
        reads += 1;
        return Promise.resolve(row);
      },
    },
  } as unknown as PrismaService;

  return {
    service: new PreferenceEvaluatorService(prisma),
    reads: () => reads,
  };
}

function preferences(overrides: Partial<Stored> = {}): Stored {
  return {
    inAppEnabled: true,
    emailEnabled: true,
    smsEnabled: true,
    eventPreferences: {},
    ...overrides,
  };
}

/**
 * `PreferenceEvaluatorService`.
 *
 * One property here matters more than the rest: a mandatory notification must
 * not read preferences *at all*. Rules 47 and 48 say a preference may never
 * override a mandatory rule, and the short-circuit is what makes that
 * unreachable rather than merely correct today — so the test asserts the read
 * count, not just the outcome. An implementation that reads first and overrides
 * after would pass every other test in this file and fail that one.
 */
describe('PreferenceEvaluatorService', () => {
  describe('Rules 47, 48 and Scenario 17: mandatory wins', () => {
    it('delivers a mandatory notification despite every toggle being off', async () => {
      const { service } = build(
        preferences({
          inAppEnabled: false,
          emailEnabled: false,
          smsEnabled: false,
          eventPreferences: { RECOVERY: false },
        }),
      );

      const decision = await service.shouldDeliver({
        orgId: ORG,
        userId: USER,
        channel: 'IN_APP',
        eventType: 'RECOVERY_ASSIGNED',
        isMandatory: true,
      });

      expect(decision).toEqual({ deliver: true });
    });

    it('does not read preferences at all for a mandatory notification', async () => {
      // The assertion that keeps the guarantee structural. Read-then-override
      // works until someone folds the branches together and inverts a
      // condition, at which point an opt-out silently suppresses a mandatory
      // operational alert and nothing fails visibly.
      const { service, reads } = build(
        preferences({ eventPreferences: { RECOVERY: false } }),
      );

      await service.shouldDeliver({
        orgId: ORG,
        userId: USER,
        channel: 'IN_APP',
        eventType: 'RECOVERY_ASSIGNED',
        isMandatory: true,
      });

      expect(reads()).toBe(0);
    });
  });

  describe('a user who has expressed no preference', () => {
    it('receives everything', async () => {
      // Defaulting to off would mean a newly created user silently receives
      // nothing, which looks exactly like a broken pipeline and gets diagnosed
      // as one.
      const { service } = build(null);

      const decision = await service.shouldDeliver({
        orgId: ORG,
        userId: USER,
        channel: 'EMAIL',
        eventType: 'RECOVERY_ASSIGNED',
        isMandatory: false,
      });

      expect(decision).toEqual({ deliver: true });
    });

    it('receives an event whose category is absent from a partial map', async () => {
      // Silence is not a decline. A stored map covering only EMI says nothing
      // about RECOVERY.
      const { service } = build(
        preferences({ eventPreferences: { EMI: false } }),
      );

      const decision = await service.shouldDeliver({
        orgId: ORG,
        userId: USER,
        channel: 'IN_APP',
        eventType: 'RECOVERY_ASSIGNED',
        isMandatory: false,
      });

      expect(decision.deliver).toBe(true);
    });
  });

  describe('Scenario 20: an optional notification the user declined', () => {
    it.each([
      ['IN_APP', 'inAppEnabled'],
      ['EMAIL', 'emailEnabled'],
      ['SMS', 'smsEnabled'],
    ])('suppresses %s when its channel toggle is off', async (channel, key) => {
      const { service } = build(preferences({ [key]: false }));

      const decision = await service.shouldDeliver({
        orgId: ORG,
        userId: USER,
        channel,
        eventType: 'RECOVERY_ASSIGNED',
        isMandatory: false,
      });

      expect(decision).toEqual({
        deliver: false,
        reason: 'USER_PREFERENCE',
      });
    });

    it('suppresses when the event category is off', async () => {
      const { service } = build(
        preferences({ eventPreferences: { RECOVERY: false } }),
      );

      const decision = await service.shouldDeliver({
        orgId: ORG,
        userId: USER,
        channel: 'IN_APP',
        eventType: 'RECOVERY_ASSIGNED',
        isMandatory: false,
      });

      expect(decision).toEqual({
        deliver: false,
        reason: 'USER_PREFERENCE',
      });
    });

    it('leaves other channels unaffected by one channel being off', async () => {
      // A user who wants in-app but not email has expressed two decisions, not
      // one.
      const { service } = build(preferences({ emailEnabled: false }));

      const inApp = await service.shouldDeliver({
        orgId: ORG,
        userId: USER,
        channel: 'IN_APP',
        eventType: 'RECOVERY_ASSIGNED',
        isMandatory: false,
      });

      expect(inApp.deliver).toBe(true);
    });

    it('returns a reason the caller can record', () => {
      // Scenario 20 asks for the suppression *outcome* to be recorded, which is
      // why this returns a reason rather than a bare boolean — the caller
      // stores it on the notification row.
      return build(preferences({ inAppEnabled: false }))
        .service.shouldDeliver({
          orgId: ORG,
          userId: USER,
          channel: 'IN_APP',
          eventType: 'RECOVERY_ASSIGNED',
          isMandatory: false,
        })
        .then((decision) => {
          expect(decision.reason).toBe('USER_PREFERENCE');
        });
    });
  });

  describe('an event with no preference category', () => {
    it('throws rather than silently becoming unsuppressible', async () => {
      // `preferenceCategoryFor` refuses to default. An event with no category
      // would be ungovernable by preference while not being marked mandatory —
      // Rules 47 and 48 inverted, and invisible until a user complains they
      // cannot turn something off.
      const { service } = build(preferences());

      await expect(
        service.shouldDeliver({
          orgId: ORG,
          userId: USER,
          channel: 'IN_APP',
          eventType: 'NOT_A_REAL_EVENT',
          isMandatory: false,
        }),
      ).rejects.toThrow(/No preference category is mapped/);
    });
  });
});
