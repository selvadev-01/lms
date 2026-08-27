"use client";

import { Button } from "@lms/ui";
import type { SelectOption } from "@lms/validation";
import React, { useId } from "react";
import { useFormStatus } from "react-dom";

/**
 * The app's form primitives.
 *
 * These began in `features/loans` and were used only there, which is why every
 * other feature hand-rolled its own `<select>`/`<option>` markup and drifted:
 * different error conventions, missing `aria-invalid`, and labels bound to the
 * wrong control. They encode this app's error-reporting convention
 * (`aria-invalid` plus a described-by paragraph carrying the first message),
 * which is a form-handling decision rather than a design-system one — so they
 * live here rather than in `@lms/ui`.
 *
 * `SelectField` takes `SelectOption[]` from `@lms/validation`, the one option
 * shape in the app. A code-defined enum registry and an admin-managed
 * master-data list are the same type here, so this component never needs to
 * know which kind it was handed.
 */

export function SubmitButton({
  label,
  pendingLabel = "Saving…",
  variant,
  size = "sm",
}: {
  label: string;
  pendingLabel?: string;
  variant?: "primary" | "outline";
  size?: "sm" | "md";
}) {
  const { pending } = useFormStatus();

  return (
    <Button size={size} variant={variant} disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

const INPUT_CLASS =
  "shadow-theme-xs focus:border-brand-300 focus:ring-brand-500/10 h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 placeholder:text-gray-400 focus:ring-3 focus:outline-hidden dark:border-gray-700 dark:text-white/90 dark:placeholder:text-white/30";

export function Field({
  name,
  label,
  errors,
  required = false,
  type = "text",
  defaultValue,
  value,
  onChange,
  maxLength,
  placeholder,
  hint,
  inputMode,
}: {
  name: string;
  label: string;
  errors?: string[];
  required?: boolean;
  type?: string;
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
  maxLength?: number;
  placeholder?: string;
  hint?: string;
  inputMode?: "text" | "numeric" | "decimal";
}) {
  // `useId` rather than `name` for the DOM id. Two forms on one page can both
  // carry a `comments` field — request-more-info and modify-terms do exactly
  // that — and duplicate ids silently break `<label for>`: the browser binds
  // every label to the *first* match, so clicking one form's label focuses the
  // other form's control. A screen reader reports the same wrong association.
  const id = useId();
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
      >
        {label}
        {required && <span className="text-error-500"> *</span>}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        inputMode={inputMode}
        {...(onChange
          ? { value: value ?? "", onChange: (e) => onChange(e.target.value) }
          : { defaultValue })}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-invalid={errors ? true : undefined}
        aria-describedby={
          errors ? `${id}-error` : hint ? `${id}-hint` : undefined
        }
        className={INPUT_CLASS}
      />
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

export function SelectField({
  name,
  label,
  options,
  errors,
  required = false,
  value,
  defaultValue,
  onChange,
  placeholder = "Select…",
  hint,
  disabled = false,
}: {
  name: string;
  label: string;
  options: readonly SelectOption[];
  errors?: string[];
  required?: boolean;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  hint?: string;
  disabled?: boolean;
}) {
  // `useId` rather than `name` for the DOM id. Two forms on one page can both
  // carry a `comments` field — request-more-info and modify-terms do exactly
  // that — and duplicate ids silently break `<label for>`: the browser binds
  // every label to the *first* match, so clicking one form's label focuses the
  // other form's control. A screen reader reports the same wrong association.
  const id = useId();
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
      >
        {label}
        {required && <span className="text-error-500"> *</span>}
      </label>
      <select
        id={id}
        name={name}
        disabled={disabled}
        {...(onChange
          ? { value: value ?? "", onChange: (e) => onChange(e.target.value) }
          : { defaultValue })}
        aria-invalid={errors ? true : undefined}
        aria-describedby={
          errors ? `${id}-error` : hint ? `${id}-hint` : undefined
        }
        className={INPUT_CLASS}
      >
        {/*
          An explicitly empty placeholder renders no empty option at all, for
          fields that always hold a value: offering a blank first choice there
          presents "unset" as though it were selectable.
        */}
        {placeholder !== "" && <option value="">{placeholder}</option>}
        {options.map((option) => (
          // `disabled` keeps a retired value visible but unselectable, so an
          // existing record still shows what it holds instead of falling back
          // to the placeholder as though the field were empty.
          <option
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </option>
        ))}
      </select>
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

export function TextAreaField({
  name,
  label,
  errors,
  required = false,
  defaultValue,
  value,
  onChange,
  maxLength,
  rows = 3,
  placeholder,
}: {
  name: string;
  label: string;
  errors?: string[];
  required?: boolean;
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
  maxLength?: number;
  rows?: number;
  placeholder?: string;
}) {
  // `useId` rather than `name` for the DOM id. Two forms on one page can both
  // carry a `comments` field — request-more-info and modify-terms do exactly
  // that — and duplicate ids silently break `<label for>`: the browser binds
  // every label to the *first* match, so clicking one form's label focuses the
  // other form's control. A screen reader reports the same wrong association.
  const id = useId();
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
      >
        {label}
        {required && <span className="text-error-500"> *</span>}
      </label>
      <textarea
        id={id}
        name={name}
        rows={rows}
        {...(onChange
          ? { value: value ?? "", onChange: (e) => onChange(e.target.value) }
          : { defaultValue })}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-invalid={errors ? true : undefined}
        aria-describedby={errors ? `${id}-error` : undefined}
        className="shadow-theme-xs focus:border-brand-300 focus:ring-brand-500/10 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:ring-3 focus:outline-hidden dark:border-gray-700 dark:text-white/90 dark:placeholder:text-white/30"
      />
      {errors && (
        <p id={`${id}-error`} className="text-error-500 mt-1.5 text-sm">
          {errors[0]}
        </p>
      )}
    </div>
  );
}
