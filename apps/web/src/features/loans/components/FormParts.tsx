/**
 * Money conversions for the loan forms.
 *
 * The form primitives that used to live here (`Field`, `SelectField`,
 * `TextAreaField`, `SubmitButton`) moved to `@/components/form/FormFields` once
 * features outside loans needed them. They are re-exported below so the imports
 * in this feature keep working and read the same as before.
 */

export {
  Field,
  SelectField,
  SubmitButton,
  TextAreaField,
} from "@/components/form/FormFields";

/**
 * Rupees in, integer paise out.
 *
 * The form takes rupees because that is what a clerk is told over the counter;
 * the API takes paise because a float rupee amount is not a thing to lend money
 * with. The conversion is done on the string rather than by multiplying a parsed
 * float by 100 — `12345.67 * 100` is `1234566.9999999999`, and rounding that
 * back is a paisa lost on a hundredth of all inputs.
 */
export function rupeesToPaise(input: string): string {
  const trimmed = input.trim();
  if (!/^\d+(\.\d{0,2})?$/.test(trimmed)) return "";

  const [rupees = "0", fraction = ""] = trimmed.split(".");

  return `${rupees}${fraction.padEnd(2, "0")}`.replace(/^0+(?=\d)/, "");
}

/** Integer paise back to a rupee string, for re-editing a stored amount. */
export function paiseToRupees(paise: string): string {
  if (!/^\d+$/.test(paise)) return "";

  const padded = paise.padStart(3, "0");

  return `${padded.slice(0, -2)}.${padded.slice(-2)}`;
}

/** A percentage string to integer basis points. "12.5" becomes "1250". */
export function percentToBps(input: string): string {
  const trimmed = input.trim();
  if (!/^\d+(\.\d{0,2})?$/.test(trimmed)) return "";

  const [whole = "0", fraction = ""] = trimmed.split(".");

  return `${whole}${fraction.padEnd(2, "0")}`.replace(/^0+(?=\d)/, "");
}

export function bpsToPercent(bps: string): string {
  if (!/^\d+$/.test(bps)) return "";

  const padded = bps.padStart(3, "0");
  const value = `${padded.slice(0, -2)}.${padded.slice(-2)}`;

  return value.replace(/\.?0+$/, "");
}
