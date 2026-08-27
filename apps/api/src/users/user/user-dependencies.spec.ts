import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  USER_DEPENDENCIES,
  canDeleteUser,
  summarizeUserBlockers,
} from './user-dependencies';

/**
 * The user delete guard's data question.
 *
 * The load-bearing test is the last describe block, which reads the Prisma schema
 * and checks this list against it. Two failure modes it exists to catch, neither
 * of which a type check would notice:
 *
 * - **A wrong column name.** Unlike branches, user foreign keys are not uniformly
 *   called `userId` — `collectorUserId`, `fieldAgentId`, `assignedAgentId`,
 *   `requestedBy`. A typo would make Prisma throw at runtime, and
 *   `AllExceptionsFilter` would render that as a 503 about the authentication
 *   service, sending the next reader somewhere entirely unrelated.
 *
 * - **A new relation nobody added here.** A fourteenth model referencing `users`
 *   with `onDelete: Restrict` would let this guard report "nothing in the way",
 *   after which Postgres refuses the delete with a bare foreign-key error — the
 *   same misleading 503.
 */

describe('summarizeUserBlockers', () => {
  it('reports dependencies that have rows, in list order', () => {
    expect(summarizeUserBlockers({ collection: 2, auditLog: 7 })).toEqual([
      { entity: 'auditLog', label: 'Audit records', count: 7 },
      { entity: 'collection', label: 'Collections', count: 2 },
    ]);
  });

  it('drops zero counts', () => {
    expect(summarizeUserBlockers({ auditLog: 0, collection: 0 })).toEqual([]);
  });

  it('treats a missing count as zero', () => {
    expect(summarizeUserBlockers({})).toEqual([]);
  });
});

describe('canDeleteUser', () => {
  it('permits deletion when nothing references the user', () => {
    expect(canDeleteUser({ auditLog: 0 })).toBe(true);
  });

  it('refuses once a single audit row exists', () => {
    // Which is to say: refuses for anyone who has ever signed in.
    expect(canDeleteUser({ auditLog: 1 })).toBe(false);
  });
});

describe('USER_DEPENDENCIES against the schema', () => {
  /**
   * Every relation to `users`, read from the schema rather than restated here.
   *
   * Matches the `@relation(fields: [orgId, <field>], references: [orgId, userId])`
   * form the composite tenant-safe foreign keys all use.
   */
  function relationsToUser(): Array<{
    model: string;
    field: string;
    cascades: boolean;
  }> {
    const schema = readFileSync(
      join(__dirname, '..', '..', '..', 'prisma', 'schema.prisma'),
      'utf8',
    );

    const found: Array<{ model: string; field: string; cascades: boolean }> =
      [];
    const modelPattern = /^model (\w+) \{([\s\S]*?)^\}/gm;

    let model: RegExpExecArray | null;
    while ((model = modelPattern.exec(schema)) !== null) {
      const [, name, body] = model;
      for (const line of body.split('\n')) {
        if (!/references:\s*\[orgId,\s*userId\]/.test(line)) continue;
        const field = /fields:\s*\[orgId,\s*(\w+)\]/.exec(line);
        if (!field) continue;
        found.push({
          model: name,
          field: field[1],
          cascades: /onDelete:\s*Cascade/.test(line),
        });
      }
    }

    return found;
  }

  /** `FieldAssignment` -> `fieldAssignment`, matching the Prisma delegate name. */
  const delegate = (model: string): string =>
    model.charAt(0).toLowerCase() + model.slice(1);

  it('finds the relations in the schema at all', () => {
    // Guards the guard: a regex that silently matched nothing would make every
    // assertion below vacuously true.
    expect(relationsToUser().length).toBeGreaterThan(5);
  });

  it('lists every non-cascading relation to users', () => {
    const blocking = relationsToUser()
      .filter((relation) => !relation.cascades)
      .map((relation) => delegate(relation.model))
      .sort();

    const listed = USER_DEPENDENCIES.map((d) => d.entity as string).sort();

    expect(listed).toEqual([...new Set(blocking)]);
  });

  it('omits every cascading relation', () => {
    const cascading = relationsToUser()
      .filter((relation) => relation.cascades)
      .map((relation) => delegate(relation.model));

    for (const entity of cascading) {
      expect(USER_DEPENDENCIES.map((d) => d.entity as string)).not.toContain(
        entity,
      );
    }
  });

  it('names every actual foreign-key column for each entry', () => {
    // Collected as a set per model, not a single value: a model may reference a
    // user through more than one column (Module 12's handover names an agent
    // and a receiver). A `Map` keyed by model would silently keep whichever
    // relation the scanner saw last, and an entry naming only the other column
    // would pass while counting the wrong rows.
    const schemaFields = new Map<string, Set<string>>();
    for (const relation of relationsToUser()) {
      if (relation.cascades) continue;
      const key = delegate(relation.model);
      const fields = schemaFields.get(key) ?? new Set<string>();
      fields.add(relation.field);
      schemaFields.set(key, fields);
    }

    for (const dependency of USER_DEPENDENCIES) {
      const field: string | readonly string[] = dependency.field;
      const declared = typeof field === 'string' ? [field] : [...field];

      // Every column the schema declares must be counted. This is the half that
      // catches a new nullable actor column being added to an existing model.
      expect([...(schemaFields.get(dependency.entity) ?? [])].sort()).toEqual(
        declared.sort(),
      );
    }
  });

  it('gives every entry a human-readable label for the 409 body', () => {
    for (const dependency of USER_DEPENDENCIES) {
      expect(dependency.label.length).toBeGreaterThan(0);
    }
  });
});
