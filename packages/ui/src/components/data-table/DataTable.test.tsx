import { render, screen, within } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";

import DataTable, { type Column } from "./DataTable";

interface Row {
  id: string;
  name: string;
  amount: string;
}

const rows: Row[] = [
  { id: "1", name: "R. Kumar", amount: "1,24,500.00" },
  { id: "2", name: "S. Devi", amount: "48,200.00" },
];

const columns: Column<Row>[] = [
  { key: "name", header: "Name", cell: (r) => r.name, priority: "primary" },
  {
    key: "amount",
    header: "Outstanding",
    cell: (r) => r.amount,
    numeric: true,
  },
];

const base = {
  rowKey: (r: Row) => r.id,
  emptyState: <p>No records</p>,
  caption: "Customers",
};

describe("DataTable", () => {
  it("names the table for screen readers", () => {
    render(<DataTable {...base} rows={rows} columns={columns} />);
    expect(
      screen.getByRole("table", { name: "Customers" }),
    ).toBeInTheDocument();
  });

  it("renders a header cell per column, scoped to its column", () => {
    render(<DataTable {...base} rows={rows} columns={columns} />);
    const headers = screen.getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual(["Name", "Outstanding"]);
    headers.forEach((h) => expect(h).toHaveAttribute("scope", "col"));
  });

  it("renders one row per record", () => {
    render(<DataTable {...base} rows={rows} columns={columns} />);
    // +1 for the header row.
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getByText("R. Kumar")).toBeInTheDocument();
  });

  it("gives numeric columns tabular figures so amounts align", () => {
    render(<DataTable {...base} rows={rows} columns={columns} />);
    const cell = screen.getByText("1,24,500.00");
    expect(cell).toHaveClass("tabular");
    expect(cell).toHaveClass("text-right");
  });

  it("shows the empty state instead of an empty table", () => {
    // An empty <table> with headers reads as "there is a table here" to a
    // screen reader, which is not the message.
    render(<DataTable {...base} rows={[]} columns={columns} />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("No records")).toBeInTheDocument();
  });

  it("applies compact density", () => {
    const { container } = render(
      <DataTable {...base} rows={rows} columns={columns} density="compact" />,
    );
    expect(container.querySelector("td")).toHaveClass("py-2");
  });

  it("defaults to comfortable density", () => {
    const { container } = render(
      <DataTable {...base} rows={rows} columns={columns} />,
    );
    expect(container.querySelector("td")).toHaveClass("py-3");
  });

  it("makes the header sticky only when asked", () => {
    const { container, rerender } = render(
      <DataTable {...base} rows={rows} columns={columns} />,
    );
    expect(container.querySelector("thead tr")).not.toHaveClass("sticky");

    rerender(
      <DataTable {...base} rows={rows} columns={columns} stickyHeader />,
    );
    expect(container.querySelector("thead tr")).toHaveClass("sticky");
  });

  it("scrolls horizontally in its own container, not the page", () => {
    const { container } = render(
      <DataTable {...base} rows={rows} columns={columns} />,
    );
    const wrapper = container.firstElementChild;
    expect(wrapper).toHaveClass("overflow-x-auto");
    // Required for a sticky header: overflow-y:auto would trap it in this box.
    expect(wrapper).toHaveClass("overflow-y-visible");
  });

  it("keeps each row's cells addressable by row", () => {
    render(<DataTable {...base} rows={rows} columns={columns} />);
    const row = screen.getByRole("row", { name: /R. Kumar/ });
    expect(within(row).getByText("1,24,500.00")).toBeInTheDocument();
  });
});
