import { ConsoleSmsProvider } from './console-sms.provider';

describe('ConsoleSmsProvider', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    jest.restoreAllMocks();
  });

  /**
   * Forgot Password Scenario 25: recovery secrets must never reach application
   * logs. This provider exists only so the flow is testable before an SMS
   * gateway is procured, so a production deployment must fail at boot rather
   * than quietly log every user's OTP.
   */
  it('refuses to start in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => new ConsoleSmsProvider().onModuleInit()).toThrow(
      /must not run in production/,
    );
  });

  it('starts outside production', () => {
    process.env.NODE_ENV = 'development';
    expect(() => new ConsoleSmsProvider().onModuleInit()).not.toThrow();
  });

  it('resolves rather than rejecting, so delivery counts as attempted', async () => {
    process.env.NODE_ENV = 'test';
    const provider = new ConsoleSmsProvider();
    await expect(provider.send('9000000001', 'code 123456')).resolves.toBe(
      undefined,
    );
  });

  /**
   * The dev message sink is a test convenience. If it could throw, an
   * unwritable filesystem would turn into a recovery outage.
   */
  it('still resolves when the message sink cannot be written', async () => {
    process.env.NODE_ENV = 'test';

    class FailingSink extends ConsoleSmsProvider {
      protected override appendToSink(): Promise<void> {
        return Promise.reject(new Error('read-only filesystem'));
      }
    }

    await expect(
      new FailingSink().send('9000000001', 'code 123456'),
    ).resolves.toBe(undefined);
  });

  it('writes the delivered message to the sink', async () => {
    process.env.NODE_ENV = 'test';
    const written: string[] = [];

    class RecordingSink extends ConsoleSmsProvider {
      protected override appendToSink(
        _path: string,
        data: string,
      ): Promise<void> {
        written.push(data);
        return Promise.resolve();
      }
    }

    await new RecordingSink().send('9000000001', 'code 123456');

    expect(written).toHaveLength(1);
    expect(written[0]).toContain('9000000001');
    expect(written[0]).toContain('123456');
  });
});
