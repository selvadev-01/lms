import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';

import { CustomersModule } from '../customers/customers.module';
import {
  FILE_STORAGE,
  LocalFileStorage,
} from '../customers/storage/file-storage';
import { OrganizationsModule } from '../organizations/organizations.module';
import { ApplicationTransitionService } from './applications/application-transition.service';
import {
  CollectionController,
  LoanCollectionController,
} from './collection/collection.controller';
import { CollectionService } from './collection/collection.service';
import { ReceiptService } from './collection/receipt.service';
import { CreditAssessmentController } from './approval/credit-assessment.controller';
import { CreditAssessmentService } from './approval/credit-assessment.service';
import { DisbursementController } from './disbursal/disbursement.controller';
import { DisbursementService } from './disbursal/disbursement.service';
import { LedgerService } from './disbursal/ledger.service';
import { LoanController } from './shared/loan.controller';
import { LoanService } from './shared/loan.service';
import { LoanApplicationCompletenessService } from './applications/loan-application-completeness.service';
import { LoanApplicationDocumentController } from './applications/loan-application-document.controller';
import { LoanApplicationDocumentService } from './applications/loan-application-document.service';
import { LoanApplicationReviewService } from './approval/loan-application-review.service';
import { LoanApplicationController } from './applications/loan-application.controller';
import { LoanApplicationService } from './applications/loan-application.service';
import { LoanSanctionService } from './approval/loan-sanction.service';
import { LoanProductController } from './products/loan-product.controller';
import { LoanProductService } from './products/loan-product.service';
import { LoanSchemeController } from './products/loan-scheme.controller';
import { LoanSchemeService } from './products/loan-scheme.service';
import { RepaymentScheduleController } from './repayment/repayment-schedule.controller';
import { RepaymentScheduleService } from './repayment/repayment-schedule.service';

/**
 * Modules 06-07 — Loan Products, Schemes and Applications.
 *
 * One module for the whole lending-configuration-and-application domain, in the
 * same way `CustomersModule` covers customers, KYC, documents and guarantors:
 * an application cannot exist without a scheme, and splitting them would mean
 * two modules importing each other on the first day.
 *
 * Prisma, Audit and Authorization are `@Global`, so only the genuinely
 * cross-module dependencies are imported below.
 */
