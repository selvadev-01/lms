"use client";

import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import PasswordInput from "@/components/form/input/PasswordInput";
import { Alert, Button } from "@lms/ui";
import { ChevronLeftIcon } from "@lms/ui/icons";
import { evaluatePassword, PASSWORD_MIN_LENGTH } from "@lms/validation";
import Link from "next/link";
import React, { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { signUpAction, type SignUpState } from "../actions/sign-up.action";
import PasswordStrengthMeter, {
  type PasswordEvaluation,
} from "./PasswordStrengthMeter";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" size="sm" disabled={pending}>
      {pending ? "Creating…" : "Create organization"}
    </Button>
  );
}

/**
 * Creates an organization and its first Super Admin.
 *
 * Five fields, deliberately. Branch details are not asked for — the server
 * creates one and the new administrator completes it afterwards — because the
 * value of this form is that it takes one screen.
 */
export default function SignUpForm() {
  const [state, formAction] = useActionState<SignUpState, FormData>(
    signUpAction,
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
      <div className="mx-auto mb-5 w-full max-w-md sm:pt-10">
        <Link
          href="/signin"
          className="inline-flex items-center text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
        >
          <ChevronLeftIcon />
          Back to sign in
        </Link>
      </div>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
        <div>
          <div className="mb-5 sm:mb-8">
            <h1 className="text-title-sm sm:text-title-md mb-2 font-semibold text-gray-800 dark:text-white/90">
              Create Organization
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Set up a new organization and its first administrator. You can add
              branches, staff and products once you are signed in.
            </p>
          </div>

          {/* Alert has no built-in live region, so failures are announced here. */}
          <div role="alert" aria-live="assertive">
            {state.message && (
              <div className="mb-5">
                <Alert
                  variant="error"
                  title="Could not create organization"
                  message={state.message}
                />
              </div>
            )}
          </div>

          <form action={formAction} noValidate>
            <div className="space-y-6">
              <div>
                <Label htmlFor="orgName">
                  Organization Name <span className="text-error-500">*</span>
                </Label>
                <Input
                  id="orgName"
                  name="orgName"
                  placeholder="e.g. Kestrel Finance"
                  autoComplete="organization"
                  error={Boolean(state.errors?.orgName)}
                  hint={state.errors?.orgName?.[0]}
                  aria-invalid={Boolean(state.errors?.orgName)}
                />
              </div>

              <div>
                <Label htmlFor="orgCode">
                  Organization Code <span className="text-error-500">*</span>
                </Label>
                <Input
                  id="orgCode"
                  name="orgCode"
                  placeholder="e.g. KESTREL"
                  autoCapitalize="characters"
                  error={Boolean(state.errors?.orgCode)}
                  hint={
                    state.errors?.orgCode?.[0] ??
                    "Everyone in your organization types this to sign in. Letters, digits, hyphens and underscores."
                  }
                  aria-invalid={Boolean(state.errors?.orgCode)}
                />
              </div>

              <div>
                <Label htmlFor="adminName">
                  Your Name <span className="text-error-500">*</span>
                </Label>
                <Input
                  id="adminName"
                  name="adminName"
                  placeholder="Your full name"
                  autoComplete="name"
                  error={Boolean(state.errors?.adminName)}
                  hint={state.errors?.adminName?.[0]}
                  aria-invalid={Boolean(state.errors?.adminName)}
                />
              </div>

              <div>
                <Label htmlFor="adminMobile">
                  Mobile Number <span className="text-error-500">*</span>
                </Label>
                <Input
                  id="adminMobile"
                  name="adminMobile"
                  type="tel"
                  inputMode="numeric"
                  placeholder="10-digit mobile number"
                  autoComplete="username"
                  error={Boolean(state.errors?.adminMobile)}
                  hint={
                    state.errors?.adminMobile?.[0] ??
                    "You will sign in with this number."
                  }
                  aria-invalid={Boolean(state.errors?.adminMobile)}
                />
              </div>

              <PasswordInput
                id="password"
                name="password"
                label="Password"
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

              <PasswordInput
                id="confirmPassword"
                name="confirmPassword"
                label="Confirm Password"
                toggleLabel="confirm password"
                placeholder="Re-enter your password"
                autoComplete="new-password"
                required
                errors={state.errors?.confirmPassword}
              />

              <div>
                <SubmitButton />
              </div>

              <p className="text-center text-sm text-gray-500 dark:text-gray-400">
                Already have an organization?{" "}
                <Link
                  href="/signin"
                  className="text-brand-500 hover:text-brand-600 dark:text-brand-400"
                >
                  Sign in
                </Link>
              </p>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
