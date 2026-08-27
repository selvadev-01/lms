import { IsString } from 'class-validator';

import { CreateGuarantorDto } from './create-guarantor.dto';

/**
 * Guarantor edit (Module 05 Scenarios 11, 46).
 *
 * The create shape plus the concurrency token. A guarantor has no partial-edit
 * surface, so extending rather than redefining keeps the two from drifting —
 * a field added to the create form is editable by construction.
 *
 * `force` is inherited but never read on this path: duplicate detection runs at
 * create time. An edit that moves a mobile onto an existing one is a rename of a
 * record that already exists, not a second record being made.
 */
export class UpdateGuarantorDto extends CreateGuarantorDto {
  /**
   * The `updatedAt` the caller last read. A stale value means the row moved
   * underneath them and the write is refused with a 409 rather than applied
   * over the change they never saw (Scenario 46).
   */
  @IsString()
  expectedVersion!: string;
}
