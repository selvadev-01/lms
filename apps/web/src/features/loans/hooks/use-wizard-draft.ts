"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Keeps the loan application wizard's answers across a refresh, a browser Back,
 * and a deep link into a later step.
 *
 * WHY sessionStorage and not a draft row: the schema decision (D-APP-1) is that
 * no `loan_applications` row exists until submit — nine of its columns are
 * NOT NULL, and making them nullable for a draft's sake would force every later
 * reader, through approval and disbursal, to null-check columns that are always
 * populated by the time they see them. So the half-finished application has to
 * live somewhere client-side.
 *
 * WHY sessionStorage and not localStorage: this is per-tab and dies with it.
 * Branch machines are shared, and a half-typed loan application belonging to
 * whoever sat here last is both confusing and a small disclosure.
 *
 * The `:v1` suffix is a schema version. Bump it whenever the field set changes,
 * so a stale shape is discarded wholesale rather than partially rehydrated into
 * a form that then submits a mix of old and new answers.
 */
const STORAGE_KEY = "lms:wizard:loan-application:v1";

/** Debounce so typing an amount does not write on every keystroke. */
const WRITE_DELAY_MS = 200;

export type WizardDraft = Record<string, string>;

/**
 * Read the stored draft.
 *
 * Exported so the caller can read it in a `useState` initializer, which runs
 * once and needs no extra render to fetch the value.
 *
 * It must NOT be used as the initial value of the form fields themselves. The
 * wizard is a client component, but Next server-renders it and hydration
 * replays that render in the browser; a lazy initializer runs during exactly
 * that replay, so seeding fields from storage makes the client tree disagree
 * with the server HTML. That is a real bug we shipped once — the Stepper
 * rendered step one as a `<span>` on the server and an `<a>` on the client, and
 * React discarded the tree. Fields start empty to match the server, and the
 * draft is applied in a layout effect afterwards.
 */
export function readWizardDraft(): WizardDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as WizardDraft) : null;
  } catch {
    // A private-mode browser, a cleared store, or a value from an older shape.
    // None is worth an error: the wizard simply starts empty.
    return null;
  }
}

export function useWizardDraft(): {
  save: (draft: WizardDraft) => void;
  clear: () => void;
} {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback((next: WizardDraft) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Storage full or blocked. The wizard still works in this tab; only
        // refresh-survival is lost, which is not worth interrupting anyone for.
      }
    }, WRITE_DELAY_MS);
  }, []);

  const clear = useCallback(() => {
    // Cancel any pending write first: a debounced save landing after a
    // successful submit would resurrect an application that no longer exists
    // as a draft.
    if (timer.current) clearTimeout(timer.current);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* nothing to do */
    }
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { save, clear };
}

export const WIZARD_DRAFT_STORAGE_KEY = STORAGE_KEY;
