/** Record advisories separately and block high/critical regressions without forced upgrades. */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

mkdirSync("test-results/dependencies", { recursive: true });
let blocked = false;
for (const [scope, flags] of [["runtime", ["--omit=dev"]], ["all", []]]) {
  const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["audit", "--json", ...flags], {
    encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 120_000,
  });
  if (result.error) throw result.error;
  let audit;
  try { audit = JSON.parse(result.stdout); } catch { throw new Error(`Dependency audit ${scope} returned no valid JSON.`); }
  writeFileSync(`test-results/dependencies/${scope}.json`, JSON.stringify(audit, null, 2));
  if (audit.error || !audit.metadata?.vulnerabilities) throw new Error(`Dependency audit ${scope} could not complete.`);
  const counts = audit.metadata.vulnerabilities;
  console.log(`DEPENDENCY_AUDIT ${scope} ${JSON.stringify(counts)}`);
  for (const [name, issue] of Object.entries(audit.vulnerabilities || {})) {
    console.log(JSON.stringify({ scope, name, severity: issue.severity, direct: issue.isDirect, range: issue.range, fixAvailable: issue.fixAvailable, via: issue.via }));
  }
  if (counts.high > 0 || counts.critical > 0) blocked = true;
}
if (blocked) throw new Error("High or critical dependency advisories require a reviewed fix before release.");
