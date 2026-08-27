import type {
  FieldCollectionDetail,
  FieldCollectionSummary,
  GpsCaptureStatus,
} from '@lms/types';

import {
  COLLECTION_INCLUDE,
  toCollectionDetail,
  toCollectionSummary,
  type CollectionRow,
} from '../../loans/collection/collection.mapper';

/**
 * Module 12 read shapes.
 *
 * # Why this decorates rather than replaces
 *
 * A field collection *is* a Module 11 collection, so `toCollectionSummary` and
 * `toCollectionDetail` produce every field they already produce, and these
 * functions add the custody and evidence columns on top. Widening the Module 11
 * mappers instead would put six always-undefined fields on every
 * over-the-counter payment and make the two modules' response shapes converge
 * into one that means neither thing precisely.
 *
 * The GPS coordinates are read through the check-in relation rather than stored
 * on the collection, so the evidence a detail page renders is the row the GPS
 * endpoint verified. A failed capture has no such row, which is exactly why
 * `gpsCaptureStatus` is a column of its own.
 */

/** The Module 11 relations, plus the evidence and custody links. */
export const FIELD_COLLECTION_INCLUDE = {
  ...COLLECTION_INCLUDE,
  gpsCheckIn: {
    select: { latitude: true, longitude: true, accuracyMeters: true },
  },
  custodyHandover: { select: { handoverNumber: true } },
} as const;

/**
 * A collection row with the field relations.
 *
 * Structural, for the reason `CollectionRow` documents: a renamed column is a
 * compile error rather than an `undefined` that reaches the UI.
 */
export interface FieldCollectionRow extends CollectionRow {
  isFieldCollection: boolean;
  gpsCaptureStatus: string | null;
  gpsCheckInId: string | null;
  fieldVisitId: string | null;
  customerAckReference: string | null;
  custodyHandoverId: string | null;
  verificationNotes?: string | null;
  gpsCheckIn?: {
    latitude: { toString(): string } | null;
    longitude: { toString(): string } | null;
    accuracyMeters: { toString(): string } | null;
  } | null;
  custodyHandover?: { handoverNumber: string } | null;
}

/**
 * Prisma returns a `Decimal` for the coordinate columns.
 *
 * Rendered as a string rather than a number for the reason money is: a
 * coordinate at seven decimal places is beyond what a float round-trips
 * exactly, and a drifting last digit on a location that is *evidence* is worse
 * than useless.
 *
 * Typed as `{ toString(): string }` rather than `unknown`, so the call is a
 * real method on a real object rather than a `String()` coercion that would
 * quietly render `[object Object]` if the column's type ever changed.
 */
function decimalToString(
  value: { toString(): string } | null | undefined,
): string | undefined {
  if (value === null || value === undefined) return undefined;
  return value.toString();
}

export function toFieldCollectionSummary(
  row: FieldCollectionRow,
): FieldCollectionSummary {
  return {
    ...toCollectionSummary(row),
    isFieldCollection: true,
    ...(row.gpsCaptureStatus
      ? { gpsCaptureStatus: row.gpsCaptureStatus as GpsCaptureStatus }
      : {}),
    ...(row.custodyHandoverId
      ? { custodyHandoverId: row.custodyHandoverId }
      : {}),
    ...(row.custodyHandover
      ? { custodyHandoverNumber: row.custodyHandover.handoverNumber }
      : {}),
  };
}

export function toFieldCollectionDetail(
  row: FieldCollectionRow,
): FieldCollectionDetail {
  const latitude = decimalToString(row.gpsCheckIn?.latitude);
  const longitude = decimalToString(row.gpsCheckIn?.longitude);
  const accuracy = decimalToString(row.gpsCheckIn?.accuracyMeters);

  return {
    ...toCollectionDetail(row),
    isFieldCollection: true,
    ...(row.gpsCaptureStatus
      ? { gpsCaptureStatus: row.gpsCaptureStatus as GpsCaptureStatus }
      : {}),
    ...(row.gpsCheckInId ? { gpsCheckInId: row.gpsCheckInId } : {}),
    ...(latitude ? { gpsLatitude: latitude } : {}),
    ...(longitude ? { gpsLongitude: longitude } : {}),
    ...(accuracy ? { gpsAccuracyMeters: accuracy } : {}),
    ...(row.fieldVisitId ? { fieldVisitId: row.fieldVisitId } : {}),
    ...(row.customerAckReference
      ? { customerAckReference: row.customerAckReference }
      : {}),
    ...(row.custodyHandoverId
      ? { custodyHandoverId: row.custodyHandoverId }
      : {}),
    ...(row.custodyHandover
      ? { custodyHandoverNumber: row.custodyHandover.handoverNumber }
      : {}),
    ...(row.verificationNotes
      ? { verificationNotes: row.verificationNotes }
      : {}),
  };
}
