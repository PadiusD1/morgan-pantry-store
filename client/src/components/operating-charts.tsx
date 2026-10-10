import React from "react";

type Day = { day: string; inbound: number; outbound: number };
type Category = { name: string; value: number; percent: number };
const count = (value: number) => value.toLocaleString("en-US");

/** Native charts: no chart runtime, animation, hover-only values or canvas. */
export function WeeklyMovementChart({ days }: { days: Day[] }) {
  const max = Math.max(1, ...days.flatMap(day => [day.inbound, day.outbound]));
  return <figure className="sbd-weekly-figure" data-testid="weekly-movement-figure">
    <figcaption className="sbd-chart-legend"><span><i className="sbd-key-received" aria-hidden="true" />Received</span><span><i className="sbd-key-distributed" aria-hidden="true" />Distributed</span><small>Units / last 7 days</small></figcaption>
    <div className="sbd-weekly-chart" role="img" aria-label={days.map(day => `${day.day}: ${day.inbound} received, ${day.outbound} distributed`).join("; ")}>
      {days.map((day, index) => <div className="sbd-day" key={`${day.day}-${index}`}>
        <div className="sbd-day-bars">{(["inbound", "outbound"] as const).map(key => <div className="sbd-bar-track" key={key}>
          <span className="sbd-bar-count">{count(day[key])}</span>
          <svg viewBox="0 0 28 100" preserveAspectRatio="none" aria-hidden="true"><rect x="2" y={100 - day[key] / max * 96} width="24" height={day[key] / max * 96} fill={key === "inbound" ? "var(--sbd-blue)" : "var(--sbd-muted)"} /></svg>
        </div>)}</div><span className="sbd-day-label">{day.day}</span>
      </div>)}
    </div>
    <details className="sbd-chart-data"><summary>View the weekly numbers</summary><table><caption className="sr-only">Weekly movement in units</caption><thead><tr><th scope="col">Day</th><th scope="col">Received</th><th scope="col">Distributed</th></tr></thead><tbody>{days.map((day, index) => <tr key={index}><th scope="row">{day.day}</th><td>{count(day.inbound)}</td><td>{count(day.outbound)}</td></tr>)}</tbody></table></details>
  </figure>;
}

export function CategoryInventoryChart({ categories }: { categories: Category[] }) {
  const total = categories.reduce((sum, category) => sum + category.value, 0);
  return <figure className="sbd-category-figure" data-testid="category-inventory-figure">
    <figcaption className="sbd-chart-caption"><strong>{count(total)} units</strong><span>Recorded stock by category</span></figcaption>
    <ul className="sbd-category-list">{categories.map((category, index) => <li key={category.name} data-testid={`category-chart-row-${index}`}>
      <div><span>{category.name}</span><strong>{count(category.value)} <small> / {category.percent}%</small></strong></div>
      <svg viewBox="0 0 100 3" preserveAspectRatio="none" aria-hidden="true"><rect width="100" height="3" fill="var(--sbd-line)" /><rect width={Math.max(0, Math.min(100, total > 0 ? category.value / total * 100 : 0))} height="3" fill="var(--sbd-blue)" /></svg>
    </li>)}</ul>
    <p className="sbd-chart-note">Share of recorded units, not weight or estimated value.</p>
  </figure>;
}
