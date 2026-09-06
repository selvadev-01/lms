import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import Button from "./Button";

describe("Button", () => {
  afterEach(() => vi.restoreAllMocks());

  describe("type (the submit footgun)", () => {
    it("defaults to type=button, not the DOM default of submit", () => {
      render(<Button>Save</Button>);
      expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute(
        "type",
        "button",
      );
    });

    it("does not submit its form by default", async () => {
      const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
      render(
        <form onSubmit={onSubmit}>
          <Button>Just a button</Button>
        </form>,
      );
      await userEvent.click(screen.getByRole("button"));
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("submits when the caller explicitly asks", async () => {
      const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
      render(
        <form onSubmit={onSubmit}>
          <Button type="submit">Save</Button>
        </form>,
      );
      await userEvent.click(screen.getByRole("button"));
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it("warns in development when onClick is paired with type=submit", () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      render(
        <Button type="submit" onClick={() => {}}>
          Both
        </Button>,
      );
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('both onClick and type="submit"'),
      );
    });
  });

  describe("loading", () => {
    it("keeps the accessible name so getByRole still matches mid-flight", () => {
      const { rerender } = render(<Button>Sign in</Button>);
      expect(
        screen.getByRole("button", { name: "Sign in" }),
      ).toBeInTheDocument();

      rerender(<Button loading>Sign in</Button>);
      // Same name, still findable — this is what the e2e suite depends on.
      expect(
        screen.getByRole("button", { name: "Sign in" }),
      ).toBeInTheDocument();
    });

    it("disables the button and marks it busy", () => {
      render(<Button loading>Saving</Button>);
      const btn = screen.getByRole("button", { name: "Saving" });
      expect(btn).toBeDisabled();
      expect(btn).toHaveAttribute("aria-busy", "true");
    });

    it("does not fire onClick while loading", async () => {
      const onClick = vi.fn();
      render(
        <Button loading onClick={onClick}>
          Save
        </Button>,
      );
      await userEvent.click(screen.getByRole("button"));
      expect(onClick).not.toHaveBeenCalled();
    });

    it("hides the end icon while loading so the spinner reads cleanly", () => {
      render(
        <Button loading endIcon={<span data-testid="end-icon" />}>
          Save
        </Button>,
      );
      expect(screen.queryByTestId("end-icon")).not.toBeInTheDocument();
    });
  });

  describe("variants", () => {
    it("defaults to the secondary variant", () => {
      render(<Button>Default</Button>);
      expect(screen.getByRole("button")).toHaveClass("bg-surface");
    });

    it("applies the requested variant", () => {
      render(<Button variant="destructive">Delete</Button>);
      expect(screen.getByRole("button")).toHaveClass("bg-critical");
    });

    it("lets a caller className beat a variant default", () => {
      // Without tailwind-merge both classes would survive and stylesheet order
      // would decide which background actually paints.
      render(
        <Button variant="primary" className="bg-surface">
          Override
        </Button>,
      );
      const btn = screen.getByRole("button");
      expect(btn).toHaveClass("bg-surface");
      expect(btn).not.toHaveClass("bg-accent");
    });
  });

  describe("asChild", () => {
    it("renders the child element instead of a button", () => {
      render(
        <Button asChild variant="primary">
          <a href="/customers/new">Add Customer</a>
        </Button>,
      );
      // One control, with the right role — not an anchor nested in a button.
      expect(
        screen.getByRole("link", { name: "Add Customer" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("passes its styling to the child", () => {
      render(
        <Button asChild variant="primary">
          <a href="/x">Go</a>
        </Button>,
      );
      expect(screen.getByRole("link", { name: "Go" })).toHaveClass("bg-accent");
    });

    it("does not put type or disabled on a non-button child", () => {
      // Both are meaningless on an anchor, and `disabled` would style a link as
      // unavailable while leaving it fully clickable.
      render(
        <Button asChild disabled>
          <a href="/x">Go</a>
        </Button>,
      );
      const link = screen.getByRole("link", { name: "Go" });
      expect(link).not.toHaveAttribute("type");
      expect(link).not.toHaveAttribute("disabled");
    });
  });

  it("forwards a ref to the underlying button", () => {
    const ref = React.createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Ref</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it("forwards arbitrary button attributes", () => {
    render(<Button aria-label="Close dialog" data-testid="x" />);
    expect(screen.getByTestId("x")).toHaveAttribute(
      "aria-label",
      "Close dialog",
    );
  });
});
