"use client";

import { Alert, Button } from "@lms/ui";
import Link from "next/link";
import { useState } from "react";

export interface CredentialRevealPanelProps {
  /** The account's sign-in identifier, shown so both halves can be passed on together. */
  mobile: string;
  /** The password the administrator just set. Never fetched — only ever passed in. */
  password: string;
  /** Where "Done" goes: the list this account was created from. */
  returnHref: string;
  returnLabel: string;
}

/**
 * Shows a newly created account's password once, so it can be handed over.
 *
 * The server stores only an argon2 hash, so there is no route that could return
 * this again — a refresh loses it, and that is the intended shape rather than a
 * limitation. The password is in the open for as long as it takes to pass on and
 * no longer.
 *
 * The account is already confined: it can sign in and reach nothing but Change
 * Password until the user replaces this. That is what makes handing a password
 * over acceptable at all, and it is why the copy says so plainly.
 *
 * TODO: deliver by SMS instead. `SmsService` already exists and the console
 * provider prints to the API terminal in development, so the wiring is a
 * template plus a call at the end of `UserService.create`. Until then the
 * administrator is the delivery channel, which is why this panel exists.
 */
export default function CredentialRevealPanel({
  mobile,
  password,
  returnHref,
  returnLabel,
}: CredentialRevealPanelProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      // Long enough to read, short enough that the button does not look stuck.
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused outright — an insecure origin, or a
      // browser policy. The password is on screen either way, so there is
      // nothing to recover from and nothing worth interrupting the user about.
    }
  }

  return (
    <div className="space-y-5">
      <Alert
        variant="success"
        title="Account created"
        message="Give the password below to the new user. They will be asked to change it the first time they sign in."
      />

      <div className="rounded-2xl border border-gray-200 p-5 dark:border-gray-800">
        <dl className="space-y-4">
          <div>
            <dt className="text-sm text-gray-500 dark:text-gray-400">
              Mobile number
            </dt>
            <dd className="mt-1 font-mono text-base text-gray-800 dark:text-white/90">
              {mobile}
            </dd>
          </div>

          <div>
            <dt className="text-sm text-gray-500 dark:text-gray-400">
              Temporary password
            </dt>
            <dd className="mt-1 flex flex-wrap items-center gap-3">
              {/* Shown in the clear on purpose: the whole point of this panel is
                  that the administrator can read it out or copy it. */}
              <span className="font-mono text-base break-all text-gray-800 dark:text-white/90">
                {password}
              </span>
              <button
                type="button"
                onClick={copy}
                className="text-brand-500 hover:text-brand-600 dark:text-brand-400 text-sm underline"
              >
                {copied ? "Copied" : "Copy"}
              </button>
              {/* Announced rather than shown only as a label change, so the
                  outcome reaches someone not watching the button. */}
              <span aria-live="polite" className="sr-only">
                {copied ? "Password copied to clipboard" : ""}
              </span>
            </dd>
          </div>
        </dl>
      </div>

      {/* Deliberately does not offer "set a new one from the account's page":
          there is no such route. An administrator sets a password at creation
          and nowhere else, so the only recovery from losing this is the user's
          own Forgot Password flow — which works, because the account is ACTIVE. */}
      <Alert
        variant="warning"
        title="This is shown once"
        message="The password is not stored anywhere you can read it back. If you lose it before handing it over, the user can set their own from the Forgot Password link on the sign-in page."
      />

      <div className="flex justify-end">
        <Link href={returnHref}>
          <Button size="sm">{returnLabel}</Button>
        </Link>
      </div>
    </div>
  );
}
