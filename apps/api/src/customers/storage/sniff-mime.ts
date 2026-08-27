/**
 * Content-type detection by magic bytes (Q-CUST-16).
 *
 * The client's `Content-Type` header and the uploaded filename are both
 * assertions by the uploader, not evidence. Trusting either means a caller can
 * store an HTML page, a script or an executable as `id-proof.jpg` — and the risk
 * is not hypothetical, because these files are later handed back to a browser.
 * The response sets `Content-Disposition: attachment` and a sniffed type, but
 * the first and cheapest defence is refusing to store the bytes at all.
 *
 * Deliberately narrow: three formats, checked by signature, nothing inferred. An
 * unrecognized file is rejected rather than stored as `application/octet-stream`,
 * because "we do not know what this is" is not a good reason to keep it in a
 * directory of regulated personal documents.
 *
 * No third-party dependency for this. `file-type` and friends detect hundreds of
 * formats, which is the opposite of what a whitelist wants, and the three
 * signatures below are stable and short enough to state outright.
 */

/** The only content types this module will accept (Q-CUST-16). */
export const ALLOWED_DOCUMENT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'application/pdf',
] as const;

export type AllowedDocumentMimeType =
  (typeof ALLOWED_DOCUMENT_MIME_TYPES)[number];

/** Human-readable list for the rejection message. */
export const ALLOWED_DOCUMENT_LABEL = 'JPG, PNG or PDF';

function startsWith(buffer: Buffer, signature: readonly number[]): boolean {
  if (buffer.length < signature.length) return false;
  return signature.every((byte, index) => buffer[index] === byte);
}

/**
 * Returns the detected type, or `null` when the bytes are not one of the three
 * accepted formats.
 *
 * JPEG is identified by `FF D8 FF`, which covers JFIF, Exif and raw variants
 * alike — the fourth byte differs between them, so it is deliberately not
 * checked. PNG uses its full 8-byte signature, whose trailing CRLF/EOF bytes
 * exist precisely to catch a file mangled by a text-mode transfer. PDF is
 * `%PDF-`, which by specification may appear within the first 1024 bytes rather
 * than strictly at offset zero, so a short prefix is searched.
 */
export function sniffDocumentMimeType(
  buffer: Buffer,
): AllowedDocumentMimeType | null {
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg';
  }

  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }

  // Some producers emit leading whitespace or a BOM before the header, and
  // readers accept it, so a strict offset-zero check would reject files every
  // other tool considers valid.
  const prefix = buffer.subarray(0, 1024).toString('latin1');
  if (prefix.includes('%PDF-')) {
    return 'application/pdf';
  }

  return null;
}
