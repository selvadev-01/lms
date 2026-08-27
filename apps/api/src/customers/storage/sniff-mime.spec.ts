import {
  ALLOWED_DOCUMENT_MIME_TYPES,
  sniffDocumentMimeType,
} from './sniff-mime';

/**
 * Content-type detection by magic bytes (Q-CUST-16).
 *
 * This is the check that stops a caller storing an HTML page or a script as
 * `id-proof.jpg`. The uploaded filename and the request's `Content-Type` are
 * both assertions by the uploader, so the only thing that decides what a file is
 * are its own bytes — and these tests are the proof that nothing else is
 * consulted.
 *
 * The whitelist is deliberately narrow. An unrecognized file is rejected rather
 * than stored as `application/octet-stream`: "we do not know what this is" is
 * not a good reason to keep something in a directory of regulated personal
 * documents.
 */

const JPEG_JFIF = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const JPEG_EXIF = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10, 0x45, 0x78]);
const JPEG_RAW = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43]);
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
]);
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n', 'latin1');

describe('sniffDocumentMimeType', () => {
  // The fourth byte differs between JFIF, Exif and raw variants, so it is
  // deliberately not checked — all three are ordinary camera and scanner output.
  it.each([
    ['JFIF', JPEG_JFIF],
    ['Exif', JPEG_EXIF],
    ['raw', JPEG_RAW],
  ])('detects a %s JPEG', (_label, buffer) => {
    expect(sniffDocumentMimeType(buffer)).toBe('image/jpeg');
  });

  it('detects a PNG by its full 8-byte signature', () => {
    expect(sniffDocumentMimeType(PNG)).toBe('image/png');
  });

  it('detects a PDF', () => {
    expect(sniffDocumentMimeType(PDF)).toBe('application/pdf');
  });

  // By specification the PDF header may appear within the first 1024 bytes, and
  // producers do emit leading whitespace or a BOM. A strict offset-zero check
  // would reject files every other reader accepts.
  it('detects a PDF whose header is not at offset zero', () => {
    const shifted = Buffer.concat([Buffer.from('﻿\n  ', 'latin1'), PDF]);

    expect(sniffDocumentMimeType(shifted)).toBe('application/pdf');
  });

  it('does not search beyond the first 1024 bytes for a PDF header', () => {
    const buried = Buffer.concat([Buffer.alloc(2048, 0x20), PDF]);

    expect(sniffDocumentMimeType(buried)).toBeNull();
  });

  /**
   * The attack this exists to stop: a file that is really HTML, named and
   * declared as an image, which would run script if a browser ever rendered it
   * in-origin.
   */
  it('rejects an HTML document regardless of what it is called', () => {
    const html = Buffer.from(
      '<!doctype html><script>alert(1)</script>',
      'latin1',
    );

    expect(sniffDocumentMimeType(html)).toBeNull();
  });

  it.each([
    ['SVG', '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'],
    ['a shell script', '#!/bin/sh\nrm -rf /\n'],
    ['plain text', 'this is just a note'],
  ])('rejects %s', (_label, content) => {
    expect(sniffDocumentMimeType(Buffer.from(content, 'latin1'))).toBeNull();
  });

  it('rejects a Windows executable', () => {
    // `MZ`, the DOS header every PE binary starts with.
    const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);

    expect(sniffDocumentMimeType(exe)).toBeNull();
  });

  it('rejects a ZIP archive, which an Office document also looks like', () => {
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);

    expect(sniffDocumentMimeType(zip)).toBeNull();
  });

  it('rejects a GIF, which is an image but not an accepted one', () => {
    const gif = Buffer.from('GIF89a', 'latin1');

    expect(sniffDocumentMimeType(gif)).toBeNull();
  });

  it('rejects an empty buffer', () => {
    expect(sniffDocumentMimeType(Buffer.alloc(0))).toBeNull();
  });

  // A truncated signature must not partially match: the first two bytes of a
  // PNG are shared with nothing accepted, but a length check is what guarantees
  // the comparison does not read past the end.
  it('rejects a buffer shorter than the signature it starts to match', () => {
    expect(sniffDocumentMimeType(Buffer.from([0x89, 0x50]))).toBeNull();
  });

  it('only ever returns a type from the whitelist', () => {
    const detected = [JPEG_JFIF, PNG, PDF].map(sniffDocumentMimeType);

    expect(
      detected.every(
        (type) =>
          type !== null &&
          (ALLOWED_DOCUMENT_MIME_TYPES as readonly string[]).includes(type),
      ),
    ).toBe(true);
  });
});
