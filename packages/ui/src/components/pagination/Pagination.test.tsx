import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";

import Pagination from "./Pagination";

const hrefFor = (p: number) => `/customers?status=ACTIVE&page=${p}`;

describe("Pagination", () => {
  it("is a named landmark", () => {
    render(<Pagination page={2} pageSize={20} total={95} hrefFor={hrefFor} />);
    expect(
      screen.getByRole("navigation", { name: "Pagination" }),
    ).toBeInTheDocument();
  });

  it("reports the visible range and the total", () => {
    render(<Pagination page={2} pageSize={20} total={95} hrefFor={hrefFor} />);
    expect(screen.getByText("Showing 21–40 of 95")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 5")).toBeInTheDocument();
  });

  it("clamps the last row to the total on a partial final page", () => {
    render(<Pagination page={5} pageSize={20} total={95} hrefFor={hrefFor} />);
    expect(screen.getByText("Showing 81–95 of 95")).toBeInTheDocument();
  });

  it("preserves the other filter params in its links", () => {
    // Pagination that drops the active filters is worse than none.
    render(<Pagination page={2} pageSize={20} total={95} hrefFor={hrefFor} />);
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute(
      "href",
      "/customers?status=ACTIVE&page=3",
    );
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute(
      "href",
      "/customers?status=ACTIVE&page=1",
    );
  });

  it("renders no Previous link on the first page", () => {
    render(<Pagination page={1} pageSize={20} total={95} hrefFor={hrefFor} />);
    expect(
      screen.queryByRole("link", { name: "Previous" }),
    ).not.toBeInTheDocument();
    // Still shown as text, so the control does not jump around between pages.
    expect(screen.getByText("Previous")).toBeInTheDocument();
  });

  it("renders no Next link on the last page", () => {
    render(<Pagination page={5} pageSize={20} total={95} hrefFor={hrefFor} />);
    expect(
      screen.queryByRole("link", { name: "Next" }),
    ).not.toBeInTheDocument();
  });

  it("handles an empty result set without going negative", () => {
    render(<Pagination page={1} pageSize={20} total={0} hrefFor={hrefFor} />);
    expect(screen.getByText("Showing 0–0 of 0")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
  });

  it("marks Previous/Next with rel for assistive tech and prefetchers", () => {
    render(<Pagination page={2} pageSize={20} total={95} hrefFor={hrefFor} />);
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute(
      "rel",
      "next",
    );
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute(
      "rel",
      "prev",
    );
  });
});
