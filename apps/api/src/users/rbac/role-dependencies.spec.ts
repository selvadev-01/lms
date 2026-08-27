import {
  ROLE_DEPENDENCIES,
  canDeleteRole,
  summarizeRoleBlockers,
} from './role-dependencies';

/**
 * The role delete guard's data question.
 *
 * The list is short enough that these tests look trivial, but the reason it is
 * short is the thing worth pinning down: `role_permissions` cascades and must
 * NOT block, while `user_roles` must. Getting that backwards would either make
 * every role with a permission undeletable, or let a role be deleted out from
 * under the users holding it — silently stripping their access.
 */

describe('ROLE_DEPENDENCIES', () => {
  it('blocks on assigned users', () => {
    expect(ROLE_DEPENDENCIES.map((d) => d.entity)).toContain('userRole');
  });

  it("does not block on the role's own permission grants", () => {
    // rolePermission is onDelete: Cascade — those rows are the role's
    // definition, not independent records that would be orphaned.
    expect(ROLE_DEPENDENCIES.map((d) => d.entity)).not.toContain(
      'rolePermission',
    );
  });

  it('gives every entry a human-readable label for the 409 body', () => {
    for (const dependency of ROLE_DEPENDENCIES) {
      expect(dependency.label.length).toBeGreaterThan(0);
    }
  });
});

describe('summarizeRoleBlockers', () => {
  it('reports a dependency that has rows', () => {
    expect(summarizeRoleBlockers({ userRole: 3 })).toEqual([
      { entity: 'userRole', label: 'Assigned users', count: 3 },
    ]);
  });

  it('drops zero counts — a caller needs what is in the way, not an inventory', () => {
    expect(summarizeRoleBlockers({ userRole: 0 })).toEqual([]);
  });

  it('treats a missing count as zero', () => {
    expect(summarizeRoleBlockers({})).toEqual([]);
  });
});

describe('canDeleteRole', () => {
  it('permits deletion when nothing references the role', () => {
    expect(canDeleteRole({ userRole: 0 })).toBe(true);
  });

  it('refuses while any user holds it', () => {
    expect(canDeleteRole({ userRole: 1 })).toBe(false);
  });
});
