import { CSV_BOM } from "@shared/csv";

// Long enough for every browser to start the download before the URL goes.
export const REVOKE_DELAY_MS = 60_000;

// The server refuses its CSV exports to volunteers, so only these roles see them.
export const SERVER_EXPORT_ROLES = ["admin", "staff"] as const;

export function canUseServerExports(role: string | undefined | null): boolean {
  return !!role && (SERVER_EXPORT_ROLES as readonly string[]).includes(role);
}

// Attaches the link to the page before clicking, as Firefox needs, and
// revokes the object URL only after a delay so the download can start.
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
  }
}

export function downloadCsvText(text: string, filename: string): void {
  const body = text.startsWith(CSV_BOM) ? text : CSV_BOM + text;
  downloadBlob(new Blob([body], { type: "text/csv;charset=utf-8" }), filename);
}

// Fetches a server CSV and saves it. res.text() drops any byte order mark,
// and downloadCsvText writes exactly one.
export async function downloadServerCsv(url: string, filename: string): Promise<void> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  downloadCsvText(await res.text(), filename);
}
