import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { trim } from '../../../common/transforms/trim';

/**
 * Module 12 — offline sync queue DTOs.
 *
 * The payload is `IsObject` and nothing more, deliberately. It is a device's
 * own record of what it captured, not a posting request: nothing financial
 * turns on it, and the collection it describes is validated properly when it
 * reaches the sync endpoint. Validating it twice, in two shapes, is how the two
 * come to disagree about what a valid capture looks like.
 */

export class EnqueueSyncItemDto {
  /**
   * The device's stable id for this item.
   *
   * Unique per organization, which makes a re-report idempotent for free: a
   * device that lost a response and reports again updates its row rather than
   * creating a second one an operator would chase as a phantom.
   */
  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Client Transaction Id is required' })
  @MaxLength(150, { message: 'Client Transaction Id is too long' })
  clientTransactionId!: string;

  @IsString()
  @Transform(trim)
  @IsNotEmpty({ message: 'Entity Type is required' })
  @MaxLength(50, { message: 'Entity Type is too long' })
  entityType!: string;

  @IsObject({ message: 'Payload must be an object' })
  payload!: Record<string, unknown>;

  /** When the device queued it. Evidence, never authoritative. */
  @IsISO8601({ strict: true }, { message: 'Queued time must be a timestamp' })
  queuedAt!: string;
}

export class ListSyncItemsDto {
  @IsOptional()
  @IsIn(['QUEUED', 'SYNCING', 'SYNCED', 'FAILED', 'CONFLICT'])
  status?: 'QUEUED' | 'SYNCING' | 'SYNCED' | 'FAILED' | 'CONFLICT';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
