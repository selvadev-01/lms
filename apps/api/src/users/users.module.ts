import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { EmployeeController } from './user/employee.controller';
import { PermissionController } from './rbac/permission.controller';
import { PermissionService } from './rbac/permission.service';
import { RoleController } from './rbac/role.controller';
import { RoleService } from './rbac/role.service';
import { UserController } from './user/user.controller';
import { UserService } from './user/user.service';

/**
 * Module 03 — Users, Employees, Roles & Permissions.
 *
 * One module for all surfaces, because they are one domain over one table: an
 * employee is a user carrying an `employeeCode`, and both are authorized by the
 * roles this module also defines. Splitting them would mean a module boundary
 * between a user and their role assignment.
 *
 * Imports `OrganizationsModule` for `BranchService`, so the rule that a branch
 * must be operational before it receives anything (Module 02 Scenario 16) is
 * asked of the module that owns it rather than reimplemented here, and
 * `AuthModule` for `PasswordService`/`PasswordPolicyService`, so an
 * administrator-set first password is hashed and policy-checked by the module
 * that owns credentials (Rule 48) rather than here. Everything else it needs —
 * Prisma, Audit, Authorization, Session — is `@Global()`.
 */
@Module({
  imports: [OrganizationsModule, AuthModule],
  controllers: [
    RoleController,
    PermissionController,
    UserController,
    EmployeeController,
  ],
  providers: [RoleService, PermissionService, UserService],
  exports: [RoleService, PermissionService, UserService],
})
export class UsersModule {}