@Module({
  imports: [
    /**
     * For `CustomerService.findInScope` and `GuarantorService.evaluateReadiness`.
     *
     * Module 04's Rule 27 requires this module to *reuse* those rules rather
     * than re-derive them: a second definition of which customers a caller can
     * reach is the single easiest place for branch scope to be forgotten, and a
     * second reading of guarantor readiness would drift from the one Module 05
     * maintains.
     */
    CustomersModule,
    // For `BranchService.assertBranchOperational` — Module 02's seam for
    // Rules 47/50. An application cannot be created into a closed branch.
    OrganizationsModule,
    /**
     * Uploads are held in memory, never written to a temp directory.
     *
     * Disk storage would persist the bytes before anything had validated them,
     * leaving a rejected file on disk. In memory, an unacceptable upload is
     * never written at all. The cap is the same number the service enforces and
     * the same one Modules 04/05 use, so a file cannot be truncated by one limit
     * and accepted by another.
     */
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // No `storage` key: that is how Multer is told to buffer in memory. See
        // the note in `customers.module.ts` for why `memoryStorage()` is not
        // used to say it more explicitly.
        limits: {
          fileSize:
            config.get<number>('customers.maxDocumentBytes') ?? 5 * 1024 * 1024,
          files: 1,
        },
      }),
    }),
  ],
  controllers: [
    LoanProductController,
    LoanSchemeController,
    LoanApplicationController,
    LoanApplicationDocumentController,
    CreditAssessmentController,
    DisbursementController,
    // Module 11. The order of these three is load-bearing. Nest matches routes
    // across controllers in registration order, so the literal two-segment
    // prefix `loans/collections` must be registered before either controller
    // that mounts `loans/:loanId` — otherwise a request for
    // `/loans/collections` binds `collections` as a loanId and 400s on
    // ParseUUIDPipe. `app.e2e-spec.ts` asserts this.
    CollectionController,
    RepaymentScheduleController,
    LoanCollectionController,
    // A bare `GET /loans` with no second segment, so it neither shadows nor is
    // shadowed by the `loans/:loanId` routes above.
    LoanController,
  ],
  providers: [
    LoanProductService,
    LoanSchemeService,
    LoanApplicationService,
    ApplicationTransitionService,
    LoanApplicationReviewService,
    LoanApplicationCompletenessService,
    LoanApplicationDocumentService,
    CreditAssessmentService,
    LoanSanctionService,
    // Module 09. Kept in this module rather than a new one for the reason the
    // class comment gives: a disbursement is reached through an application and
    // reuses its scope resolution and transition primitive, so a separate
    // module would import this one on its first line.
    DisbursementService,
    LoanService,
    LedgerService,
    // Module 10. Same reasoning as Module 09 above: a repayment schedule is
    // reached through its loan and reuses `LoanService.findInScope`, so a
    // separate module would import this one on its first line.
    RepaymentScheduleService,
    // Module 11. Same reasoning again: a collection is reached through its loan,
    // reuses `LoanService.findInScope` and the active schedule the repayment
    // service owns, and posts through the same `LedgerService` that disbursal
    // uses — which is deliberately the only writer of journal rows.
    CollectionService,
    ReceiptService,
    /**
     * Bound again here rather than exported from `CustomersModule`.
     *
     * A provider bound in two modules is two instances, which is harmless for
     * `LocalFileStorage` — it holds no state, only a root path read from config.
     * The alternative, exporting the token from Modules 04/05, would make this
     * module's file handling depend on a customer module's provider list, which
     * is a stranger coupling than a second stateless instance.
     */
    { provide: FILE_STORAGE, useClass: LocalFileStorage },
  ],
  /**
   * `LoanSchemeService` is exported because `assertSelectable` is the seam a
   * later module (disbursement, repayment schedules) will need for the same
   * "is this scheme still valid" question — the rule belongs in one place.
   *
   * `LoanSanctionService` and `CreditAssessmentService` are exported for the
   * same reason: Module 09 must read the sanction letter's snapshotted terms
   * and confirm the application reached AGREEMENT_SIGNED before disbursing
   * (Scenario 34), and neither of those reads should be re-derived there.
   */
  exports: [
    LoanProductService,
    LoanSchemeService,
    LoanApplicationService,
    LoanSanctionService,
    CreditAssessmentService,
    /**
     * `LoanService` is exported for Modules 10 onwards. A loan outlives the
     * disbursal that created it, and every later module — repayment schedule,
     * collections, overdue, recovery, closure — needs `findInScope` to reach
     * one. None of them should import the disbursal service to do it.
     */
    LoanService,
    /**
     * Exported for Modules 11 onwards. EMI collection must read the active
     * schedule and its installments to allocate a payment, and overdue and
     * recovery both need `deriveEmiStatus` to agree with what the schedule
     * screen shows. A second reading of "which installment is due" would drift
     * from this one within a release.
     */
    RepaymentScheduleService,
    /**
     * Exported for Module 12. A field collection *is* a collection: it goes
     * through `postField`, which is `postInternal` — the same replay check,
     * allocation, transaction and receipt. Module 12 owns the custody and
     * evidence around it and re-implements none of the posting, which is the
     * only way the two paths can be guaranteed to agree.
     */
    CollectionService,
    /**
     * Exported for Module 12's cash handover, which posts the custody transfer
     * `Dr 1210 / Cr 1220`.
     *
     * This service is documented as "the only writer of journal rows in the
     * codebase", and exporting it is what keeps that true: the alternative is a
     * cash module that writes `journal_lines` itself, and the balance assertion
     * would then apply to some entries and not others.
     */
    LedgerService,
  ],
})
export class LoansModule {}
