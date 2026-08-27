import PDFDocument from 'pdfkit';

/**
 * A paginated table renderer for exported PDFs.
 *
 * Built with `pdfkit` rather than a headless browser: the output is a table of
 * numbers, and a 300MB Chromium in the API container to lay out a table would
 * cost more than the modules that use it. Returns a Buffer rather than a stream
 * because callers audit the export before sending, and an audit that ran after
 * the first byte left would be recording something it could no longer refuse.
 *
 * Lifted out of Module 10's `repayment-schedule-export.ts` when Module 15
 * needed the same page-breaking table across seven report categories.
 */

const MARGIN = 36;
const ROW_HEIGHT = 16;
const PAGE_BOTTOM = 780;

export interface PdfTableSpec {
  /** Document title, rendered once at the top. */
  title: string;
  /** Small grey line under the title. Omitted when absent. */
  subtitle?: string;
  /** `label: value` lines rendered above the table. */
  summary?: [string, string][];
  /** Column headers, repeated on every page. */
  columns: readonly string[];
  /**
   * Column widths in points. Should sum to the printable width of A4 portrait
   * (about 523pt). A column without a width falls back to 60.
   */
  widths: readonly number[];
  /** One array of cells per row, positionally matching `columns`. */
  rows: string[][];
}

/**
 * Render a table to a PDF buffer.
 *
 * The first column is left-aligned and every other column right-aligned, which
 * is the right default when column one is an identifier and the rest are money.
 */
export function renderPdfTable(spec: PdfTableSpec): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(16).text(spec.title, { align: 'left' });
    if (spec.subtitle) {
      doc.fontSize(9).fillColor('#555555').text(spec.subtitle);
    }
    doc.moveDown(0.8).fillColor('#000000');

    if (spec.summary?.length) {
      doc.fontSize(9);
      for (const [label, value] of spec.summary) {
        doc
          .fillColor('#555555')
          .text(`${label}: `, { continued: true })
          .fillColor('#000000')
          .text(value);
      }
      doc.moveDown(0.8);
    }

    let y = doc.y;
    const totalWidth = spec.widths.reduce((a, b) => a + b, 0);

    const header = () => {
      doc.fontSize(8).fillColor('#000000');
      let x = MARGIN;
      spec.columns.forEach((column, index) => {
        const width = spec.widths[index] ?? 60;
        doc.text(column, x, y, {
          width,
          align: index === 0 ? 'left' : 'right',
        });
        x += width;
      });
      y += ROW_HEIGHT;
      doc
        .moveTo(MARGIN, y - 4)
        .lineTo(MARGIN + totalWidth, y - 4)
        .strokeColor('#cccccc')
        .stroke();
    };

    header();

    for (const cells of spec.rows) {
      if (y > PAGE_BOTTOM) {
        doc.addPage();
        y = MARGIN;
        header();
      }

      let x = MARGIN;
      doc.fontSize(8).fillColor('#000000');
      cells.forEach((cell, index) => {
        const width = spec.widths[index] ?? 60;
        doc.text(cell, x, y, { width, align: index === 0 ? 'left' : 'right' });
        x += width;
      });
      y += ROW_HEIGHT;
    }

    doc.end();
  });
}
