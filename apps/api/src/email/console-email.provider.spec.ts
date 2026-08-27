import { ConsoleEmailProvider } from './console-email.provider';

/**
 * A console provider whose file sink is captured rather than written.
 *
 * `appendToSink` is a protected method precisely so a test can override it —
 * Nest resolves constructor parameters through DI, and a function-typed one has
 * no injectable token.
 */
class TestConsoleEmailProvider extends ConsoleEmailProvider {
  readonly written: string[] = [];
  failWrite = false;

  protected override appendToSink(_path: string, data: string): Promise<void> {
    if (this.failWrite)
      return Promise.reject(new Error('read-only filesystem'));
    this.written.push(data);
    return Promise.resolve();
  }
}

describe('ConsoleEmailProvider', () => {
  const message = {
    to: 'officer@example.test',
    subject: 'Recovery case assigned',
    body: 'Case RC-0001 is now yours.',
  };

  afterEach(() => {
    delete process.env.NODE_ENV;
  });

  describe('Rule 55: it must not run in production', () => {
    it('refuses to initialise when NODE_ENV is production', () => {
      // It writes rendered notification content — loan numbers, amounts,
      // customer names — to a local file. A misconfigured deployment must fail
      // at boot, loudly, rather than quietly accumulating that file.
      process.env.NODE_ENV = 'production';
      const provider = new TestConsoleEmailProvider();

      expect(() => provider.onModuleInit()).toThrow(
        /must not run in production/,
      );
    });

    it('initialises with a warning outside production', () => {
      process.env.NODE_ENV = 'test';
      const provider = new TestConsoleEmailProvider();

      expect(() => provider.onModuleInit()).not.toThrow();
    });
  });

  describe('sending', () => {
    it('writes the message to the sink for the e2e suite to read', async () => {
      const provider = new TestConsoleEmailProvider();

      await provider.send(message);

      expect(provider.written).toHaveLength(1);
      expect(provider.written[0]).toContain('officer@example.test');
      expect(provider.written[0]).toContain('Recovery case assigned');
    });

    it('flattens newlines so one message is one line', async () => {
      // The sink is read line-by-line by the e2e suite; a multi-line body would
      // otherwise look like several messages.
      const provider = new TestConsoleEmailProvider();

      await provider.send({ ...message, body: 'line one\nline two' });

      expect(provider.written[0].split('\n')).toHaveLength(2); // content + trailing
      expect(provider.written[0]).toContain('line one\\nline two');
    });

    it('succeeds even when the sink cannot be written', async () => {
      // Best-effort by design: a development convenience must never be able to
      // fail a delivery, which would turn a read-only filesystem into a wave of
      // permanent failures on a channel that is otherwise working.
      const provider = new TestConsoleEmailProvider();
      provider.failWrite = true;

      await expect(provider.send(message)).resolves.toBeDefined();
    });

    describe('Rule 17: what it may claim', () => {
      it('reports acceptance, never delivery', async () => {
        // The console provider stands in for a gateway. Reporting a delivery it
        // cannot observe would teach the pipeline a habit that becomes a false
        // claim in production (Scenario 27).
        const provider = new TestConsoleEmailProvider();

        const result = await provider.send(message);

        expect(result.providerStatus).toBe('logged');
        expect(result).not.toHaveProperty('delivered');
      });
    });
  });
});
