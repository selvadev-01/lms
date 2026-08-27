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
import type { GuarantorDocumentSummary } from '@lms/types';

import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { UploadGuarantorDocumentDto } from './dto/upload-guarantor-document.dto';
import { VerifyGuarantorDocumentDto } from './dto/verify-guarantor-document.dto';
import {
  CUSTOMERS_GUARANTORS_DOCUMENTS_DOWNLOAD_PERMISSION,
  CUSTOMERS_GUARANTORS_DOCUMENTS_UPLOAD_PERMISSION,
  CUSTOMERS_GUARANTORS_DOCUMENTS_VERIFY_PERMISSION,
  GuarantorDocumentService,
} from './guarantor-document.service';

/**
 * Guarantor KYC documents (Module 05 Scenarios 20, 21, 45).
 *
 * Nested two levels deep — customer, then guarantor — because that is the scope
 * chain: a document is reachable only through a guarantor, who is reachable only
 * through a customer the caller can already see. Flattening this to
 * `/guarantor-documents/:id` would make the scope check a thing to remember
 * rather than a consequence of the route.
 *
 * Its own permission family, separate from `customers.documents.*`. A branch
 * that may handle a borrower's identity papers is not thereby authorized over a
 * third party's, and Rule 11 treats guarantor data as protected in its own right.
 */
@Controller('customers/:customerId/guarantors/:guarantorId/documents')
export class GuarantorDocumentController {
  constructor(private readonly documents: GuarantorDocumentService) {}

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }

  @Get()
  @RequirePermissions(CUSTOMERS_GUARANTORS_DOCUMENTS_DOWNLOAD_PERMISSION)
  async list(
    @CurrentUser() user: AuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Param('guarantorId', ParseUUIDPipe) guarantorId: string,
    @Req() req: Request,
  ): Promise<{ documents: GuarantorDocumentSummary[] }> {
    const documents = await this.documents.list(
      user,
      customerId,
      guarantorId,
      this.meta(req),
    );

    return { documents };
  }

  /** Scenario 20 — upload, or replace with a new version. */
  @Post()
  @RequirePermissions(CUSTOMERS_GUARANTORS_DOCUMENTS_UPLOAD_PERMISSION)
  @UseInterceptors(FileInterceptor('file'))
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async upload(
    @CurrentUser() user: AuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Param('guarantorId', ParseUUIDPipe) guarantorId: string,
    @Body() dto: UploadGuarantorDocumentDto,
    @UploadedFile() file: { buffer: Buffer; originalname?: string } | undefined,
    @Req() req: Request,
  ): Promise<GuarantorDocumentSummary> {
    return this.documents.upload(
      user,
      customerId,
      guarantorId,
      dto,
      file,
      this.meta(req),
    );
  }

  @Post(':documentId/verify')
  @RequirePermissions(CUSTOMERS_GUARANTORS_DOCUMENTS_VERIFY_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async verify(
    @CurrentUser() user: AuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Param('guarantorId', ParseUUIDPipe) guarantorId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: VerifyGuarantorDocumentDto,
    @Req() req: Request,
  ): Promise<GuarantorDocumentSummary> {
    return this.documents.verify(
      user,
      customerId,
      guarantorId,
      documentId,
      dto,
      this.meta(req),
    );
  }

  /**
   * Streams the stored file.
   *
   * The same three response headers as the customer download, closing the same
   * holes: `attachment` so an uploaded SVG or PDF is saved rather than rendered
   * in-origin where it could run script, `nosniff` so the browser does not
   * second-guess the type we sniffed, and `private, no-store` to keep a
   * third party's identity document out of shared proxies and off the disk cache
   * of a shared branch terminal.
   */
  @Get(':documentId/file')
  @RequirePermissions(CUSTOMERS_GUARANTORS_DOCUMENTS_DOWNLOAD_PERMISSION)
  async download(
    @CurrentUser() user: AuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Param('guarantorId', ParseUUIDPipe) guarantorId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.documents.download(
      user,
      customerId,
      guarantorId,
      documentId,
      this.meta(req),
    );

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader(
      'Content-Disposition',
      // Quoted and stripped of quotes and control characters so the stored name
      // cannot break out of the header and inject another one.
      `attachment; filename="${file.fileName.replace(/["\r\n]/g, '')}"`,
    );
    if (file.size !== null) {
      res.setHeader('Content-Length', String(file.size));
    }

    file.stream.pipe(res);
  }
}
