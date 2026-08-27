"use client";

import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import PasswordInput from "@/components/form/input/PasswordInput";
import { Alert, Button } from "@lms/ui";
import { ChevronLeftIcon } from "@lms/ui/icons";
import Link from "next/link";
import React, { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { signInAction, type SignInState } from "../actions/sign-in.action";

function SubmitButton() {
  const { pending } = useFormStatus();
  // The accessible name stays "Sign in" while idle; the e2e suite matches it
  // exactly. Only the disabled state changes while the request is in flight.
  return (
    <Button className="w-full" size="sm" disabled={pending}>
      {pending ? "Signing in…" : "Sign in"}
    </Button>
  );
}

export default function SignInForm() {
  const [state, formAction] = useActionState<SignInState, FormData>(
    signInAction,
    {},
  );

  return (
    <div className="flex w-full flex-1 flex-col lg:w-1/2">
      <div className="mx-auto mb-5 w-full max-w-md sm:pt-10">
        <Link
          href="/"
          className="inline-flex items-center text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
        >
          <ChevronLeftIcon />
          Back to dashboard
        </Link>
      </div>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
        <div>
          <div className="mb-5 sm:mb-8">
            <h1 className="text-title-sm sm:text-title-md mb-2 font-semibold text-gray-800 dark:text-white/90">
              Sign In
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Enter your organization code, mobile number and password to sign
              in.
            </p>
          </div>

          {/* Alert has no built-in live region, so failures are announced here. */}
          <div role="alert" aria-live="assertive">
            {state.message && (
              <div className="mb-5">
                <Alert
                  variant="error"
                  title="Sign in failed"
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

              <PasswordInput
                id="password"
                name="password"
                label="Password"
                toggleLabel="password"
                placeholder="Enter your password"
                autoComplete="current-password"
                required
                errors={state.errors?.password}
              />

              <div className="flex items-center justify-end">
                <Link
                  href="/forgot-password"
                  className="text-brand-500 hover:text-brand-600 dark:text-brand-400 text-sm"
                >
                  Forgot password?
                </Link>
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
