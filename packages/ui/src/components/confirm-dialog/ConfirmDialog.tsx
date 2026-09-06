"use client";

import * as AlertDialog from "@radix-ui/react-alert-dialog";
import React, { type ReactNode } from "react";

import { cx } from "../../lib/cn";
import Button from "../button/Button";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Say what will happen, and what cannot be undone. */
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "destructive";
  /**
   * Rendered in place of the default confirm button. Use this for a server
   * action: put the whole `<form action={...}>` here so `useFormStatus` can see
   * it. `useFormStatus` reads the *nearest ancestor form*, and this content is
   * portalled to <body> — a form left outside the dialog is invisible to it.
   */
  confirmSlot?: ReactNode;
  onConfirm?: () => void;
  busy?: boolean;
}

/**
 * A confirmation prompt for an irreversible action.
 *
 * Built on Radix AlertDialog rather than Dialog, deliberately: AlertDialog
 * gives `role="alertdialog"`, moves focus to a button rather than the panel,
 * and refuses to close on an outside click or Escape-to-dismiss-by-accident.
 * A destructive action should take a decision, not a stray click.
 *
 * Radix requires both a Title and a Description; both are mandatory props here
 * so an unlabelled dialog cannot be built.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  confirmSlot,
  onConfirm,
  busy = false,
}: ConfirmDialogProps) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <AlertDialog.Content
          className={cx(
            "fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2",
            "border-line bg-surface rounded-panel shadow-raised border p-5",
          )}
        >
          <AlertDialog.Title className="text-ink text-base font-semibold">
            {title}
          </AlertDialog.Title>
          <AlertDialog.Description className="text-ink-muted mt-2 text-sm">
            {description}
          </AlertDialog.Description>

          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button type="button" variant="secondary" size="sm">
                {cancelLabel}
              </Button>
            </AlertDialog.Cancel>

            {confirmSlot ?? (
              <Button
                type="button"
                size="sm"
                variant={variant === "destructive" ? "destructive" : "primary"}
                loading={busy}
                onClick={onConfirm}
              >
                {confirmLabel}
              </Button>
            )}
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

export default ConfirmDialog;
