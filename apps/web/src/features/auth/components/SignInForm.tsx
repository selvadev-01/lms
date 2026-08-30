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
    <Button className="h-11 w-full" size="sm" disabled={pending}>
      {pending ? "Signing in…" : "Sign in"}
    </Button>
  );
}

export interface SignInFormProps {
  /**
   * Pre-fills the organization code. Signup redirects here with the code it
   * canonicalised, so the new administrator does not have to guess the casing.
   *
   * Passed down from the page rather than read with `useSearchParams`, which
   * would opt this route out of prerendering and require a Suspense boundary
   * around the whole form. Applied as `defaultValue`, so the field stays
   * uncontrolled and editable.
   */
  defaultOrgCode?: string;
}

export default function SignInForm({ defaultOrgCode }: SignInFormProps = {}) {
  const [state, formAction] = useActionState<SignInState, FormData>(
    signInAction,
    {},
  );

  return (
    <div className="flex w-full flex-1 flex-col lg:w-1/2">
      <div className="mx-auto w-full max-w-md pt-2 sm:pt-8">
        <Link
          href="/"
          className="inline-flex items-center gap-1 rounded-lg py-1 text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
        >
          <ChevronLeftIcon />
          Back to dashboard
        </Link>
      </div>

      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-8">
        {/* On small screens the card is the page; from `sm` up it gains a
            surface of its own so the form reads as a discrete object rather
            than text floating on the background. */}
        <div className="rounded-2xl border-gray-200 bg-transparent sm:border sm:bg-white sm:p-8 sm:shadow-sm dark:border-gray-800 sm:dark:bg-white/[0.03]">
          <div className="mb-7">
            <h1 className="text-title-sm sm:text-title-md mb-2 font-semibold text-gray-800 dark:text-white/90">
              Sign in
            </h1>
            <p className="text-sm leading-relaxed text-gray-500 dark:text-gray-400">
              Enter your organization code, mobile number and password to
              continue.
            </p>
          </div>

          {/* Alert has no built-in live region, so failures are announced here. */}
          <div role="alert" aria-live="assertive">
            {state.message && (
              <div className="mb-6">
                <Alert
                  variant="error"
                  title="Sign in failed"
                  message={state.message}
                />
              </div>
            )}
          </div>

          <form action={formAction} noValidate>
            <div className="space-y-5">
              <div>
                <Label htmlFor="orgCode">
                  Organization Code <span className="text-error-500">*</span>
                </Label>
                {/* The code is a machine identifier, so it is shown in the
                    tracking and casing it is stored in. `uppercase` is purely
                    visual — the value still posts exactly as typed, and the
                    server canonicalises it. */}
                <Input
                  id="orgCode"
                  name="orgCode"
                  defaultValue={defaultOrgCode}
                  className="font-mono tracking-[0.08em] uppercase placeholder:font-sans placeholder:tracking-normal placeholder:normal-case"
                  placeholder="Enter your organization code"
                  autoComplete="organization"
                  autoCapitalize="characters"
                  spellCheck={false}
                  error={Boolean(state.errors?.orgCode)}
                  hint={state.errors?.orgCode?.[0]}
                  aria-invalid={Boolean(state.errors?.orgCode)}
                />
              </div>

              <div>
                <Label htmlFor="mobile">
                  Mobile Number <span className="text-error-500">*</span>
                </Label>
                {/* The +91 prefix is decoration, not an input: every account is
                    a 10-digit Indian mobile, and the field posts those 10
                    digits unchanged. `aria-hidden` keeps it out of the field's
                    accessible name, which the e2e suite matches on. */}
                <div className="relative">
                  {/* `z-10`: the input paints its own background (opaque in
                      dark mode), which would otherwise cover this prefix. */}
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute top-0 left-0 z-10 flex h-11 items-center border-r border-gray-300 pr-3 pl-4 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400"
                  >
                    +91
                  </span>
                  <Input
                    id="mobile"
                    name="mobile"
                    type="tel"
                    inputMode="numeric"
                    className="pl-[4.25rem]"
                    placeholder="10-digit mobile number"
                    autoComplete="username"
                    maxLength={10}
                    error={Boolean(state.errors?.mobile)}
                    hint={state.errors?.mobile?.[0]}
                    aria-invalid={Boolean(state.errors?.mobile)}
                  />
                </div>
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

              <div className="flex justify-end">
                <Link
                  href="/forgot-password"
                  className="text-brand-500 hover:text-brand-600 dark:text-brand-400 rounded text-sm font-medium transition-colors"
                >
                  Forgot password?
                </Link>
              </div>

              <SubmitButton />
            </div>
          </form>

          <p className="mt-6 border-t border-gray-100 pt-6 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
            New organization?{" "}
            <Link
              href="/signup"
              className="text-brand-500 hover:text-brand-600 dark:text-brand-400 font-medium transition-colors"
            >
              Create an account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
