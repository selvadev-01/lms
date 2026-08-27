import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * KYC document storage.
 *
 * An interface rather than a concrete class because the local-disk
 * implementation below is an applied default, not an architectural commitment:
 * a deployment that wants S3 replaces one provider and nothing above this line
 * changes. What must not change is the guarantee — a stored file is reachable
 * only by a caller the service has authorized, never by URL alone (Scenarios 12,
 * 32). Presigned URLs would weaken exactly that, which is why the default is
 * streamed-through-the-API rather than redirect-to-bucket.
 */
export interface FileStorage {
  /** Writes bytes and returns the opaque key to store on the document row. */
  save(input: SaveFileInput): Promise<StoredFile>;
  /** Opens a stored file for streaming. Throws if the key does not resolve. */
  read(fileRef: string): Promise<Readable>;
  /** Best-effort removal. Used to roll back a failed upload transaction. */
  remove(fileRef: string): Promise<void>;
}

export interface SaveFileInput {
  orgId: string;
  /**
   * The customer the bytes belong to — for a guarantor's KYC document, the
   * customer that guarantor stands for, not the guarantor.
   *
   * Named for the directory it becomes rather than for one caller, because both
   * customer and guarantor documents land under the same customer prefix. That
   * keeps a per-customer retention or export sweep a single directory operation
   * (Q-CUST-18), which it would not be if a guarantor's pack lived elsewhere.
   */
  ownerId: string;
  buffer: Buffer;
  /** Sniffed content type, never the client-supplied header. */
  mimeType: string;
}

export interface StoredFile {
  fileRef: string;
  size: number;
  /** SHA-256 of the bytes, for integrity checking and duplicate detection. */
  checksum: string;
}

export const FILE_STORAGE = Symbol('FILE_STORAGE');

/**
 * The extensions this module is willing to write.
 *
 * Derived from the sniffed type, not from the uploaded filename: a file named
 * `id.pdf` that is actually an HTML document must land on disk as `.html` or
 * not at all, because the extension is what a misconfigured static server would
 * later use to decide how to serve it.
 */
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};

/**
 * Local-disk implementation (Q-CUST-16).
 *
 * Layout is `<root>/<orgId>/<ownerId>/<uuid>.<ext>`, where `ownerId` is the
 * customer — a guarantor's documents sit under the customer they stand for.
 * The organization prefix
 * is not a security boundary — the authorization check in the service is — but it
 * makes a per-tenant retention or export policy a directory operation rather
 * than a query, which Q-CUST-18 will eventually need.
 *
 * Filenames are UUIDs rather than anything derived from the upload. A
 * client-supplied name reaching the filesystem is the classic path-traversal
 * bug (`../../etc/passwd`), and even sanitized it would leak the document's
 * nature to anyone who could list the directory.
 */
@Injectable()
export class LocalFileStorage implements FileStorage {
  private readonly logger = new Logger(LocalFileStorage.name);
  private readonly root: string;

  constructor(config: ConfigService) {
    this.root = resolve(
      config.get<string>('customers.kycStorageDir') ?? './storage/kyc',
    );
  }

  async save(input: SaveFileInput): Promise<StoredFile> {
    const extension = EXTENSION_BY_MIME[input.mimeType] ?? 'bin';
    // The uuid is the whole filename: nothing the caller supplied reaches the
    // path, so there is no traversal sequence to sanitize.
    const relative = join(
      input.orgId,
      input.ownerId,
      `${randomUUID()}.${extension}`,
    );
    const absolute = this.absolute(relative);

    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, input.buffer, { flag: 'wx' });

    return {
      // Stored with forward slashes regardless of platform, so a row written on
      // Windows still resolves on Linux.
      fileRef: relative.split(sep).join('/'),
      size: input.buffer.byteLength,
      checksum: createHash('sha256').update(input.buffer).digest('hex'),
    };
  }

  /**
   * Not `async`: `createReadStream` is synchronous, and the interface's
   * `Promise` exists for implementations that genuinely await — an S3 client,
   * for instance. Returning the resolved promise directly keeps the contract
   * without claiming an await that never happens.
   */
  read(fileRef: string): Promise<Readable> {
    return Promise.resolve(createReadStream(this.absolute(fileRef)));
  }

  async remove(fileRef: string): Promise<void> {
    try {
      await unlink(this.absolute(fileRef));
    } catch (error) {
      // A missing file is the desired end state, so it is not an error. Anything
      // else is logged rather than thrown: this runs on the rollback path, and
      // masking the original failure with a cleanup failure would hide why the
      // upload was being undone in the first place.
      this.logger.warn(
        `Could not remove stored file ${fileRef}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  /**
   * Resolves a stored key against the storage root, refusing anything that
   * escapes it.
   *
   * Defence in depth: every key this class writes is a UUID triple it generated
   * itself, so a traversal sequence should be impossible. This check is what
   * makes that true even if a `file_ref` were ever set from another source — a
   * migration, a fixture, or a future importer — because the cost of being wrong
   * is reading an arbitrary file off the server.
   */
  private absolute(fileRef: string): string {
    const candidate = resolve(this.root, fileRef);

    if (candidate !== this.root && !candidate.startsWith(this.root + sep)) {
      throw new Error('Resolved storage path escapes the storage root');
    }

    return candidate;
  }
}
