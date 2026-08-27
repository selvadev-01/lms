import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

/** A template as the renderer needs it. */
export interface RenderableTemplate {
  templateId: string;
  code: string;
  channel: string;
  version: number;
  subject: string | null;
  titleTemplate: string | null;
  body: string;
  containsPii: boolean;
}

/** The frozen content one notification will carry forever (Rule 40). */
export interface RenderedContent {
  title: string;
  message: string;
  subject: string | null;
  templateVersion: number;
  /**
   * SHA-256 of the rendered content.
   *
   * Reported in audit metadata under a key such as `contentDigest` — never
   * `payloadHash`, because `AuditService.sanitizeMetadata` drops any key
   * matching /hash/ and the value would silently vanish from the record.
   */
  contentDigest: string;
}

/** Raised when a template cannot be rendered (Scenario 52). */
export class TemplateRenderError extends Error {
  constructor(
    message: string,
    readonly templateCode: string,
    readonly reason: 'MISSING_TOKEN' | 'PII_ON_EXTERNAL_CHANNEL',
  ) {
    super(message);
    this.name = 'TemplateRenderError';
  }
}

/** `{{token}}`, with optional surrounding whitespace. */
const TOKEN = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;

/**
 * Renders a template against an event payload.
 *
 * # This is deliberately not a template engine
 *
 * Substitution of `{{token}}` against a flat map of already-computed strings.
 * No expressions, no arithmetic, no conditionals, no loops, no filters.
 *
 * That restriction is Rules 25 and 27 made structural rather than merely
 * documented. Rule 27 says a template must not independently recalculate EMI,
 * overdue, penalty, interest or principal values, and Rule 25 prohibits
 * floating-point money anywhere in generation. A template that *cannot*
 * compute cannot violate either. Adding an arithmetic filter — the obvious
 * convenience — would reintroduce both risks at once, and the second one
 * silently: JavaScript arithmetic on a money value is floating-point by
 * default.
 *
 * The payload therefore arrives pre-formatted. A source module emits
 * `amountFormatted: "₹12,500.00"` beside `amountPaise: "1250000"`, and the
 * template chooses which to show. The emitter formats; the template renders;
 * neither calculates.
 *
 * # An unresolved token throws
 *
 * Rendering `undefined` into a message and sending it would satisfy Scenario
 * 52's "malformed content" exactly. Throwing means the notification is never
 * created and the event is recorded as failed, which is what the scenario asks
 * for.
 */
@Injectable()
export class TemplateRendererService {
  render(
    template: RenderableTemplate,
    payload: Record<string, unknown>,
  ): RenderedContent {
    // Rules 55, 56 and Scenario 27's neighbours: SMS and email must not carry
    // unnecessary sensitive data. A CHECK constraint refuses to store such a
    // template, and this refuses to render one that reached the database
    // another way — a restored backup, a manual insert, a migration.
    if (template.containsPii && template.channel !== 'IN_APP') {
      throw new TemplateRenderError(
        `Template ${template.code} is marked as containing personal or ` +
          `financial detail and cannot be rendered for the ${template.channel} channel.`,
        template.code,
        'PII_ON_EXTERNAL_CHANNEL',
      );
    }

    const values = this.flatten(payload);

    const title = this.substitute(
      template.titleTemplate ?? template.subject ?? template.code,
      values,
      template.code,
    );
    const message = this.substitute(template.body, values, template.code);
    const subject = template.subject
      ? this.substitute(template.subject, values, template.code)
      : null;

    return {
      title,
      message,
      subject,
      templateVersion: template.version,
      contentDigest: createHash('sha256')
        .update(`${title}\n\n${message}`)
        .digest('hex'),
    };
  }

  /**
   * Replace every token, or throw naming the first one that has no value.
   *
   * The error names the token and the template, because the operator reading it
   * has to fix one specific placeholder in one specific template and a generic
   * "render failed" tells them neither.
   */
  private substitute(
    source: string,
    values: Map<string, string>,
    templateCode: string,
  ): string {
    const missing: string[] = [];

    const rendered = source.replace(TOKEN, (_match, token: string) => {
      const value = values.get(token);
      if (value === undefined) {
        missing.push(token);
        return '';
      }
      return value;
    });

    if (missing.length > 0) {
      throw new TemplateRenderError(
        `Template ${templateCode} references ${missing.map((t) => `{{${t}}}`).join(', ')}, ` +
          'which the event payload does not provide.',
        templateCode,
        'MISSING_TOKEN',
      );
    }

    return rendered;
  }

  /**
   * Turn the payload into a flat string map.
   *
   * Nested objects are flattened to dotted keys so `{{customer.name}}` works
   * without the renderer having to walk a path at substitution time.
   *
   * `null` becomes the empty string rather than the text "null": a notification
   * reading "Reference: null" is worse than one reading "Reference:". `false`
   * and `0` are preserved, because both are meaningful values a template may
   * legitimately want to show.
   *
   * Numbers are stringified with `String()`, which is safe here only because
   * money never arrives as a number — the payload contract requires paise as a
   * decimal string (Rule 25). A number reaching this point is a count or a day
   * offset, not an amount.
   */
  private flatten(
    payload: Record<string, unknown>,
    prefix = '',
    into = new Map<string, string>(),
  ): Map<string, string> {
    for (const [key, value] of Object.entries(payload)) {
      const path = prefix ? `${prefix}.${key}` : key;

      if (value === null || value === undefined) {
        into.set(path, '');
      } else if (typeof value === 'object' && !Array.isArray(value)) {
        this.flatten(value as Record<string, unknown>, path, into);
      } else {
        into.set(path, String(value));
      }
    }

    return into;
  }
}
