import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

/**
 * Replace a user's role assignments — Scenarios 34, 35, 36, 37.
 *
 * A full replacement, like the role permission editor and for the same reason: an
 * add/remove pair would need its own concurrency story, whereas a replacement is
 * last-write-wins inside one transaction.
 *
 * `min(1)` because role assignment is explicit (Rule 19). Stripping a user of
 * every role is expressed by deactivating the account, which is a different
 * endpoint carrying a different audit action and a different meaning — an
 * account with no roles is not "switched off", it is a puzzle.
 */
export class AssignRolesDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Role is required' })
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true, message: 'Select a valid role' })
  roleIds!: string[];
}
