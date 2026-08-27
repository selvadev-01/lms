import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Badge from "./Badge";

describe("Badge", () => {
  it("renders its children", () => {
    render(<Badge>Active</Badge>);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("applies the variant colour", () => {
    const { container } = render(<Badge color="success">Paid</Badge>);
    expect(container.firstElementChild?.className).toMatch(/success/);
  });

  it("defaults to the primary colour", () => {
    const { container } = render(<Badge>Draft</Badge>);
    expect(container.firstElementChild?.className).toMatch(/brand/);
  });
});
