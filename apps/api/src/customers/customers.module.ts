import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AuthModule } from '../auth/auth.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { SmsModule } from '../sms/sms.module';
import { CustomerController } from './customer/customer.controller';
import { CustomerMobileService } from './customer/customer-mobile.service';
import { CustomerService } from './customer/customer.service';
import { DocumentController } from './customer/document.controller';
import { DocumentService } from './customer/document.service';
import { GuarantorController } from './guarantor/guarantor.controller';
import { GuarantorService } from './guarantor/guarantor.service';
import { GuarantorDirectoryController } from './guarantor/guarantor-directory.controller';
import { GuarantorDirectoryService } from './guarantor/guarantor-directory.service';
import { GuarantorDocumentController } from './guarantor/guarantor-document.controller';
import { GuarantorDocumentService } from './guarantor/guarantor-document.service';
import { GuarantorKycController } from './guarantor/guarantor-kyc.controller';
import { GuarantorKycService } from './guarantor/guarantor-kyc.service';
import { KycController } from './customer/kyc.controller';
import { KycService } from './customer/kyc.service';
import { FILE_STORAGE, LocalFileStorage } from './storage/file-storage';

/**
 * Modules 04 and 05 — Customers & KYC, and Guarantors.
 *
 * One module for seven controllers, following the Module 03 precedent: the
 * folder tracks the *domain*, not the entity or the story number. Customers,
 * their KYC, their documents and their guarantors share one scope rule, and
 * splitting them would mean several copies of `findInScope` that could drift
 * apart — which is exactly what Module 05's Rules 6-9 forbid.
 *
 * Module 05 adds three services and three controllers to this file rather than a
 * `guarantors/` module of its own, because a guarantor is only ever reachable
 * through a customer. A separate module would need `CustomerService` injected
 * into all of it, which is the shape of something that already belongs here.
 *
 * `CustomerService` is exported because Rule 27 requires other modules —
 * Loan Management first — to reuse these rules rather than duplicate them
 * (Q-CUST-36). Its `findInScope` is the single definition of which customers a
 * caller can reach, and a second implementation elsewhere is exactly the bug
 * that rule exists to prevent.
 *
 * Prisma, Audit and Authorization are `@Global`, so only the genuinely
 * cross-module dependencies are imported here.
 */
@Module({
  imports: [
    // For BranchService.assertBranchOperational — Module 02's seam for Rules
    // 47/50. Module 04 is its first real caller.
    OrganizationsModule,
    // For PasswordService, which hashes the mobile-verification OTP with the
    // same argon2 parameters used for passwords.
    AuthModule,
    // For delivering that OTP (Scenario 14).
    SmsModule,
    /**
     * Uploads are held in memory, never written to a temp directory.
     *
     * Disk storage would persist the bytes before anything had validated them,
     * leaving a rejected file — possibly an executable — on disk. In memory, an
     * unacceptable upload is never written at all. The size cap is what keeps
     * that bounded, and it is the same number the service enforces so a request
     * cannot be truncated by one limit and accepted by the other.
     */
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        /**
         * No `storage` key at all, which is how Multer is told to buffer in
         * memory — its default when none is given. `memoryStorage()` would say
         * the same thing more explicitly, but `multer` ships no types and
         * `@types/multer` is not a dependency here, so importing it makes every
         * use an `any` and trips `no-unsafe-call`. Adding a types package to
         * restate a default is not worth it.
         */
        limits: {
          fileSize:
            config.get<number>('customers.maxDocumentBytes') ?? 5 * 1024 * 1024,
          files: 1,
        },
      }),
    }),
  ],
  controllers: [
    CustomerController,
    KycController,
    DocumentController,
    GuarantorController,
    GuarantorDocumentController,
    GuarantorKycController,
    GuarantorDirectoryController,
  ],
  providers: [
    CustomerService,
    KycService,
    DocumentService,
    GuarantorService,
    GuarantorDocumentService,
    GuarantorKycService,
    GuarantorDirectoryService,
    CustomerMobileService,
    // Bound through a token rather than the class, so replacing local disk with
    // S3 is one line here and no change anywhere above it.
    { provide: FILE_STORAGE, useClass: LocalFileStorage },
  ],
  /**
   * `GuarantorService` joins `CustomerService` here for Module 05 Rules 26 and
   * 28: the loan module must ask this service whether a guarantor is selectable
   * and whether the guarantor gate is satisfied, rather than re-deriving either
   * from the status columns. A second implementation of "an inactive guarantor
   * cannot be selected" is exactly the drift Rule 36 exists to prevent.
   */
  exports: [CustomerService, GuarantorService],
})
export class CustomersModule {}
