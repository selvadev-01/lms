import { formatIsoDate, todayInKolkata } from "@lms/emi";

/**
 * Today's business date, as `YYYY-MM-DD`.
 *
 * Exists so no form reaches for `new Date().toISOString().slice(0, 10)` again.
 * That is the *UTC* date, and between 18:30 and 24:00 IST it is still
 * yesterday — so an operator recording an evening collection got the previous
 * day pre-filled on a financial record, silently and every single evening.
 *
 * `todayInKolkata` resolves the date through `Intl` in Asia/Kolkata rather than
 * trusting the host clock, which also makes this correct on a server or a
 * laptop set to any other zone. India has no DST, so a fixed zone name is safe.
 *
 * Note this is the *client's* idea of now when called during a client render.
 * That is the right answer for pre-filling a form — it is the operator's own
 * business day — and every date is re-validated server-side regardless.
 */
export function todayIso(): string {
  return formatIsoDate(todayInKolkata());
}
