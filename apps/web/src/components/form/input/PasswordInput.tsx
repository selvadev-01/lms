"use client";

import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import { EyeCloseIcon, EyeIcon } from "@lms/ui/icons";
import React, { useState } from "react";

export interface PasswordInputProps {
  id: string;
  name: string;
  label: string;
  /**
   * Names this field's toggle: the button is announced as "Show {toggleLabel}"
   * / "Hide {toggleLabel}". It must be distinct from every other toggle on the
   * same screen, or role-and-name locators (the e2e suite uses nothing else)
   * become ambiguous. Sign In and Reset Password use "password"; a form with
   * several password fields needs "current password", "new password", and so on.
   */
  toggleLabel: string;
  placeholder?: string;
  autoComplete: "current-password" | "new-password";
  required?: boolean;
  /** Server-returned messages for this field; the first is shown as the hint. */
  errors?: string[];
  /**
   * Receives the raw value on every keystroke, for deriving something that is
   * safe to hold — a strength evaluation, say.
   *
   * The caller must not store the value itself. The field is deliberately
   * uncontrolled (there is no `value` prop, and adding one would be a mistake):
   * the plaintext lives in the DOM node and in FormData only, never in React
   * state and therefore never in the RSC payload.
   */
  onValueChange?: (value: string) => void;
  /** Rendered below the input — a strength meter, typically. */
  children?: React.ReactNode;
}

/**
 * A password field with its own show/hide toggle.
 *
 * Extracted once a third screen needed it. The toggle state is owned per field
 * rather than lifted, so a form with several password inputs reveals them
 * independently and no caller has to thread state through.
 */
export default function PasswordInput({
  id,
  name,
  label,
  toggleLabel,
  placeholder,
  autoComplete,
  required = false,
  errors,
  onValueChange,
  children,
}: PasswordInputProps) {
  const [showPassword, setShowPassword] = useState(false);
  const hasError = Boolean(errors?.length);

  return (
    <div>
      <Label htmlFor={id}>
        {label} {required && <span className="text-error-500">*</span>}
      </Label>
      <div className="relative">
        <Input
          id={id}
          name={name}
          type={showPassword ? "text" : "password"}
          placeholder={placeholder}
          autoComplete={autoComplete}
          error={hasError}
          hint={errors?.[0]}
          aria-invalid={hasError}
          onChange={
            onValueChange
              ? (event) => onValueChange(event.target.value)
              : undefined
          }
        />
        {/* Pinned to the input's own height (h-11) rather than the wrapper's,
            so it stays centred when hint text appears. */}
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          aria-label={
            showPassword ? `Hide ${toggleLabel}` : `Show ${toggleLabel}`
          }
          aria-pressed={showPassword}
          className="absolute top-[22px] right-4 z-30 -translate-y-1/2 cursor-pointer"
        >
          {showPassword ? (
            <EyeIcon className="fill-gray-500 dark:fill-gray-400" />
          ) : (
            <EyeCloseIcon className="fill-gray-500 dark:fill-gray-400" />
          )}
        </button>
      </div>
      {children}
    </div>
  );
}
