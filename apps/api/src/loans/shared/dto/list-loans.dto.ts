import { IsOptional, IsUUID } from 'class-validator';

/**
 * Loan list filter.
 *
 * There is no `branchId` and no `orgId`: both come from the JWT and are applied
 * unconditionally in the service, following `ListOverdueDto`. A caller cannot
 * widen their own scope by asking.
 *
 * `customerId` is a filter, not a scope — narrowing to one borrower, which is
 * what the customer portfolio asks for. An id outside the caller's scope simply
 * matches nothing, rather than erroring, so it cannot be used to probe whether a
 * customer exists.
 */
export class ListLoansDto {
  @IsOptional()
  @IsUUID('4', { message: 'Unknown customer filter' })
  customerId?: string;

  /**
   * One loan, for the loan detail page.
   *
   * There is no `GET /loans/:loanId`, and adding one would duplicate the scope
   * resolution and mapping this list already does. Narrowing the list to a
   * single row reuses both — and matters because the list is capped, so an older
   * loan is otherwise unreachable through it.
   */
  @IsOptional()
  @IsUUID('4', { message: 'Unknown loan filter' })
  loanId?: string;
}
