import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { test, expect } from "vitest";

const directory = path.resolve("tests/e2e");
const files = readdirSync(directory).filter((entry) => entry.endsWith(".spec.ts"));

test("production browser fault injection includes service-worker-owned requests", () => {
  for (const file of files) {
    const source = readFileSync(path.join(directory, file), "utf8");
    expect(source, `${file}: use page.context().route or context.route so active service workers cannot bypass fault injection`).not.toMatch(/\bpage\s*\.\s*(?:route|unroute)\s*\(/);
  }
});

test("every browser spec parses before the production browser installation step", () => {
  for (const file of files) {
    const source = readFileSync(path.join(directory, file), "utf8");
    const result = ts.transpileModule(source, {
      fileName: file,
      reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
    });
    const errors = (result.diagnostics ?? []).filter((entry) => entry.category === ts.DiagnosticCategory.Error);
    expect(errors.map((entry) => ts.flattenDiagnosticMessageText(entry.messageText, "\n")), file).toEqual([]);
  }
});
