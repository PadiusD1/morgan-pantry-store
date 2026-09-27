import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function page(name: string) {
  return readFileSync(path.join(__dirname, "..", "client", "src", "pages", name), "utf8");
}

/** The keydown handler written just before the given test id. */
function handlerBefore(source: string, testId: string) {
  const at = source.indexOf(`data-testid="${testId}"`);
  expect(at).toBeGreaterThan(0);
  const start = source.lastIndexOf("onKeyDown={(e) => {", at);
  expect(start).toBeGreaterThan(0);
  return source.slice(start, at);
}

describe("the barcode fields end a scan on a Tab burst like on Enter", () => {
  for (const [file, testId] of [
    ["check-out.tsx", "input-barcode"],
    ["check-in.tsx", "input-checkin-barcode-scan"],
  ] as const) {
    it(`${file} asks the scanner whether a Tab ended a burst`, () => {
      const source = page(file);
      expect(source).toContain("const tabEndsScan = useScanner(scanQueue.push);");
      const handler = handlerBefore(source, testId);
      expect(handler).toContain('e.key === "Enter" || (e.key === "Tab" && tabEndsScan(e.currentTarget.value))');
      expect(handler).toContain("e.preventDefault();");
      expect(handler).toContain("scanQueue.push(");
    });
  }
});
