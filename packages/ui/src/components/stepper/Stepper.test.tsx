import { render, screen, within } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";

import Stepper, { type Step } from "./Stepper";

const steps: Step[] = [
  { label: "Customer", status: "complete", href: "?step=customer" },
  { label: "Loan Details", status: "current" },
  { label: "Scheme & Terms", status: "upcoming" },
  { label: "EMI Preview", status: "upcoming" },
];

describe("Stepper", () => {
  it("names the list so screen readers can identify it", () => {
    render(<Stepper steps={steps} label="Application steps" />);
    expect(
      screen.getByRole("list", { name: "Application steps" }),
    ).toBeInTheDocument();
  });

  it("marks exactly the current step with aria-current", () => {
    render(<Stepper steps={steps} label="Application steps" />);
    const items = within(
      screen.getByRole("list", { name: "Application steps" }),
    ).getAllByRole("listitem");
    const marked = items.filter(
      (li) => li.getAttribute("aria-current") === "step",
    );
    expect(marked).toHaveLength(1);
    expect(marked[0]).toHaveTextContent("Loan Details");
  });

  it("links only the steps that supply an href", () => {
    render(<Stepper steps={steps} label="Application steps" />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent("Customer");
  });

  it("hides the number/check glyph from assistive tech", () => {
    // The list already conveys position; announcing "1 Customer" is noise.
    const { container } = render(
      <Stepper steps={steps} label="Application steps" />,
    );
    const glyphs = container.querySelectorAll('span[aria-hidden="true"]');
    expect(glyphs.length).toBeGreaterThan(0);
  });

  it("exposes progress for the compact small-screen rendering", () => {
    render(<Stepper steps={steps} label="Application steps" />);
    const bar = screen.getByRole("progressbar", { name: "Application steps" });
    expect(bar).toHaveAttribute("aria-valuenow", "2");
    expect(bar).toHaveAttribute("aria-valuemax", "4");
    expect(screen.getByText(/Step 2 of 4 — Loan Details/)).toBeInTheDocument();
  });

  it("reports the final position when no step is current", () => {
    const done: Step[] = steps.map((s) => ({ ...s, status: "complete" }));
    render(<Stepper steps={done} label="Application steps" />);
    expect(
      screen.getByRole("progressbar", { name: "Application steps" }),
    ).toHaveAttribute("aria-valuenow", "4");
  });
});
