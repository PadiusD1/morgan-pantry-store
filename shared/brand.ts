/** Systems by Design, The Firm (V19). Source: systems-by-design/DESIGN.md.
 * Morgan remains the client; this signature identifies the system designer.
 * Shared by the application and the printable board document.
 */
export const BRAND = {
  name: "Systems by Design",
  website: "https://systemsbydesigns.com",
  domain: "systemsbydesigns.com",
  client: "Morgan State University",
  program: "Food Resource Center",
  fontStylesheet: "https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&family=Source+Serif+4:wght@400&display=swap",
} as const;

export const BRAND_TOKENS = {
  "--sbd-blue": "#1d4ed8",
  "--sbd-blue-hover": "#1e40af",
  "--sbd-paper": "#ffffff",
  "--sbd-surface": "#f8fafc",
  "--sbd-line": "#e2e8f0",
  "--sbd-ink": "#0f172a",
  "--sbd-muted": "#475569",
  "--sbd-soft": "#eff6ff",
  "--sbd-amber": "#b45309",
  "--sbd-amber-soft": "#fffbeb",
  "--sbd-green": "#047857",
  "--sbd-morgan-blue": "#1B4383",
  "--sbd-morgan-orange": "#F47937",
  "--sbd-radius": "2px",
  "--sbd-sans": '"Hanken Grotesk", system-ui, -apple-system, "Segoe UI", sans-serif',
  "--sbd-serif": '"Source Serif 4", Georgia, "Times New Roman", serif',
  "--sbd-mono": '"JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace',
} as const;

export const BRAND_CSS = `:root{${Object.entries(BRAND_TOKENS).map(([key, value]) => `${key}:${value}`).join(";")}}`;

// The existing SBD loop mark, not a newly invented logo.
export const BRAND_MARK_PATH = "M228,48V96a12,12,0,0,1-12,12H168a12,12,0,0,1,0-24h19l-7.8-7.8a75.55,75.55,0,0,0-53.32-22.26h-.43A75.49,75.49,0,0,0,72.39,75.57,12,12,0,1,1,55.61,58.41a99.38,99.38,0,0,1,69.87-28.47H126A99.42,99.42,0,0,1,196.2,59.23L204,67V48a12,12,0,0,1,24,0ZM183.61,180.43a75.49,75.49,0,0,1-53.09,21.63h-.43A75.55,75.55,0,0,1,76.77,179.8L69,172H88a12,12,0,0,0,0-24H40a12,12,0,0,0-12,12v48a12,12,0,0,0,24,0V189l7.8,7.8A99.42,99.42,0,0,0,130,226.06h.56a99.38,99.38,0,0,0,69.87-28.47,12,12,0,0,0-16.78-17.16Z";

export function brandMarkSvg(): string {
  return `<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="15" fill="var(--sbd-blue)"/><g transform="translate(12,12) scale(0.15625)"><path d="${BRAND_MARK_PATH}" fill="var(--sbd-paper)"/></g></svg>`;
}
