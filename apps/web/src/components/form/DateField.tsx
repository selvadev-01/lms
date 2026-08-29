"use client";

import flatpickr from "flatpickr";
import React, { useEffect, useId, useRef } from "react";
import { CalenderIcon } from "@lms/ui/icons";

/**
 * The app's date input.
 *
 * Every date field in the LMS renders through this, so a calendar is always
 * available and always looks the same. Before it, dates were `<input
 * type="date">` in three different styles, and `globals.css` hid the native
 * calendar indicator app-wide — so the picker existed but was invisible, and
 * the field read as a text box that demanded `YYYY-MM-DD` by hand.
 *
 * # It stays a real form control
 *
 * flatpickr is attached to the input itself (`altInput: false`), not to a
 * decorative proxy, so the element keeps its `name` and its value is `YYYY-MM-DD`.
 * Every form in this app submits `FormData` to a Server Action and every schema
 * parses an ISO date string, so a picker that replaced the input with a
 * prettier one carrying no `name` would submit nothing at all. The dead
 * `date-picker.tsx` this replaces had exactly that flaw.
 *
 * `type="text"` rather than `type="date"`: with a native date input the browser
 * renders its own editor on top, which fights flatpickr for the same click and
 * shows two calendars. The value format is unchanged either way, and the field
 * remains typeable for anyone who prefers the keyboard.
 *
 * # Why the instance is bound by ref
 *
 * The component it replaces selected its element with `flatpickr("#" + id)`,
 * which forced callers to invent unique ids — and `useId()` values contain `:`,
 * which is invalid in an unescaped CSS selector, so the app's own id convention
 * would have thrown. A ref has neither problem.
 */

const INPUT_CLASS =
  "shadow-theme-xs focus:border-brand-300 focus:ring-brand-500/10 h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 pr-11 text-sm text-gray-800 placeholder:text-gray-400 focus:ring-3 focus:outline-hidden dark:border-gray-700 dark:text-white/90 dark:placeholder:text-white/30";

export interface DateFieldProps {
  name: string;
  label?: string;
  errors?: string[];
  required?: boolean;
  defaultValue?: string;
  /** Controlled value. Supply with `onChange`; omit for an uncontrolled field. */
  value?: string;
  onChange?: (value: string) => void;
  hint?: string;
  /** Earliest selectable date, `YYYY-MM-DD`. Also passed to the native `min`. */
  min?: string;
  /** Latest selectable date, `YYYY-MM-DD`. */
  max?: string;
  disabled?: boolean;
  /** Rendered without the label block, for filter bars that label their own. */
  bare?: boolean;
  /** Overrides the generated id, for a filter bar with its own `<label for>`. */
  id?: string;
  className?: string;
}

export default function DateField({
  name,
  label,
  errors,
  required = false,
  defaultValue,
  value,
  onChange,
  hint,
  min,
  max,
  disabled = false,
  bare = false,
  id: providedId,
  className,
}: DateFieldProps) {
  // `useId` rather than `name` for the DOM id: two forms on one page can carry
  // the same field name, and duplicate ids silently bind every label to the
  // first match. The same reasoning as `Field` in FormFields.tsx.
  const generatedId = useId();
  const id = providedId ?? generatedId;

  const inputRef = useRef<HTMLInputElement>(null);
  // Held in a ref so the effect below can call the latest handler without
  // listing it as a dependency — an inline arrow from the caller is a new
  // function every render and would tear down and rebuild the calendar on each
  // one, closing it mid-interaction.
  const onChangeRef = useRef(onChange);
  // Synced in an effect rather than assigned during render: a render-phase ref
  // write is not safe under concurrent rendering, where React may render a
  // component without committing it. The calendar reads this only from its own
  // event handler, which cannot run before this effect has committed.
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const element = inputRef.current;
    if (!element) return;

    const instance = flatpickr(element, {
      dateFormat: "Y-m-d",
      allowInput: true,
      // Rendered in the normal flow rather than appended to <body>, so the
      // calendar inherits the theme and is clipped correctly inside a modal.
      static: true,
      monthSelectorType: "static",
      minDate: min,
      maxDate: max,
      onChange: (_dates, dateStr) => onChangeRef.current?.(dateStr),
    });

    return () => instance.destroy();
    // `min`/`max` re-create the instance deliberately: they change when a
    // range's other end moves, and flatpickr reads them at construction.
  }, [min, max]);

  /**
   * Controlled updates reach flatpickr, not just the DOM.
   *
   * Setting `value` on the input alone leaves the calendar highlighting the old
   * day, because flatpickr keeps its own selected date. `false` suppresses the
   * change hook so this does not loop back into the caller's `onChange`.
   */
  useEffect(() => {
    if (value === undefined) return;
    const instance = (
      inputRef.current as
        (HTMLInputElement & { _flatpickr?: flatpickr.Instance }) | null
    )?._flatpickr;
    instance?.setDate(value, false);
  }, [value]);

  const describedBy = errors ? `${id}-error` : hint ? `${id}-hint` : undefined;

  const control = (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        name={name}
        // Text, not date — see the header. The submitted value is still ISO.
        type="text"
        placeholder="YYYY-MM-DD"
        required={required}
        disabled={disabled}
        {...(onChange ? { value: value ?? "" } : { defaultValue })}
        // flatpickr writes the value programmatically; React only needs to stop
        // warning about a controlled input without a handler. Selection flows
        // through the instance's own onChange above.
        onChange={() => {}}
        aria-invalid={errors ? true : undefined}
        aria-describedby={describedBy}
        className={`${INPUT_CLASS} ${className ?? ""}`}
      />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-gray-500 dark:text-gray-400">
        <CalenderIcon className="size-5" />
      </span>
    </div>
  );

  if (bare) return control;

  return (
    <div>
      {label && (
        <label
          htmlFor={id}
          className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
        >
          {label}
          {required && <span className="text-error-500"> *</span>}
        </label>
      )}
      {control}
      {hint && !errors && (
        <p
          id={`${id}-hint`}
          className="mt-1.5 text-xs text-gray-500 dark:text-gray-400"
        >
          {hint}
        </p>
      )}
      {errors && (
        <p id={`${id}-error`} className="text-error-500 mt-1.5 text-sm">
          {errors[0]}
        </p>
      )}
    </div>
  );
}
