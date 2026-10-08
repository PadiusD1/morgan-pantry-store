# Morgan State Food Resource Center

The FRC application records pantry receiving, distribution, inventory, donors, partners, client visits, requests, and reporting. The current application is a shared PostgreSQL-backed service, not the earlier single-laptop SQLite implementation.

## Current architecture

React 19, Vite, Tailwind CSS, Radix UI, and TanStack Query provide the browser interface. Express 5, TypeScript, Zod, Drizzle ORM, and node-postgres provide the API. Authentication uses signed, HttpOnly session cookies and role-based API authorization.

Vercel builds the frontend into `dist/public` and bundles the API into `api/index.js`. `vercel.json` routes API requests to that function and application routes to the frontend. The deployed database connection uses `DATABASE_URL`; the connection layer is in `server/pg.ts` and is configured for Supabase PostgreSQL.

The browser's cached application shell is not an offline database. A network connection and a working database are required to save shared records. Do not assume a failed request saved successfully or repeat an uncertain write with a new identity. The save/retry workflows preserve idempotency keys where implemented.

## Board reporting and daily workflows

In **Reports**, choose the reporting dates, then use **Board summary CSV** or **Print / save PDF**. The board summary includes distribution visits, distinct linked clients, units, weight, estimated value, emergency visits, received stock, current stock alerts, and definitions. It excludes client names, identifiers, contact details, locations, and donor names.

Dates follow the Baltimore calendar (`America/New_York`), including the end date. Current inventory is a snapshot taken when the report is generated, not historical end-of-period stock. Received stock includes purchases and transfers, not donations alone. Missing recorded weights or values are flagged rather than silently assumed to be complete.

Detailed operational exports contain sensitive records and are separate from the board summary. Share them only with authorized recipients. The JSON snapshot export is not a complete PostgreSQL backup and cannot be safely restored by replaying inventory movements.

Saved item-name, brand, and barcode suggestions help reuse existing items during receiving and inventory entry. Choosing a saved item carries its stored details and identity forward. Donor saves update the canonical donor record and related views; existing donation history remains linked by donor ID. Mark a historical donor inactive instead of deleting its history.

## Local development on synthetic data

Use Node.js 22, npm, and PostgreSQL 17. Clone this repository and install its locked dependencies:

```sh
git clone https://github.com/PadiusD1/morgan-pantry-store.git
cd morgan-pantry-store
npm ci
```

For the isolated development stack, follow [scripts/local-stack/README.md](scripts/local-stack/README.md). Its start script creates a loopback-only PostgreSQL cluster, applies the checked-in migrations and index fixture, seeds synthetic records, and generates temporary local credentials. It does not use production credentials or modify production records. PostgreSQL cluster initialization must run as a non-root user.

For an independently provisioned development database, configure `DATABASE_URL` and a random `SESSION_SECRET` of at least 32 characters in a local, uncommitted `.env`. The database must already have the required schema. Set `COOKIE_SECURE=false` only for local HTTP, then run `npm run dev`. The server does not automatically migrate production databases. `.env.example` describes the relevant settings.

## Quality and regression checks

```sh
npm run check
npm test
npm run test:integration
npm run build:vercel
npm run test:e2e:production
```

The integration and production-browser suites require an isolated local PostgreSQL 17 service. [Production browser verification](scripts/e2e/README.md) gives the exact setup commands, safety restrictions, and evidence locations.

The browser runner tests the generated Vercel API and compiled frontend with the deployment's Content Security Policy. It creates and removes only its own synthetic database. The suite checks donor/partner updates, item entry, inventory integrity, request lifecycle, permissions, exports, and desktop/mobile layout. A passing suite covers the tested scenarios, not every possible production condition.

`.github/workflows/frc-audit.yml` runs these checks on pull requests and main-branch pushes and retains test evidence for 14 days. Dependency advisories are collected separately for runtime packages and all packages so tooling findings are not confused with deployed runtime exposure.

## Deployment and operational care

`npm run build:vercel` executes the build command in `vercel.json`, creating both the frontend and API outputs. `npm run build` by itself builds only the frontend. For a separately managed Node/VM deployment, `npm run build:vm` generates the server bundle used by `npm start`.

Keep production secrets in the hosting environment, never in Git or exported test artifacts. At minimum the application needs its PostgreSQL connection and session-signing secret. Keep secure cookies enabled for HTTPS. Configure and test the existing distributed rate limiter for serverless deployments; the in-memory fallback is per instance, not a global rate limit.

Review preview deployments and passing quality checks before merging to the configured production branch. A successful build is not proof that live credentials, database connectivity, physical scanners, or printers work. Use read-only health checks first, then an authorized acceptance workflow that does not contaminate operational data.

This audit adds no paid runtime service, but hosting, database, external lookup, and CI usage depend on the actual plans and workload. Monitor those dashboards rather than assuming zero recurring cost. Keep provider-managed PostgreSQL backups and verify restoration into a separate environment. The older SQLite backup scripts and historical research papers do not establish a backup strategy for the current PostgreSQL service.

The deployment can be rolled back to a previously verified Git commit or Vercel deployment. Application rollback does not undo database writes. The October 8 workflow fixes do not introduce a production schema migration or rewrite historical records.

## Repository map

```text
client/src/pages/       Operational screens and student-facing pages
client/src/lib/         Query state, save/retry behavior, exports, scanners
server/app.ts          Shared Express application and API middleware
server/auth.ts         Session handling and role-based API access
server/routes.ts       Operational API routes
server/pg.ts           PostgreSQL connection pool
server/pg-storage.ts   PostgreSQL storage adapter
server/request-service.ts  Atomic request and fulfillment workflows
shared/schema.ts       Database schema and request validation
shared/reporting.ts    Shared report dates, aggregates, and CSV output
migrations/            Checked-in PostgreSQL migrations
scripts/local-stack/   Isolated synthetic development stack
scripts/e2e/           Compiled production-browser test host and runner
tests/                 Unit, PostgreSQL integration, and browser regressions
docs/                  Audit findings and historical deployment notes
```

## Audit scope and known limitations

Read [FRC-AUDIT-2026-10-08.md](docs/FRC-AUDIT-2026-10-08.md) for findings, changes, verification scope, and remaining operational checks. Full-history API pagination, legacy donor-ID reconciliation, actual production usage measurements, and backup restoration need separate verification. Older deployment documents and research papers describe prior versions; use current source and these instructions for the running application.

## License and research

[MIT](LICENSE). Copyright 2026 Patrick Valery.

[Engineering white paper](RESEARCH_PAPER.md) and [companion case study](https://github.com/PadiusD1/morgan-frc-research-paper) preserve the project's research history; historical architecture and seeded example totals are not current production metrics.
