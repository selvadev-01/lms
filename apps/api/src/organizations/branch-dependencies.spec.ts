import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BRANCH_DEPENDENCIES,
  canDelete,
  summarizeBlockers,
} from './branch-dependencies';

describe('branch dependencies', () => {
  describe('completeness against the schema', () => {
    /**
     * The guard that makes the rest of this module trustworthy.
     *
     * `BRANCH_DEPENDENCIES` is hand-maintained, and the failure mode of an
     * incomplete list is silent: a branch gets deleted while records still
     * point at it. Rather than trust a developer to remember, this reads
     * schema.prisma and asserts every relation Branch declares is covered.
     *
     * Parsing the schema text is crude, but the alternative — introspecting
     * Prisma's DMMF — pulls the generated client into a unit test that
     * otherwise needs no database and no codegen step.
     */
    it('covers every relation declared on the Branch model', () => {
      const schema = readFileSync(
        join(__dirname, '..', '..', 'prisma', 'schema.prisma'),
        'utf8',
      );

      const branchModel = /model Branch \{([\s\S]*?)\n\}/.exec(schema);
      expect(branchModel).not.toBeNull();

      // List-valued relations are the ones that reference this branch, i.e.
      // `users users[]`. Scalars, the parent `organization` relation and the
      // @@-level attributes are all excluded by the `[]` requirement.
      const relationLines = branchModel![1]
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => /^\w+\s+\w+\[\]$/.test(line));

      const modelNames = relationLines.map((line) => {
        const target = line.split(/\s+/)[1].replace('[]', '');
        // Prisma models are PascalCase; the client delegates are camelCase.
        return target.charAt(0).toLowerCase() + target.slice(1);
      });

      expect(modelNames.length).toBeGreaterThan(0);

      const covered = BRANCH_DEPENDENCIES.map((d) => d.entity as string);
      const missing = modelNames.filter((name) => !covered.includes(name));

      expect(missing).toEqual([]);
    });

    it('lists no entity that is not a real branch relation', () => {
      const schema = readFileSync(
        join(__dirname, '..', '..', 'prisma', 'schema.prisma'),
        'utf8',
      );
      const branchModel = /model Branch \{([\s\S]*?)\n\}/.exec(schema);
      const body = branchModel![1];

      for (const dependency of BRANCH_DEPENDENCIES) {
        const pascal =
          dependency.entity.charAt(0).toUpperCase() +
          dependency.entity.slice(1);
        expect(body).toContain(`${pascal}[]`);
      }
    });

    it('has a unique entity and a label for every dependency', () => {
      const entities = BRANCH_DEPENDENCIES.map((d) => d.entity);
      expect(new Set(entities).size).toBe(entities.length);

      for (const dependency of BRANCH_DEPENDENCIES) {
        expect(dependency.label.trim()).not.toBe('');
      }
    });
  });

  describe('summarizeBlockers', () => {
    it('returns nothing when every count is zero', () => {
      const counts = Object.fromEntries(
        BRANCH_DEPENDENCIES.map((d) => [d.entity, 0]),
      );

      expect(summarizeBlockers(counts)).toEqual([]);
    });

    it('returns nothing for an empty counts object', () => {
      // A missing key means the count was never taken, which for the purposes
      // of reporting is the same as zero. The guard itself always supplies
      // every key, so this only matters for defensive callers.
      expect(summarizeBlockers({})).toEqual([]);
    });

    it('reports only the non-zero categories', () => {
      const counts = Object.fromEntries(
        BRANCH_DEPENDENCIES.map((d) => [d.entity, 0]),
      );
      counts.loan = 3;
      counts.user = 1;

      expect(summarizeBlockers(counts)).toEqual([
        { entity: 'user', label: 'Users', count: 1 },
        { entity: 'loan', label: 'Loans', count: 3 },
      ]);
    });

    it('preserves declaration order rather than count order', () => {
      // Users first even though loans are more numerous: the order is the
      // fixed one from BRANCH_DEPENDENCIES, so the UI reads consistently.
      const counts = { loan: 99, user: 1 };
      const blockers = summarizeBlockers(counts);

      expect(blockers.map((b) => b.entity)).toEqual(['user', 'loan']);
    });
  });

  describe('canDelete', () => {
    it('permits deletion when nothing references the branch', () => {
      const counts = Object.fromEntries(
        BRANCH_DEPENDENCIES.map((d) => [d.entity, 0]),
      );

      expect(canDelete(counts)).toBe(true);
    });

    it.each(BRANCH_DEPENDENCIES.map((d) => d.entity))(
      'refuses deletion when a %s references the branch',
      (entity) => {
        const counts = Object.fromEntries(
          BRANCH_DEPENDENCIES.map((d) => [d.entity, 0]),
        );
        counts[entity] = 1;

        expect(canDelete(counts)).toBe(false);
      },
    );
  });
});
