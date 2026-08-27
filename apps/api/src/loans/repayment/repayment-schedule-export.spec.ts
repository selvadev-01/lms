import type { RepaymentScheduleView } from '@lms/types';

import {
  exportFilename,
  formatBps,
  formatPaise,
  toCsv,
  toPdf,
} from './repayment-schedule-export';

/**
 * Module 10 — schedule export.
 *
 * Three properties are load-bearing:
 *
 * 1. **Money is formatted from paise strings without touching `number`.** An
 *    amount above ~90,000 crore exceeds `Number.MAX_SAFE_INTEGER` in paise, and
 *    a `parseInt` "simplification" would silently round the largest loans.
 * 2. **CSV formula injection is disarmed.** A customer name is attacker-
 *    influenced text that lands in a file people open in Excel.
 * 3. **Both formats render the same view**, so a borrower reading the PDF and a
 *    clerk reading the CSV cannot see different obligations.
 */

function view(
  overrides: Partial<RepaymentScheduleView> = {},
): RepaymentScheduleView {
  return {
    repaymentScheduleId: '33333333-3333-3333-3333-333333333333',
    loan: {
      loanId: '44444444-4444-4444-4444-444444444444',
      loanNumber: 'LN-000007',
      customerId: '66666666-6666-6666-6666-666666666666',
      customerName: 'Asha Patel',
      branchId: '55555555-5555-5555-5555-555555555555',
      branchName: 'Central',
      status: 'ACTIVE',
      principalAmountPaise: '10000000',
      interestRateBps: '1450',
      interestType: 'REDUCING',
      repaymentFrequency: 'MONTHLY',
      durationCount: 2,
      disbursementDate: '2026-08-21',
    },
    version: 1,
    status: 'ACTIVE',
    generatedAt: '2026-08-21T10:00:00.000Z',
    expectedVersion: '2026-08-21T10:00:00.000Z',
    totals: {
      installmentCount: 2,
      totalPrincipalPaise: '10000000',
      totalInterestPaise: '150000',
      totalPayablePaise: '10150000',
      totalPaidPaise: '0',
      outstandingPaise: '10150000',
      nextDueDate: '2026-09-21',
    },
    installments: [
      {
        emiId: 'e1',
        installmentNumber: 1,
        dueDate: '2026-09-21',
        openingPrincipalPaise: '10000000',
        principalDuePaise: '4950000',
        interestDuePaise: '120000',
        totalDuePaise: '5070000',
        paidAmountPaise: '0',
        outstandingAmountPaise: '5070000',
        status: 'PENDING',
        effectiveStatus: 'PENDING',
      },
      {
        emiId: 'e2',
        installmentNumber: 2,
        dueDate: '2026-10-21',
        openingPrincipalPaise: '5050000',
        principalDuePaise: '5050000',
        interestDuePaise: '30000',
        totalDuePaise: '5080000',
        paidAmountPaise: '0',
        outstandingAmountPaise: '5080000',
        status: 'PENDING',
        effectiveStatus: 'PENDING',
      },
    ],
    canRegenerate: true,
    regenerationBlockers: [],
    priorVersions: [],
    ...overrides,
  };
}

describe('formatPaise', () => {
  it.each([
    ['0', '0.00'],
    ['1', '0.01'],
    ['99', '0.99'],
    ['100', '1.00'],
    ['123456', '1,234.56'],
    // Indian grouping: last three digits, then pairs.
    ['12345678', '1,23,456.78'],
    ['100000000', '10,00,000.00'],
    ['-5000', '-50.00'],
  ])('formats %s paise as %s', (paise, expected) => {
    expect(formatPaise(paise)).toBe(expected);
  });

  // The property a `parseInt` rewrite would break: beyond 2^53 paise the value
  // must still be exact.
  it('formats an amount past Number.MAX_SAFE_INTEGER exactly', () => {
    const huge = '9007199254740993'; // 2^53 + 1
    expect(formatPaise(huge)).toBe('9,00,71,99,25,47,409.93');
    // The digits survive intact. Going through `number` would round the last
    // paisa away, which is the whole reason this path stays on strings.
    expect(formatPaise(huge).replace(/[.,]/g, '')).toBe(huge);
  });
});

describe('formatBps', () => {
  it.each([
    ['0', '0.00'],
    ['1450', '14.50'],
    ['1', '0.01'],
    ['10000', '100.00'],
  ])('formats %s bps as %s', (bps, expected) => {
    expect(formatBps(bps)).toBe(expected);
  });
});

