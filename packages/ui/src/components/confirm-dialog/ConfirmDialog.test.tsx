import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import ConfirmDialog from "./ConfirmDialog";

const base = {
  title: "Delete role",
  description: "This cannot be undone.",
  onOpenChange: () => {},
};

describe("ConfirmDialog", () => {
  it("uses the alertdialog role, not a plain dialog", () => {
    // alertdialog is what makes a screen reader interrupt rather than queue.
    render(<ConfirmDialog {...base} open />);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("is labelled and described by its own title and description", () => {
    render(<ConfirmDialog {...base} open />);
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAccessibleName("Delete role");
    expect(dialog).toHaveAccessibleDescription("This cannot be undone.");
  });

  it("moves focus into the dialog when it opens", async () => {
    // The old hand-rolled Modal left focus on the page behind it, so a keyboard
    // user tabbed through the obscured page instead of the prompt.
    render(<ConfirmDialog {...base} open />);
    await waitFor(() =>
      expect(
        screen.getByRole("alertdialog").contains(document.activeElement),
      ).toBe(true),
    );
  });

  it("renders nothing while closed", () => {
    render(<ConfirmDialog {...base} open={false} />);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("fires onConfirm from the confirm button", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        {...base}
        open
        confirmLabel="Delete"
        onConfirm={onConfirm}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("closes via Cancel", async () => {
    const onOpenChange = vi.fn();
    render(<ConfirmDialog {...base} open onOpenChange={onOpenChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders a confirmSlot in place of the default button", () => {
    // The server-action case: the whole form must live inside the portalled
    // content so useFormStatus can find it.
    render(
      <ConfirmDialog
        {...base}
        open
        confirmSlot={
          <form action="/delete">
            <button type="submit">Delete for real</button>
          </form>
        }
      />,
    );
    expect(
      screen.getByRole("button", { name: "Delete for real" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Confirm" }),
    ).not.toBeInTheDocument();
  });

  it("disables the confirm button while busy but keeps its name", () => {
    render(<ConfirmDialog {...base} open confirmLabel="Delete" busy />);
    const btn = screen.getByRole("button", { name: "Delete" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
  });
});
