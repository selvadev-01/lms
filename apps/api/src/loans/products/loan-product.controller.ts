import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { LoanProductDetail, LoanProductSummary } from '@lms/types';

import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreateLoanProductDto } from './dto/create-loan-product.dto';
import { ListLoanProductsDto } from './dto/list-loan-products.dto';
import { SetLoanConfigStatusDto } from './dto/set-loan-config-status.dto';
import { UpdateLoanProductDto } from './dto/update-loan-product.dto';
import {
  LOAN_PRODUCTS_ACTIVATE_PERMISSION,
  LOAN_PRODUCTS_MANAGE_PERMISSION,
  LOAN_PRODUCTS_VIEW_PERMISSION,
  LoanProductService,
} from './loan-product.service';

/**
 * Module 06 — Loan Products.
 *
 * Read and write are separate permissions so the seed can give a Branch Admin
 * `loans.products.view` — they must see which products exist to pick a scheme —
 * without any ability to change what the organization lends. Every write here is
 * Super-Admin-only in practice.
 */
@Controller('loan-products')
export class LoanProductController {
  constructor(private readonly products: LoanProductService) {}

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }

  @Get()
  @RequirePermissions(LOAN_PRODUCTS_VIEW_PERMISSION)
  async list(
    @CurrentUser() user: AuthContext,
    @Query() query: ListLoanProductsDto,
    @Req() req: Request,
  ): Promise<{ products: LoanProductSummary[] }> {
    const products = await this.products.list(user, query, this.meta(req));

    return { products };
  }

  @Post()
  @RequirePermissions(LOAN_PRODUCTS_MANAGE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async create(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateLoanProductDto,
    @Req() req: Request,
  ): Promise<LoanProductDetail> {
    return this.products.create(user, dto, this.meta(req));
  }

  @Get(':productId')
  @RequirePermissions(LOAN_PRODUCTS_VIEW_PERMISSION)
  async getById(
    @CurrentUser() user: AuthContext,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Req() req: Request,
  ): Promise<LoanProductDetail> {
    return this.products.getById(user, productId, this.meta(req));
  }

  @Patch(':productId')
  @RequirePermissions(LOAN_PRODUCTS_MANAGE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async update(
    @CurrentUser() user: AuthContext,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateLoanProductDto,
    @Req() req: Request,
  ): Promise<LoanProductDetail> {
    return this.products.update(user, productId, dto, this.meta(req));
  }

  @Post(':productId/status')
  @RequirePermissions(LOAN_PRODUCTS_ACTIVATE_PERMISSION)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async setStatus(
    @CurrentUser() user: AuthContext,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: SetLoanConfigStatusDto,
    @Req() req: Request,
  ): Promise<LoanProductDetail> {
    return this.products.setStatus(user, productId, dto, this.meta(req));
  }
}
