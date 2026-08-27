/**
 * CSV writing for exported files.
 *
 * Two properties are load-bearing and neither is decoration:
 *
 * 1. **Formula injection is disarmed.** A field beginning `=`, `+`, `-` or `@`
 *    is executed as a formula when the file is opened in Excel or Sheets.
 *    Customer names, branch names and rejection reasons are attacker-influenced
 *    text that lands in these files.
 * 2. **UTF-8 BOM and CRLF.** These files are opened in Excel far more often
 *    than they are parsed. Without the BOM, Excel reads UTF-8 as the system
 *    codepage and mangles any non-ASCII name.
 *
 * Lifted out of Module 10's `repayment-schedule-export.ts` when Module 15
 * needed the same escaping across seven report categories. A second copy of
 * `csvField` would be a second place the injection guard could rot.
 */

/**
 * Escape one CSV field.
 *
 * The leading-character guard is what disarms formula injection: a dangerous
 * first character is prefixed with a tab, which Excel treats as text.
 */
export function csvField(value: string): string {
  const disarmed = /^[=+\-@\t\r]/.test(value) ? `\t${value}` : value;
  return /[",\r\n\t]/.test(disarmed)
    ? `"${disarmed.replace(/"/g, '""')}"`
    : disarmed;
}

/** One CSV record. Fields are escaped individually, then joined. */
export function csvRow(cells: string[]): string {
  return cells.map(csvField).join(',');
}

/**
 * Assemble escaped lines into a finished CSV document.
 *
 * `\uFEFF` is a UTF-8 BOM. Written as the escape rather than as the literal
 * character: the raw form is invisible in an editor, so nobody could tell it
 * apart from an accidental paste, and `no-irregular-whitespace` flagged it for
 * exactly that reason.
 */
export function csvDocument(lines: string[]): string {
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
