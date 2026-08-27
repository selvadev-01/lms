"use client";

import { evaluatePassword } from "@lms/validation";
import React from "react";

/**
 * The result of evaluating a password — deliberately not the password itself.
 *
 * `ResetPasswordForm` keeps its password field uncontrolled so the plaintext
 * never becomes React state, never enters the RSC payload and never reaches the
 * client bundle. This component preserves that: it accepts only the derived
 * booleans, so there is no path by which holding it in state could leak the
 * value (Scenario 21, story rule 8).
 */
export type PasswordEvaluation = ReturnType<typeof evaluatePassword>;

const SEGMENTS = 4;

/** Bar colour and label by score. Index 0 is the untouched, empty state. */
const LEVELS = [
  { label: "", className: "bg-gray-200 dark:bg-gray-700" },
  { label: "Weak", className: "bg-error-500" },
  { label: "Fair", className: "bg-warning-500" },
  { label: "Good", className: "bg-blue-light-500" },
  { label: "Strong", className: "bg-success-500" },
] as const;

export default function PasswordStrengthMeter({
  evaluation,
}: {
  evaluation: PasswordEvaluation;
}) {
  const { score, rules } = evaluation;
  const level = LEVELS[Math.min(score, LEVELS.length - 1)];

  return (
    <div className="mt-3">
      {/*
        The bar is decorative: the checklist below carries the same information
        as text, so a screen reader is told the requirements rather than being
        read a row of coloured divs.
      */}
      <div className="flex gap-1.5" aria-hidden="true">
        {Array.from({ length: SEGMENTS }, (_, index) => (
          <div
            key={index}
            className={`h-1 flex-1 rounded-full transition-colors ${
              index < score ? level.className : LEVELS[0].className
            }`}
          />
        ))}
      </div>

      {level.label && (
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Password strength:{" "}
          <span className="font-medium text-gray-700 dark:text-gray-300">
            {level.label}
          </span>
        </p>
      )}

      {/*
        Announced politely rather than assertively: the checklist updates on
        every keystroke, and an assertive region would interrupt the user
        continuously as they type.
      */}
      <ul className="mt-2 space-y-1" aria-live="polite">
        {rules.map((rule) => (
          <li
            key={rule.id}
            className={`flex items-center gap-2 text-xs ${
              rule.satisfied
                ? "text-success-600 dark:text-success-400"
                : "text-gray-500 dark:text-gray-400"
            }`}
          >
            <span aria-hidden="true">{rule.satisfied ? "✓" : "○"}</span>
            <span>
              {rule.label}
              <span className="sr-only">
                {rule.satisfied ? " — met" : " — not yet met"}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
