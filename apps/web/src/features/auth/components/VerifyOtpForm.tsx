"use client";

import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import { Alert, Button } from "@lms/ui";
import { ChevronLeftIcon } from "@lms/ui/icons";
import Link from "next/link";
import React, { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  verifyOtpAction,
  type VerifyOtpState,
} from "../actions/verify-otp.action";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button className="w-full" size="sm" disabled={pending}>
      {pending ? "Verifying…" : "Verify code"}
    </Button>
  );
}

interface VerifyOtpFormProps {
  orgCode: string;
  mobile: string;
}

/** Shows only the last two digits, matching how the audit log masks mobiles. */
function maskMobile(mobile: string): string {
  if (mobile.length < 4) return "*".repeat(mobile.length);
  return `${"*".repeat(mobile.length - 2)}${mobile.slice(-2)}`;
}

/**
 * Step 2 of password recovery.
 *
 * `orgCode` and `mobile` ride along as hidden fields so the verification is
 * pinned to the account the code was issued for — a code delivered to one
 * number must not be redeemable against another.
 *
 * The screen is reached whether or not an account actually exists, so its copy
 * is written to be true in both cases: it never asserts that a code was sent.
 */
export default function VerifyOtpForm({ orgCode, mobile }: VerifyOtpFormProps) {
  const [state, formAction] = useActionState<VerifyOtpState, FormData>(
    verifyOtpAction,
    {},
  );

  const resendQuery = new URLSearchParams({ orgCode, mobile }).toString();

  return (
    <div className="flex w-full flex-1 flex-col lg:w-1/2">
      <div className="mx-auto mb-5 w-full max-w-md sm:pt-10">
        <Link
          href="/forgot-password"
          className="inline-flex items-center text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
        >
          <ChevronLeftIcon />
          Use a different number
        </Link>
      </div>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
        <div>
          <div className="mb-5 sm:mb-8">
            <h1 className="text-title-sm sm:text-title-md mb-2 font-semibold text-gray-800 dark:text-white/90">
              Enter Verification Code
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              If an account exists for {maskMobile(mobile)}, a 6-digit
              verification code has been sent to it. The code expires shortly.
            </p>
          </div>

          {/* Alert has no built-in live region, so failures are announced here. */}
          <div role="alert" aria-live="assertive">
            {state.message && (
              <div className="mb-5">
                <Alert
                  variant="error"
                  title="Verification failed"
                  message={state.message}
                />
              </div>
            )}
          </div>

          <form action={formAction} noValidate>
            <input type="hidden" name="orgCode" value={orgCode} />
            <input type="hidden" name="mobile" value={mobile} />

            <div className="space-y-6">
              <div>
                <Label htmlFor="otp">
                  Verification Code <span className="text-error-500">*</span>
                </Label>
                <Input
                  id="otp"
                  name="otp"
                  inputMode="numeric"
                  // one-time-code lets mobile browsers offer the SMS autofill.
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="6-digit code"
                  error={Boolean(state.errors?.otp)}
                  hint={state.errors?.otp?.[0]}
                  aria-invalid={Boolean(state.errors?.otp)}
                />
              </div>

              <div>
                <SubmitButton />
              </div>

              <p className="text-center text-sm text-gray-500 dark:text-gray-400">
                Didn&apos;t receive it?{" "}
                <Link
                  href={`/forgot-password?${resendQuery}`}
                  className="text-brand-500 hover:text-brand-600 dark:text-brand-400"
                >
                  Request a new code
                </Link>
              </p>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
