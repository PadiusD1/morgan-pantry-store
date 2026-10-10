import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WeeklyMovementChart, CategoryInventoryChart } from "../client/src/components/operating-charts";

it("weekly chart exposes exact received/distributed quantities without hovering", () => {
  const html = renderToStaticMarkup(React.createElement(WeeklyMovementChart, { days: [{ day: "Mon", inbound: 40, outbound: 20 }, { day: "Tue", inbound: 0, outbound: 10 }] }));
  expect(html).toContain("Mon: 40 received, 20 distributed; Tue: 0 received, 10 distributed");
  expect(html).toContain('height="96"');
  expect(html).toContain('height="48"');
  expect(html).toContain('height="24"');
  expect(html).toContain("View the weekly numbers");
  expect(html).toContain('<th scope="row">Mon</th><td>40</td><td>20</td>');
  expect(html).not.toMatch(/canvas|recharts|<animate/);
});
it("category bars retain counts, percentages and escaped descriptions", () => {
  const html = renderToStaticMarkup(React.createElement(CategoryInventoryChart, { categories: [{ name: "Rice <script>", value: 60, percent: 60 }, { name: "Beans", value: 40, percent: 40 }] }));
  expect(html).toContain("100 units");
  expect(html).toContain('width="60"');
  expect(html).toContain('width="40"');
  expect(html).toContain("Rice &lt;script&gt;");
  expect(html).toContain("not weight or estimated value");
  expect(html).not.toContain("<script>");
});
it("zero totals never produce invalid chart dimensions", () => {
  for (const html of [
    renderToStaticMarkup(React.createElement(WeeklyMovementChart, { days: [{ day: "Mon", inbound: 0, outbound: 0 }] })),
    renderToStaticMarkup(React.createElement(CategoryInventoryChart, { categories: [{ name: "Empty", value: 0, percent: 0 }] })),
  ]) expect(html).not.toMatch(/NaN|Infinity/);
});
