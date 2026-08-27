import { Module } from '@nestjs/common';

import { AccountController } from './accounts/account.controller';
import { AccountService } from './accounts/account.service';
import { JournalController } from './journals/journal.controller';
import { JournalService } from './journals/journal.service';
import { GeneralLedgerController } from './ledger/general-ledger.controller';
import { GeneralLedgerService } from './ledger/general-ledger.service';
import { ReconciliationService } from './ledger/reconciliation.service';

/**
 * Module 14 — Accounting & Ledger.
 *
 * # Why this is a top-level module rather than part of LoansModule
 *
 * Modules 09-11 live under `loans/` because everything they do is reached
 * through a loan: a disbursal, a repayment and a reversal all start by
 * resolving one, and they share `LoanService.findInScope` to do it. Accounting
 * has none of that. A chart of accounts belongs to the organization, a journal
 * may reference no loan at all, and the general ledger is a report over
 * postings rather than over borrowers.
 *
 * # Imports nothing
 *
 * `PrismaModule` and `AuditModule` are both `@Global`. `LedgerService` stays in
 * `LoansModule` and is not injected here: this module reads and writes journal
 * rows through Prisma directly for its own manual-journal path, and the one
 * thing it would want from `LedgerService` — the entry-number sequence — was
 * extracted to `accounting-numbering.ts` precisely so neither module has to
 * import the other for it.
 */
@Module({
  controllers: [AccountController, JournalController, GeneralLedgerController],
  providers: [
    AccountService,
    JournalService,
    GeneralLedgerService,
    ReconciliationService,
  ],
  exports: [AccountService, JournalService, GeneralLedgerService],
})
export class AccountingModule {}
