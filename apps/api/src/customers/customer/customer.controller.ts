import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type {
  CustomerDeleteBlockedResponse,
  CustomerDetail,
  CustomerListResponse,
  CustomerProfileResponse,
  DeleteCustomerResponse,
} from '@lms/types';

import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  CUSTOMERS_ACTIVATE_PERMISSION,
  CUSTOMERS_CONVERT_PERMISSION,
  CUSTOMERS_CREATE_PERMISSION,
  CUSTOMERS_DELETE_PERMISSION,
  CUSTOMERS_UPDATE_PERMISSION,
  CUSTOMERS_VIEW_PERMISSION,
  CustomerService,
} from './customer.service';
import { CustomerMobileService } from './customer-mobile.service';
import { DocumentService } from './document.service';
import { ConvertCustomerTypeDto } from './dto/convert-customer-type.dto';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { ListCustomersDto } from './dto/list-customers.dto';
import { SetCustomerStatusDto } from './dto/set-customer-status.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { VerifyMobileOtpDto } from './dto/verify-mobile-otp.dto';
import { GuarantorService } from '../guarantor/guarantor.service';
import { KycService } from './kyc.service';

/**
 * Customer Management — the Branch Admin flow's "Customer Search → View Profile
 * / Edit" and "Create Customer" branches.
 *
 * Thin by design: every authorization decision that depends on the *record*
 * rather than on the *request* lives in the services, because that is where the
 * record is. The controller's job is to name the permission, pass the
 * `AuthContext` through, and shape the response.
 *
 * No handler accepts an `orgId`, and none reads a branch from the body. Both
 * come from the JWT via `@CurrentUser()`, which is what makes Scenarios 30 and
 * 31 structural rather than a check that could be omitted from one route.
 */
@Controller('customers')
export class CustomerController {
  constructor(
    private readonly customers: CustomerService,
    private readonly kyc: KycService,
    private readonly documents: DocumentService,
    private readonly guarantors: GuarantorService,
    private readonly mobile: CustomerMobileService,
  ) {}

  private meta(req: Request): RequestMeta {
    return {
      requestId: (req as Request & { requestId?: string }).requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    };
  }

  /** Scenarios 18, 19, 20, 21 — search, confined to the caller's scope. */
  @Get()
  @RequirePermissions(CUSTOMERS_VIEW_PERMISSION)
  async list(
    @CurrentUser() user: AuthContext,
    @Query() query: ListCustomersDto,
    @Req() req: Request,
  ): Promise<CustomerListResponse> {
    const customers = await this.customers.list(user, query, this.meta(req));

    return { customers };
  }

  /** Scenarios 1, 2, 3, 4, 5. */
  @Post()
  @RequirePermissions(CUSTOMERS_CREATE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async create(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateCustomerDto,
    @Req() req: Request,
  ): Promise<CustomerDetail> {
    return this.customers.create(user, dto, this.meta(req));
  }

  /**
   * The profile screen's aggregate read (Scenario 22).
   *
   * One request rather than four, because the profile is one screen and four
   * round trips would make its tabs load raggedly. Each sub-service still
   * applies its own scope check — this is a convenience for the client, not a
   * shortcut past authorization.
   */
  @Get(':customerId')
  @RequirePermissions(CUSTOMERS_VIEW_PERMISSION)
  async getById(
    @CurrentUser() user: AuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Req() req: Request,
  ): Promise<CustomerProfileResponse> {
    const meta = this.meta(req);
    const customer = await this.customers.getById(user, customerId, meta);

    // A LOCAL customer has no KYC record at all, which is not an error — it is
    // how "no KYC required" is represented (Q-CUST-2).
    const kyc =
      customer.customerType === 'KYC'
        ? await this.kyc.get(user, customerId, meta).catch(() => undefined)
        : undefined;

    const [documents, guarantors] = await Promise.all([
      this.documents.list(user, customerId, meta),
      this.guarantors.list(user, customerId, meta),
    ]);

    return { customer, kyc, documents, guarantors };
  }

  /** Scenarios 23, 36, 41. */
  @Patch(':customerId')
  @RequirePermissions(CUSTOMERS_UPDATE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async update(
    @CurrentUser() user: AuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: UpdateCustomerDto,
    @Req() req: Request,
  ): Promise<CustomerDetail> {
    return this.customers.update(user, customerId, dto, this.meta(req));
  }

  /** Q-CUST-11, Q-CUST-12, and Scenario 14's refusal. */
  @Post(':customerId/status')
  @RequirePermissions(CUSTOMERS_ACTIVATE_PERMISSION)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async setStatus(
    @CurrentUser() user: AuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: SetCustomerStatusDto,
    @Req() req: Request,
  ): Promise<CustomerDetail> {
    return this.customers.setStatus(user, customerId, dto, this.meta(req));
  }

  /** Scenarios 27, 28, 29 — LOCAL to KYC on the existing record. */
  @Post(':customerId/convert')
  @RequirePermissions(CUSTOMERS_CONVERT_PERMISSION)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async convert(
    @CurrentUser() user: AuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: ConvertCustomerTypeDto,
    @Req() req: Request,
  ): Promise<CustomerDetail> {
    return this.customers.convertToKyc(user, customerId, dto, this.meta(req));
  }

  /**
   * Scenario 37 — deletion, blocked when financial history exists.
   *
   * Answers 200 with `deleted: false` and the blockers rather than throwing a
   * 409, so the blocked and successful shapes are the same readable object.
   * Following the Module 03 precedent, where the same choice lets the UI render
   * "cannot delete because…" without parsing an error body.
   */
  @Delete(':customerId')
  @RequirePermissions(CUSTOMERS_DELETE_PERMISSION)
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async remove(
    @CurrentUser() user: AuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Req() req: Request,
  ): Promise<DeleteCustomerResponse | CustomerDeleteBlockedResponse> {
    const outcome = await this.customers.remove(
      user,
      customerId,
      this.meta(req),
    );

    if (!outcome.deleted) {
      return {
        message:
          'This customer has financial history and cannot be deleted. Deactivate them instead.',
        blockedBy: outcome.blockedBy,
      };
    }

    return { customerId, deleted: true };
  }

  /**
   * LOCAL mobile verification (Scenarios 2, 14).
   *
   * Gated on `customers.update` rather than a permission of its own: verifying a
   * customer's number is part of completing their record, and a caller who may
   * edit the customer may complete them. A separate code would be one more thing
   * to forget to grant, for no additional control.
   */
  @Post(':customerId/mobile/send-otp')
  @RequirePermissions(CUSTOMERS_UPDATE_PERMISSION)
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async sendMobileOtp(
    @CurrentUser() user: AuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Req() req: Request,
  ): Promise<{ sent: true }> {
    await this.mobile.sendOtp(user, customerId, this.meta(req));

    return { sent: true };
  }

  @Post(':customerId/mobile/verify-otp')
  @RequirePermissions(CUSTOMERS_UPDATE_PERMISSION)
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verifyMobileOtp(
    @CurrentUser() user: AuthContext,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: VerifyMobileOtpDto,
    @Req() req: Request,
  ): Promise<{ verified: true }> {
    await this.mobile.verifyOtp(user, customerId, dto, this.meta(req));

    return { verified: true };
  }
}
