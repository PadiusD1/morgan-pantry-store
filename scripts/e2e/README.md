# Production browser verification

The production browser suite runs the generated `api/index.js` function and the built `dist/public` frontend. The test host applies the security headers and Content Security Policy from `vercel.json`, so a development server cannot hide a production-only script, asset, or CSP failure.

## Required tools

Use Node.js 22 and PostgreSQL 17. The native integration harness connects to a local PostgreSQL role named `frc` on port `55417`. That role needs permission to create test databases. A disposable Docker instance can provide it:

```sh
docker run --rm --name frc-audit-postgres \
  -e POSTGRES_USER=frc \
  -e POSTGRES_DB=postgres \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  -p 127.0.0.1:55417:5432 \
  postgres:17
```

This trust-authenticated database is for isolated local tests. Keep it bound to loopback and use no production data or credentials.

In a second terminal, from the repository root:

```sh
npm ci
npx playwright install --with-deps chromium
npm run check
npm test
FRC_TEST_PG_EXTERNAL=1 npm run test:integration
npm run build:vercel
npm run test:e2e:production
```

`build:vercel` reads and executes the existing `buildCommand` from `vercel.json`. Vercel and browser verification therefore use the same build command. It creates the frontend and the bundled serverless API; the browser runner refuses to start if either output is missing.

To run only one browser spec:

```sh
npm run test:e2e:production -- tests/e2e/reports.spec.ts
```

## Isolation and test data

The runner creates a new database named `frc_e2e_<random letters>` for each run, using the same migrations and production index fixture as the local development stack. It seeds synthetic inventory, students, partners, and donors, then creates admin, staff, volunteer, and student accounts with fresh random passwords. The application listens only on `127.0.0.1` at an available port. The runner passes that URL and the temporary credentials to Playwright.

After the tests finish, the runner stops its server, drops only its generated database, and removes its temporary authentication files. Browser screenshots, downloads, traces from failed tests, JSON results, and the production server log remain under `test-results/production-<random letters>/`.

The runner never loads `.env`. It rejects remote database URLs, connection-string host overrides, remote browser targets, and external Redis settings. The production server retains production barcode behavior; development fixture overrides are not enabled. External provider requests are blocked in the test process. Barcode browser tests use synthetic inventory records saved in the local database.

These optional settings support a different local setup:

| Variable | Purpose |
| --- | --- |
| `FRC_E2E_DATABASE_URL` | Local base namespace, for example `postgres://frc@localhost:55417/frc_e2e`. The runner creates a separate suffixed database. |
| `FRC_TEST_PG_PORT` | PostgreSQL port when using the default connection. Defaults to `55417`. |
| `FRC_E2E_PORT` | Local HTTP port. Defaults to `0`, which chooses an available port. |
| `FRC_E2E_AUTH_DIR` | Parent directory for a fresh per-run authentication subdirectory. |
| `FRC_E2E_RESULT_DIR` | Parent directory for a fresh per-run evidence subdirectory. |
| `FRC_E2E_CHROMIUM` | Optional existing Chromium executable for restricted local environments. |

## Continuous integration

`.github/workflows/frc-audit.yml` runs on pull requests, pushes to `main`, and manual dispatch. It provisions PostgreSQL 17, installs locked dependencies on Node.js 22, runs type checking and unit tests, executes the native PostgreSQL integration suite, builds the Vercel outputs, and runs Chromium against the production bundle with its CSP. An unsuccessful gate fails the workflow. Replaced runs on the same branch are cancelled to avoid duplicate work.

The workflow uses read-only repository permission and does not use production secrets or deploy the application. Browser evidence is retained as an Actions artifact for 14 days; temporary login state is not uploaded.

Successful local PGlite tests support application behavior checks, but do not establish that the native PostgreSQL integration suite has passed. The GitHub workflow supplies that native gate. This local host also does not emulate Vercel's global CDN latency, serverless concurrency, or production database contents.

The CI setup follows the official [GitHub PostgreSQL service-container guidance](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers) and [Playwright CI guidance](https://playwright.dev/docs/ci).
