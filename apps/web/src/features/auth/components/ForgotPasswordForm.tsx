"use client";

import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import { Alert, Button } from "@lms/ui";
import { ChevronLeftIcon } from "@lms/ui/icons";
import Link from "next/link";
import React, { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  forgotPasswordAction,
  type ForgotPasswordState,
} from "../actions/forgot-password.action";

function SubmitButton() {
  const { pending } = useFormStatus();
  // The accessible name stays "Send code" while idle; the e2e suite matches it
  // exactly. Only the disabled state changes while the request is in flight.
  return (
    <Button className="w-full" size="sm" disabled={pending}>
      {pending ? "Sending…" : "Send code"}
    </Button>
  );
}

/**
 * Step 1 of password recovery.
 *
 * Collects only the mobile number and organization code. There is deliberately
 * no password field: the screen exists precisely because the password is
 * unavailable (Forgot Password rule 5, Scenario 1).
 */
export default function ForgotPasswordForm() {
  const [state, formAction] = useActionState<ForgotPasswordState, FormData>(
    forgotPasswordAction,
    {},
  );

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
              Forgot Password
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Enter your organization code and registered mobile number. We will
              send a verification code to that number.
            </p>
          </div>

          {/* Alert has no built-in live region, so failures are announced here. */}
          <div role="alert" aria-live="assertive">
            {state.message && (
              <div className="mb-5">
                <Alert
                  variant="error"
                  title="Could not send code"
                  message={state.message}
                />
              </div>
            )}
          </div>

          <form action={formAction} noValidate>
            <div className="space-y-6">
              <div>
                <Label htmlFor="orgCode">
                  Organization Code <span className="text-error-500">*</span>
                </Label>
                <Input
                  id="orgCode"
                  name="orgCode"
                  placeholder="Enter your organization code"
                  autoComplete="organization"
                  autoCapitalize="characters"
                  error={Boolean(state.errors?.orgCode)}
                  hint={state.errors?.orgCode?.[0]}
                  aria-invalid={Boolean(state.errors?.orgCode)}
                />
              </div>

              <div>
                <Label htmlFor="mobile">
                  Mobile Number <span className="text-error-500">*</span>
                </Label>
                <Input
                  id="mobile"
                  name="mobile"
                  type="tel"
                  inputMode="numeric"
                  placeholder="10-digit mobile number"
                  autoComplete="username"
                  error={Boolean(state.errors?.mobile)}
                  hint={state.errors?.mobile?.[0]}
                  aria-invalid={Boolean(state.errors?.mobile)}
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
