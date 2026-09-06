"use client";

import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import PasswordInput from "@/components/form/input/PasswordInput";
import { evaluatePassword, PASSWORD_MIN_LENGTH } from "@lms/validation";
import { Alert, Button } from "@lms/ui";
import Link from "next/link";
import React, { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  changePasswordAction,
  type ChangePasswordState,
} from "../actions/change-password.action";
import PasswordStrengthMeter, {
  type PasswordEvaluation,
} from "./PasswordStrengthMeter";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Changing…" : "Change Password"}
    </Button>
  );
}

/**
 * Change Password — an authenticated user replacing their own credential.
 *
 * Carries no identity field: the API takes the account from the session cookie
 * the Server Action forwards, so a tampered field cannot retarget the change
 * (Scenario 29).
 *
 * The three labels are "Current Password", "New Password" and "Confirm New
 * Password". None begins with "Password", so the sign-in e2e helper's anchored
 * `/^Password/` locator cannot reach them; note that a `/New Password/` locator
 * would match two of the three, so tests must anchor those as well.
 */
export default function ChangePasswordForm() {
  const [state, formAction] = useActionState<ChangePasswordState, FormData>(
    changePasswordAction,
    {},
  );

  /**
   * Only the *evaluation* is held in state — never the password.
   *
   * The field stays uncontrolled and the value is read from the event, so the
   * plaintext lives in the DOM node and in FormData alone. Making it controlled
   * would put it in React state and therefore in the RSC payload, which is
   * exactly what the Server Action design avoids.
   */
  const [evaluation, setEvaluation] = useState<PasswordEvaluation | null>(null);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="max-w-md">
        <div className="mb-5 sm:mb-8">
          <h3 className="text-title-sm mb-2 font-semibold text-gray-800 dark:text-white/90">
            Change Password
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Choose a new password for your account. You will be signed out
            everywhere and will need to sign in again with it.
          </p>
        </div>

        {/* Alert has no built-in live region, so failures are announced here. */}
        <div role="alert" aria-live="assertive">
          {state.message && (
            <div className="mb-5">
              <Alert
                variant="error"
                title="Password change failed"
                message={state.message}
              />
            </div>
          )}
        </div>

        <form action={formAction} noValidate>
          <div className="space-y-6">
            <PasswordInput
              id="currentPassword"
              name="currentPassword"
              label="Current Password"
              // Distinct from the toggle below: two identically named buttons
              // on one screen would make role-and-name locators ambiguous.
              toggleLabel="current password"
              placeholder="Enter your current password"
              autoComplete="current-password"
              required
              errors={state.errors?.currentPassword}
            />

            <PasswordInput
              id="newPassword"
              name="newPassword"
              label="New Password"
              toggleLabel="new password"
              placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`}
              autoComplete="new-password"
              required
              errors={state.errors?.newPassword}
              onValueChange={(value) => setEvaluation(evaluatePassword(value))}
            >
              {/* Shown once the user starts typing, so the untouched form
                  stays uncluttered. */}
              {evaluation && <PasswordStrengthMeter evaluation={evaluation} />}
            </PasswordInput>

            <div>
              <Label htmlFor="confirmNewPassword">
                Confirm New Password <span className="text-error-500">*</span>
              </Label>
              <Input
                id="confirmNewPassword"
                name="confirmNewPassword"
                // Intentionally not covered by a toggle: the point of a
                // confirmation field is that it is retyped, not read back.
                type="password"
                placeholder="Re-enter your new password"
                autoComplete="new-password"
                error={Boolean(state.errors?.confirmNewPassword)}
                hint={state.errors?.confirmNewPassword?.[0]}
                aria-invalid={Boolean(state.errors?.confirmNewPassword)}
              />
            </div>

            <div className="flex items-center gap-3">
              <SubmitButton />
              {/*
                A link rather than a button inside the form, so it cannot submit.
                Navigating away commits nothing, which is the whole of Scenario 3.
              */}
              <Link
                href="/profile"
                className="text-sm font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              >
                Cancel
              </Link>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
