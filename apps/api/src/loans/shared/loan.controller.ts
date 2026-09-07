import { Controller, Get, Query } from '@nestjs/common';

import type { AuthContext } from '../../common/auth-context';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ListLoansDto } from './dto/list-loans.dto';
import { LoanService, LOANS_VIEW_PERMISSION } from './loan.service';
import { toLoanSummary, type LoanSummaryView } from './loan.mapper';

/**
 * The loan list.
 *
 * Every other loan route hangs off a `loanId` the caller already knows, so
 * until now there was no way to ask "what loans does this borrower have" — which
 * is what a customer's portfolio needs.
 *
 * # Route registration
 *
 * Mounted on the bare `loans` path with no further segment, so it cannot shadow
 * or be shadowed by the `loans/:loanId` routes elsewhere in this module: those
 * all carry a second segment. The ordering note in `loans.module.ts` still
 * governs the controllers that mount `loans/collections` and `loans/:loanId`.
 */
@Controller('loans')
export class LoanController {
  constructor(private readonly loans: LoanService) {}

  /**
   * Loans in the caller's scope, optionally for one customer.
   *
   * `loans.view` — the same permission the detail surfaces use, because this is
   * the same data reached a different way. A separate code would let a caller
   * enumerate loans they could not open.
   */
  @Get()
  @RequirePermissions(LOANS_VIEW_PERMISSION)
  async list(
    @CurrentUser() user: AuthContext,
    @Query() query: ListLoansDto,
  ): Promise<{ loans: LoanSummaryView[] }> {
    // No meta: the list is not audited, per the note on `LoanService.list`.
    const rows = await this.loans.list(user, query);

    return { loans: rows.map(toLoanSummary) };
  }
}
