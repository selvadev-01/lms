import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';

/**
 * The role's complete permission set, as a replacement rather than a delta.
 *
 * `PUT`, not `PATCH`, and this DTO says why: the request carries what the role
 * should grant *afterwards*, not what to add or remove. Add and remove endpoints
 * would need their own concurrency story — two administrators each removing a
 * different permission would silently reorder — whereas a full replacement is
 * last-write-wins in one transaction, which is a rule that can be explained.
 *
 * An empty array is valid and means "revoke everything". A separate
 * revoke-all endpoint would be the same operation under a second name.
 *
 * Not `@IsOptional()`: an absent `permissions` and an empty one would otherwise
 * be indistinguishable, and the first is far more likely to be a client bug than
 * an intent to strip a role bare.
 */
export class SetRolePermissionsDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(150, { each: true })
  permissions!: string[];
}
