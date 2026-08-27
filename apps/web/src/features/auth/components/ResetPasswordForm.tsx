"use client";

import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import PasswordInput from "@/components/form/input/PasswordInput";
import { evaluatePassword, PASSWORD_MIN_LENGTH } from "@lms/validation";
import { Alert, Button } from "@lms/ui";
import React, { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  resetPasswordAction,
  type ResetPasswordState,
} from "../actions/reset-password.action";
import PasswordStrengthMeter, {
  type PasswordEvaluation,
} from "./PasswordStrengthMeter";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button className="w-full" size="sm" disabled={pending}>
      {pending ? "Resetting…" : "Reset password"}
    </Button>
  );
}

/**
 * Step 3 of password recovery.
 *
 * Carries no identity field at all — the account comes from the httpOnly reset
 * cookie, which the browser cannot read or alter (Scenario 19).
 *
 * Labels are "New Password" and "Confirm Password" rather than "Password", so
 * the sign-in e2e helper's anchored `/^Password/` locator cannot match them.
 */
export default function ResetPasswordForm() {
  const [state, formAction] = useActionState<ResetPasswordState, FormData>(
    resetPasswordAction,
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
    <div className="flex w-full flex-1 flex-col lg:w-1/2">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
        <div>
          <div className="mb-5 sm:mb-8">
            <h1 className="text-title-sm sm:text-title-md mb-2 font-semibold text-gray-800 dark:text-white/90">
              Reset Password
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Choose a new password for your account. You will need to sign in
              again with it.
            </p>
          </div>

          {/* Alert has no built-in live region, so failures are announced here. */}
          <div role="alert" aria-live="assertive">
            {state.message && (
              <div className="mb-5">
                <Alert
                  variant="error"
                  title="Password reset failed"
                  message={state.message}
                />
              </div>
            )}
          </div>

          <form action={formAction} noValidate>
            <div className="space-y-6">
              <PasswordInput
                id="password"
                name="password"
                label="New Password"
                toggleLabel="password"
                placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`}
                autoComplete="new-password"
                required
                errors={state.errors?.password}
                onValueChange={(value) =>
                  setEvaluation(evaluatePassword(value))
                }
              >
                {/* Shown once the user starts typing, so the untouched form
                    stays uncluttered. */}
                {evaluation && (
                  <PasswordStrengthMeter evaluation={evaluation} />
                )}
              </PasswordInput>

              <div>
                <Label htmlFor="confirmPassword">
                  Confirm Password <span className="text-error-500">*</span>
                </Label>
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  // Intentionally not covered by the toggle above: the point of
                  // a confirmation field is that it is retyped, not read back.
                  type="password"
                  placeholder="Re-enter your new password"
                  autoComplete="new-password"
                  error={Boolean(state.errors?.confirmPassword)}
                  hint={state.errors?.confirmPassword?.[0]}
                  aria-invalid={Boolean(state.errors?.confirmPassword)}
                />
              </div>

              <div>
                <SubmitButton />
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