describe('toCsv', () => {
  it('starts with a UTF-8 BOM so Excel reads it as UTF-8', () => {
    expect(toCsv(view()).charCodeAt(0)).toBe(0xfeff);
  });

  it('uses CRLF line endings', () => {
    expect(toCsv(view())).toContain('\r\n');
  });

  it('carries the loan summary', () => {
    const csv = toCsv(view());
    expect(csv).toContain('Loan Number,LN-000007');
    expect(csv).toContain('Customer,Asha Patel');
    expect(csv).toContain('Interest Rate (%),14.50');
    expect(csv).toContain('Principal Amount,"1,00,000.00"');
  });

  it('carries the schedule summary', () => {
    const csv = toCsv(view());
    expect(csv).toContain('Total EMI Count,2');
    expect(csv).toContain('Next EMI Date,2026-09-21');
  });

  it('emits a header row and one row per installment', () => {
    const csv = toCsv(view());
    const lines = csv.split('\r\n');
    const header = lines.findIndex((line) => line.startsWith('#,Due Date'));

    expect(header).toBeGreaterThan(-1);
    expect(lines[header + 1]).toContain('2026-09-21');
    expect(lines[header + 2]).toContain('2026-10-21');
  });

  it('renders the derived status, not the persisted one', () => {
    const csv = toCsv(
      view({
        installments: [
          {
            ...view().installments[0],
            status: 'PENDING',
            effectiveStatus: 'OVERDUE',
          },
        ],
      }),
    );
    expect(csv).toContain('OVERDUE');
  });

  // A name containing a comma or a quote must not shift every later column.
  it('quotes and escapes fields containing separators', () => {
    const csv = toCsv(
      view({ loan: { ...view().loan, customerName: 'Patel, Asha "Ashu"' } }),
    );
    expect(csv).toContain('Customer,"Patel, Asha ""Ashu"""');
  });

  // Formula injection: a leading =, +, - or @ executes when opened in Excel.
  it.each(['=cmd|calc', '+1+1', '-2+3', '@SUM(A1)'])(
    'disarms %s so a spreadsheet does not execute it',
    (name) => {
      const csv = toCsv(view({ loan: { ...view().loan, customerName: name } }));
      expect(csv).not.toContain(`Customer,${name}`);
      expect(csv).toContain(`"\t${name}"`);
    },
  );

  it('renders an empty next due date rather than the word undefined', () => {
    const csv = toCsv(
      view({ totals: { ...view().totals, nextDueDate: undefined } }),
    );
    expect(csv).toContain('Next EMI Date,\r\n');
    expect(csv).not.toContain('undefined');
  });

  it('renders a schedule with no installments without throwing', () => {
    expect(() =>
      toCsv(
        view({
          installments: [],
          totals: { ...view().totals, installmentCount: 0 },
        }),
      ),
    ).not.toThrow();
  });
});

describe('toPdf', () => {
  it('produces a PDF', async () => {
    const pdf = await toPdf(view());
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });

  // Many installments must paginate rather than overflow off the page.
  it('paginates a long schedule', async () => {
    const many = Array.from({ length: 120 }, (_, index) => ({
      ...view().installments[0],
      emiId: `e${index}`,
      installmentNumber: index + 1,
    }));

    const long = await toPdf(view({ installments: many }));
    const short = await toPdf(view());

    expect(long.byteLength).toBeGreaterThan(short.byteLength);
    expect(long.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('renders an empty schedule without throwing', async () => {
    await expect(toPdf(view({ installments: [] }))).resolves.toBeInstanceOf(
      Buffer,
    );
  });
});

describe('exportFilename', () => {
  it('names the file by loan and version', () => {
    expect(exportFilename(view(), 'csv')).toBe(
      'repayment-schedule-LN-000007-v1.csv',
    );
    expect(exportFilename(view(), 'pdf')).toBe(
      'repayment-schedule-LN-000007-v1.pdf',
    );
  });

  // The filename lands in a Content-Disposition header; a quote or newline in
  // it would let a crafted loan number break the header.
  it('strips anything that could break the header', () => {
    const nasty = exportFilename(
      view({ loan: { ...view().loan, loanNumber: 'LN-1"\r\nX: y' } }),
      'csv',
    );
    expect(nasty).toBe('repayment-schedule-LN-1Xy-v1.csv');
  });
});
