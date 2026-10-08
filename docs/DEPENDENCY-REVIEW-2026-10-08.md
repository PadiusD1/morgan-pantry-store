# Dependency review, October 8 2026

The audit of the original locked dependency tree reported 3 affected runtime packages (1 critical, 1 moderate, 1 low) and 16 affected packages across runtime and tooling. These are package advisory counts, not proof that each vulnerability is exploitable in this application's configuration.

A review-only CI run used `npm audit fix --package-lock-only --ignore-scripts`, without `--force`, to resolve compatible fixes. The package manifest and root dependency declarations were checked to remain unchanged. The resulting lockfile's SHA-256 and Git blob hash were independently checked against the downloaded artifact before selecting it for this branch.

Candidate workflow run: https://github.com/PadiusD1/morgan-pantry-store/actions/runs/37839736266

Selected lockfile blob: `4a56d915771b2fdf39246335cba0d86637c9e562`

SHA-256: `698b471e079d1cddecbf3aa2da0a60214deffeeeac494de0a8be9eb155075675`

## Changes

Runtime fixes include proxy-addr 2.0.7 to 2.0.8, qs 6.15.1 to 6.16.0, and body-parser 2.2.2 to 2.3.0, with compatible support packages. Tooling updates include Vite 7.3.3 to 7.3.7, PostCSS 8.5.14 to 8.5.29, and patched Babel, brace-expansion, browserslist, fast-uri, nanoid, and source-map-js packages. No existing package was moved to a new major version. New nested content-type 2.1.0 entries satisfy the updated body-parser/type-is dependency requirements without replacing Express's separate version.

The candidate audit reports zero runtime advisories and zero high or critical advisories across the whole tree. The quality workflow rechecks the installed dependency tree after `npm ci`, then runs typechecking, unit tests, native PostgreSQL integration, the exact Vercel build, and browser regression tests. A candidate audit alone is not the release gate.

## Remaining moderate tooling chain

Four package entries remain in one development-only dependency chain:

`drizzle-kit -> @esbuild-kit/esm-loader -> @esbuild-kit/core-utils -> esbuild`

The nested esbuild advisory is GHSA-67mh-4wv8-2f99, concerning requests to esbuild's development server. These packages are not in the runtime dependency audit. The npm suggested forced action would downgrade drizzle-kit to 0.18.1; that potentially breaking downgrade was deliberately not applied. Do not expose this development tooling to untrusted networks, and review a compatible migration-tool update separately. Zero known runtime advisories is not a guarantee of complete application security.

## Repeatable policy

`node script/audit-dependencies.mjs` records runtime and full-tree audit evidence and fails on high or critical advisories. Moderate and low findings remain visible for review. The temporary write-enabled candidate workflow was removed after selecting the reviewed lockfile. The permanent quality workflow has read-only repository permissions and does not automatically merge or rewrite dependency files.

Primary advisory references:

- https://github.com/jshttp/proxy-addr/security/advisories/GHSA-jqcg-44mw-7w3h
- https://github.com/advisories/GHSA-v422-hmwv-36x6
- https://github.com/advisories/GHSA-4mjr-xmp4-gh2g
- https://github.com/advisories/GHSA-67mh-4wv8-2f99
