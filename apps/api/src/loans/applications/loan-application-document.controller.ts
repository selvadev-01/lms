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
import type { LoanApplicationDocumentSummary } from '@lms/types';

import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  ReuseApplicationDocumentDto,
  UploadApplicationDocumentDto,
  VerifyApplicationDocumentDto,
} from './dto/loan-application.dto';
import {
  APPLICATIONS_DOCUMENTS_DOWNLOAD_PERMISSION,
  APPLICATIONS_DOCUMENTS_UPLOAD_PERMISSION,
  APPLICATIONS_DOCUMENTS_VERIFY_PERMISSION,
  APPLICATIONS_DOCUMENTS_VIEW_PERMISSION,
  LoanApplicationDocumentService,
} from './loan-application-document.service';

/**
 * Loan application supporting documents (Scenarios 17-20).
 *
 * A separate controller from `LoanApplicationController` rather than more routes
 * on it, because the four permissions here are genuinely independent of the
 * application's own: a clerk who may attach an income statement is not thereby
 * someone who may approve the loan, and a reviewer who may verify a document is
 * not necessarily allowed to read the file behind it.
 */
@Controller('loan-applications/:applicationId/documents')
export class LoanApplicationDocumentController {
  constructor(private readonly documents: LoanApplicationDocumentService) {}

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }

  @Get()
  @RequirePermissions(APPLICATIONS_DOCUMENTS_VIEW_PERMISSION)
  async list(
    @CurrentUser() user: AuthContext,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Req() req: Request,
  ): Promise<{ documents: LoanApplicationDocumentSummary[] }> {
    const documents = await this.documents.list(
      user,
      applicationId,
      this.meta(req),
    );

    return { documents };
  }

  /** Scenarios 17, 19. Replacing a document supersedes rather than overwrites. */
  @Post()
  @RequirePermissions(APPLICATIONS_DOCUMENTS_UPLOAD_PERMISSION)
  @UseInterceptors(FileInterceptor('file'))
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async upload(
    @CurrentUser() user: AuthContext,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() dto: UploadApplicationDocumentDto,
    @UploadedFile() file: { buffer: Buffer; originalname?: string } | undefined,
    @Req() req: Request,
  ): Promise<LoanApplicationDocumentSummary> {
    return this.documents.upload(
      user,
      applicationId,
      dto,
      file,
      this.meta(req),
    );
  }

  /**
   * What this customer filed on an earlier application, offered for reuse.
   *
   * Declared before the `:documentId` routes below: a param route in the same
   * controller would otherwise match `reusable` as a document id.
   */
  @Get('reusable')
  @RequirePermissions(APPLICATIONS_DOCUMENTS_VIEW_PERMISSION)
  async reusable(
    @CurrentUser() user: AuthContext,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Req() req: Request,
  ): Promise<{ documents: LoanApplicationDocumentSummary[] }> {
    const documents = await this.documents.reusable(
      user,
      applicationId,
      this.meta(req),
    );

    return { documents };
  }

  /**
   * Attach one of them. Same permission as uploading, because that is what this
   * is — attaching evidence, by pointing at a file already stored rather than
   * sending it again.
   */
  @Post('reuse')
  @RequirePermissions(APPLICATIONS_DOCUMENTS_UPLOAD_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async reuse(
    @CurrentUser() user: AuthContext,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() dto: ReuseApplicationDocumentDto,
    @Req() req: Request,
  ): Promise<LoanApplicationDocumentSummary> {
    return this.documents.reuse(user, applicationId, dto, this.meta(req));
  }

  @Post(':documentId/verify')
  @RequirePermissions(APPLICATIONS_DOCUMENTS_VERIFY_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async verify(
    @CurrentUser() user: AuthContext,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: VerifyApplicationDocumentDto,
    @Req() req: Request,
  ): Promise<LoanApplicationDocumentSummary> {
    return this.documents.verify(
      user,
      applicationId,
      documentId,
      dto,
      this.meta(req),
    );
  }

  /**
   * Streams the stored file (Scenario 20).
   *
   * Three response headers matter, and each closes a specific hole:
   *
   * - `Content-Disposition: attachment` means the browser saves rather than
   *   renders. A PDF that renders in-origin can run script; downloaded, it
   *   cannot.
   * - `X-Content-Type-Options: nosniff` stops the browser second-guessing the
   *   type we sniffed and treating a mislabelled file as HTML.
   * - `Cache-Control: private, no-store` keeps a borrower's income statement out
   *   of shared proxies and off the disk of a shared branch terminal.
   */
  @Get(':documentId/file')
  @RequirePermissions(APPLICATIONS_DOCUMENTS_DOWNLOAD_PERMISSION)
  async download(
    @CurrentUser() user: AuthContext,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.documents.download(
      user,
      applicationId,
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
