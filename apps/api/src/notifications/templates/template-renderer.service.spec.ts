import {
  TemplateRenderError,
  TemplateRendererService,
  type RenderableTemplate,
} from './template-renderer.service';

function template(
  overrides: Partial<RenderableTemplate> = {},
): RenderableTemplate {
  return {
    templateId: 't1',
    code: 'RECOVERY_ASSIGNED_IN_APP',
    channel: 'IN_APP',
    version: 3,
    subject: null,
    titleTemplate: 'Case {{caseNumber}} assigned',
    body: 'Case {{caseNumber}} for {{amountFormatted}} is yours.',
    containsPii: false,
    ...overrides,
  };
}

const PAYLOAD = {
  caseNumber: 'RC-0001',
  amountPaise: '1250000',
  amountFormatted: '₹12,500.00',
  dueDate: '2026-08-27',
};

/**
 * `TemplateRendererService`.
 *
 * The properties worth pinning here are the ones that make Rules 25 and 27
 * structural rather than merely documented. A renderer that gains the ability
 * to compute — an arithmetic filter, an expression syntax, a conditional —
 * would let a template recalculate an EMI or introduce a float, and neither
 * failure announces itself. These tests are what would catch that being added.
 */
describe('TemplateRendererService', () => {
  const renderer = new TemplateRendererService();

  describe('substitution', () => {
    it('renders every token from the payload', () => {
      const result = renderer.render(template(), PAYLOAD);

      expect(result.title).toBe('Case RC-0001 assigned');
      expect(result.message).toBe('Case RC-0001 for ₹12,500.00 is yours.');
    });

    it('tolerates whitespace inside the braces', () => {
      const result = renderer.render(
        template({ titleTemplate: 'Case {{ caseNumber }}' }),
        PAYLOAD,
      );

      expect(result.title).toBe('Case RC-0001');
    });

    it('renders the same token more than once', () => {
      const result = renderer.render(
        template({ body: '{{caseNumber}} and {{caseNumber}}' }),
        PAYLOAD,
      );

      expect(result.message).toBe('RC-0001 and RC-0001');
    });

    it('resolves nested payload values by dotted path', () => {
      const result = renderer.render(
        template({ titleTemplate: 'Title', body: 'For {{customer.name}}' }),
        { customer: { name: 'A. Borrower' } },
      );

      expect(result.message).toBe('For A. Borrower');
    });

    it('renders null as empty rather than as the text "null"', () => {
      // "Reference: null" is worse than "Reference:" — the first reads as a
      // system fault to the recipient, the second as an absent optional value.
      const result = renderer.render(
        template({ titleTemplate: 'Title', body: 'Reference: {{reference}}' }),
        { reference: null },
      );

      expect(result.message).toBe('Reference: ');
    });

    it('preserves false and zero, which are meaningful values', () => {
      const result = renderer.render(
        template({ titleTemplate: 'Title', body: '{{count}} / {{flag}}' }),
        { count: 0, flag: false },
      );

      expect(result.message).toBe('0 / false');
    });
  });

  describe('Rules 25, 27: it cannot compute', () => {
    // The load-bearing group. Each of these documents a capability the renderer
    // deliberately does NOT have — if any starts passing as "computed", a
    // template has gained the ability to recalculate a financial value.

    it('does not evaluate arithmetic', () => {
      const result = renderer.render(
        template({ body: '{{amountPaise}} / 100' }),
        PAYLOAD,
      );

      // The literal text survives; nothing divides it into rupees.
      expect(result.message).toBe('1250000 / 100');
    });

    it('treats an expression-shaped token as a missing token, not an expression', () => {
      // `{{a + b}}` does not match the token pattern at all, so it renders
      // verbatim rather than being evaluated. Pinned so that "support simple
      // expressions" cannot be added without this failing.
      const result = renderer.render(
        template({ body: 'Total {{amountPaise + 1}}' }),
        PAYLOAD,
      );

      expect(result.message).toBe('Total {{amountPaise + 1}}');
    });

    it('renders money exactly as the payload provided it', () => {
      // Rule 25: money arrives pre-formatted as a string. The renderer never
      // parses it into a number, so there is no point at which floating-point
      // arithmetic could touch an amount.
      const result = renderer.render(
        template({ body: '{{amountFormatted}} ({{amountPaise}} paise)' }),
        PAYLOAD,
      );

      expect(result.message).toBe('₹12,500.00 (1250000 paise)');
    });

    it('renders a business date exactly as provided, with no time component', () => {
      // Rules 26, 68 and Scenario 36: a DATE-only value must not acquire a
      // time. The renderer treating it as an opaque string is what guarantees
      // that.
      const result = renderer.render(
        template({ body: 'Due {{dueDate}}' }),
        PAYLOAD,
      );

      expect(result.message).toBe('Due 2026-08-27');
    });
  });

  describe('Scenario 52: a template that cannot be rendered', () => {
    it('throws rather than rendering undefined', () => {
      // Rendering "Case undefined assigned" and sending it is exactly the
      // malformed content the scenario forbids. Throwing means the notification
      // is never created and the event is recorded as failed.
      expect(() =>
        renderer.render(template(), { amountFormatted: '₹1.00' }),
      ).toThrow(TemplateRenderError);
    });

    it('names the missing token and the template', () => {
      // The operator reading this has to fix one placeholder in one template; a
      // generic "render failed" tells them neither.
      try {
        renderer.render(template(), {});
        throw new Error('expected a rejection');
      } catch (error) {
        const rendered = error as TemplateRenderError;
        expect(rendered.reason).toBe('MISSING_TOKEN');
        expect(rendered.templateCode).toBe('RECOVERY_ASSIGNED_IN_APP');
        expect(rendered.message).toContain('{{caseNumber}}');
      }
    });

    it('reports every missing token at once, not just the first', () => {
      try {
        renderer.render(
          template({ titleTemplate: 'Title', body: '{{a}} {{b}} {{c}}' }),
          {},
        );
        throw new Error('expected a rejection');
      } catch (error) {
        const message = (error as TemplateRenderError).message;
        expect(message).toContain('{{a}}');
        expect(message).toContain('{{b}}');
        expect(message).toContain('{{c}}');
      }
    });
  });

  describe('Rules 55, 56: PII may not reach an external channel', () => {
    it.each(['EMAIL', 'SMS'])('refuses a PII template on %s', (channel) => {
      // A CHECK constraint refuses to *store* such a template. This refuses to
      // render one that reached the database another way — a restored backup, a
      // manual insert, a migration.
      expect(() =>
        renderer.render(template({ channel, containsPii: true }), PAYLOAD),
      ).toThrow(/cannot be rendered for the/);
    });

    it('allows a PII template in-app', () => {
      // The in-app channel is inside the authenticated session, so Rule 55's
      // "controlled by channel policy" permits it there.
      expect(() =>
        renderer.render(template({ containsPii: true }), PAYLOAD),
      ).not.toThrow();
    });

    it('classifies the refusal distinctly from a missing token', () => {
      try {
        renderer.render(
          template({ channel: 'SMS', containsPii: true }),
          PAYLOAD,
        );
        throw new Error('expected a rejection');
      } catch (error) {
        expect((error as TemplateRenderError).reason).toBe(
          'PII_ON_EXTERNAL_CHANNEL',
        );
      }
    });
  });

  describe('what it records for the notification', () => {
    it('carries the template version through (Rule 39)', () => {
      // Scenario 8 turns on this: the notification records which version
      // produced its frozen content, so a later edit cannot rewrite history.
      expect(renderer.render(template(), PAYLOAD).templateVersion).toBe(3);
    });

    it('produces a stable digest for identical content', () => {
      const first = renderer.render(template(), PAYLOAD);
      const second = renderer.render(template(), PAYLOAD);

      expect(first.contentDigest).toBe(second.contentDigest);
      expect(first.contentDigest).toHaveLength(64);
    });

    it('produces a different digest when the content differs', () => {
      const first = renderer.render(template(), PAYLOAD);
      const second = renderer.render(template(), {
        ...PAYLOAD,
        caseNumber: 'RC-0002',
      });

      expect(first.contentDigest).not.toBe(second.contentDigest);
    });

    it('falls back to the subject, then the code, for a title', () => {
      // An email template has a subject and no title template; a notification
      // still needs something to show in a list, and an empty title would read
      // as a broken row.
      expect(
        renderer.render(
          template({ titleTemplate: null, subject: 'Case {{caseNumber}}' }),
          PAYLOAD,
        ).title,
      ).toBe('Case RC-0001');

      expect(
        renderer.render(
          template({ titleTemplate: null, subject: null }),
          PAYLOAD,
        ).title,
      ).toBe('RECOVERY_ASSIGNED_IN_APP');
    });
  });
});
