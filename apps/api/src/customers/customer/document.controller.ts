import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { CustomerDocumentSummary } from '@lms/types';

import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  CUSTOMERS_DOCUMENTS_DOWNLOAD_PERMISSION,
  CUSTOMERS_DOCUMENTS_UPLOAD_PERMISSION,
  CUSTOMERS_DOCUMENTS_VERIFY_PERMISSION,
  DocumentService,
} from './document.service';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { VerifyDocumentDto } from './dto/verify-document.dto';

/**
 * KYC documents (Module 04, Scenarios 6, 11, 12, 32).
 *
 * The download route is the reason this controller exists in this shape. A KYC
 * document is regulated personal data, and the story requires that a document
 * belonging to a customer outside the caller's scope be refused even on direct
 * access. The only way to guarantee that is for the bytes to have no address of
 * their own: nothing is served statically, no URL is signed, and every read goes
 * through a handler that re-checks scope and audits the access.
 *
 * `memoryStorage` is deliberate. Multer's disk storage would write the upload
 * before anything had validated it, leaving a rejected file — possibly an
 * executable — sitting in a temp directory. Holding it in memory means an
 * unacceptable file is never written at all, and the 5 MB cap makes that
 * bounded.
 */
@Controller('customers/:customerId/documents')
export class DocumentController {
  constructor(private readonly documents: DocumentService) {}

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }

  @Get()
  @RequirePermissions(CUSTOMERS_DOCUMENTS_DOWNLOAD_PERMISSION)
  async list(
    @CurrentUser() user: AuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Req() req: Request,
  ): Promise<{ documents: CustomerDocumentSummary[] }> {
    const documents = await this.documents.list(
      user,
      customerId,
      this.meta(req),
    );

    return { documents };
  }

  /** Scenarios 6, 11 — upload, or replace with a new version. */
  @Post()
  @RequirePermissions(CUSTOMERS_DOCUMENTS_UPLOAD_PERMISSION)
  @UseInterceptors(FileInterceptor('file'))
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async upload(
    @CurrentUser() user: AuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: { buffer: Buffer; originalname?: string } | undefined,
    @Req() req: Request,
  ): Promise<CustomerDocumentSummary> {
    return this.documents.upload(user, customerId, dto, file, this.meta(req));
  }

  @Post(':documentId/verify')
  @RequirePermissions(CUSTOMERS_DOCUMENTS_VERIFY_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async verify(
    @CurrentUser() user: AuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: VerifyDocumentDto,
    @Req() req: Request,
  ): Promise<CustomerDocumentSummary> {
    return this.documents.verify(
      user,
      customerId,
      documentId,
      dto,
      this.meta(req),
    );
  }

  /**
   * Streams the stored file (Scenarios 12, 32).
   *
   * Three response headers matter here, and each closes a specific hole:
   *
   * - `Content-Disposition: attachment` means the browser saves rather than
   *   renders. An uploaded SVG or PDF that renders in-origin can run script;
   *   downloaded, it cannot.
   * - `X-Content-Type-Options: nosniff` stops the browser from second-guessing
   *   the type we sniffed and treating a mislabelled file as HTML.
   * - `Cache-Control: private, no-store` keeps a KYC document out of shared
   *   proxies and out of the disk cache on a shared branch terminal.
   */
  @Get(':documentId/file')
  @RequirePermissions(CUSTOMERS_DOCUMENTS_DOWNLOAD_PERMISSION)
  async download(
    @CurrentUser() user: AuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.documents.download(
      user,
      customerId,
      documentId,
      this.meta(req),
    );

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader(
      'Content-Disposition',
      // The stored name is quoted and stripped of quotes and control characters
      // so it cannot break out of the header and inject another one.
      `attachment; filename="${file.fileName.replace(/["\r\n]/g, '')}"`,
    );
    if (file.size !== null) {
      res.setHeader('Content-Length', String(file.size));
    }

    file.stream.pipe(res);
  }
}
