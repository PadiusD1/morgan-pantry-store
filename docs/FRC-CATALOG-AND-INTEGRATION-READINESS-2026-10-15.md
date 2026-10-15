# FRC catalog, photos and independent directories

## Scope and facts

Continuation of owner-authorized FRC fixes. The prior registration/selected-board/receipt release is main `602839f862f0b0db25cfbc844633784f5deeaa73` (PR #6). This change introduces no schema migration, no automatic data backfill, no new dependency and no purchased service.

- Staff/admin can review missing positive unit weights, estimated values and allowlisted photo links in Inventory. The review searches current records and exports all gaps; the interactive list displays at most 50 matches and explains that limit.
- A completion save requires a source/date description and the item's previously read update timestamp. The server locks that row and rejects a stale change; staff refresh and compare before retrying. Only unit metadata changes, not quantity, reservations, identity or historical receipt lines. Earlier receipts are not repriced. Amounts must be positive and USD estimates have cent precision. UI-entered values/weights are marked estimated.
- Current field provenance (source, operator, time) is retained in `rawPayload.frcCatalog` alongside upstream payload. This is current-field provenance, NOT a full immutable audit history. Keep private source notes out of public projections.
- Public item cards use the explicit saved photo or an existing Open Food Facts product-image reference. Arbitrary origins, tracking query parameters, script/data URLs and SVGs are refused for catalog photos. The CSP allows only the existing sources plus `images.openfoodfacts.org` for images. No scripts or API origins were loosened.
- Photos load lazily, use no-referrer, have item alt text, and preserve a visible fallback when missing/broken. Full item names and package-label reminders remain visible. Photo-link completeness is not proof of network availability or of the exact package in stock. No generated or guessed product photo is substituted. Contributor/source and CC BY-SA 3.0 attribution are shown for Open Food Facts images.
- Donors and Partners each have an independent **Export all** directory CSV, including zero-activity registrations. This is a registry export, NOT a donor valuation or tax report. It excludes contact fields, free-text notes and student client rows. It deliberately ignores a currently applied list search; the button says **all**. Existing donor/partner detail histories remain the activity-reporting route.

## Standards applied and research evidence

Read `AGENTS.md`, `docs/SBD-DESIGN-SYSTEM.md`, `docs/FRC-AUDIT-2026-10-08.md`, and `docs/RESEARCH-QUALITY-REVIEW.md`. Retain the existing version-pinned React/TanStack Query, transaction-snapshot, canonical-source and CSV-encoding patterns. Use associated form labels, named control groups, disabled save fields and visible recoverable failures; verify at 390 CSS pixels. These checks do not certify universal accessibility compliance.

Owner-provided `Enterprise_App_Engineering_Standards.docx` and the Foundations handbook were reviewed through the authorized Library. Their stack is a baseline checklist, not permission to replace this working Express/PostgreSQL authentication architecture with unrelated services. Applied controls: server-side role checks, narrow payload schemas, evidence-based updates, least-privilege public projection, safe output encoding, regression gates, and separate deployment verification.

Primary documents checked 2026-10-15:
- Open Food Facts API and license guidance: https://openfoodfacts.github.io/openfoodfacts-server/api/ and https://openfoodfacts.github.io/openfoodfacts-server/api/tutorials/license-be-on-the-legal-side/ . Product images use Attribution ShareAlike; contributor data is not guaranteed accurate. Test: reject non-allowlisted URLs; display source/license and a fallback; never send raw provider/staff metadata to the public catalog.
- Cloudflare Turnstile: https://developers.cloudflare.com/turnstile/get-started/ . A widget alone does not protect submissions; a server verification step is required. Do not claim a configured DNS proxy implies verified Turnstile enforcement.
- PostHog API: https://posthog.com/docs/api . Project capture credentials and personal management credentials have different purposes. Never place a personal management key or student identities in the browser.
- Resend idempotency: https://resend.com/changelog/idempotency-keys . Provider acceptance and actual delivery are different evidence; safe email activation needs a verified sender and retry/deduplication design.

## Remaining provider and data prerequisites

These are explicitly NOT completed by deploying this change:

| Work | Current evidence | Required next verification |
|---|---|---|
| Historical notebook import | Owner supplied photos; no production replay performed | Transcribe with source/row evidence, resolve ambiguous cases/ounces/counts, distinguish disposals, match canonical IDs, inspect existing transactions and reconcile stock before a deduplicated import. October 2 stays outside June–September. |
| Fill every live weight/value | Safe staff completion path implemented; no authenticated live inventory audit | Read all production item rows, use exact package measurements and dated documented estimates, preserve unknowns, then verify gap counts and report snapshots. Do not invent per-case/retail prices. |
| Every student item has a photo | Rendering and provenance path implemented; existing allowed provider references reused | Verify actual stored references and package match; supply licensed exact product photos for gaps; check real image loads. |
| PostHog | No live project connection or capture receipts obtained; not wired in this release | FRC-specific project/region, minimal nonidentifying event schema and consent/retention review; autocapture/replay off for sensitive staff/student forms; verify an actual synthetic event reaches the correct project. |
| Resend | No FRC sender/domain or delivery evidence; not wired in this release | Verified sender/domain, server-only restricted key, durable retry/deduplication and provider response handling; send a synthetic test only to an authorized test recipient; verify accepted vs delivered. |
| Cloudflare/Turnstile | No FRC zone/widget live access evidence; no DNS change performed | Validate authorized zone/hostnames and existing DNS; review SSL/proxy compatibility; test valid/invalid/expired/replayed tokens server-side before enforcement. Do not use production student requests as bot tests. |
| Distributed abuse limits | Existing Upstash path in auth; fallback is per instance | Confirm actual production configuration and limits without exposing tokens; test denied paths and outage behavior. |
| Recovery/security checklist | Prior application regression checks plus new scoped route/image safeguards | Validate provider backup retention and a scoped restore; review real deployment secrets/session/CORS/logging/PII controls, alert destinations and rollback. Passing tests is not proof every checklist entry is configured. |

The Office Bridge acknowledged a scoped local access-audit request but supplied no completed live audit; its routing paused on unavailable model/spend capacity. No unrelated Office self-modification or paid research was authorized. GitHub/Vercel integration can deploy code without providing database or third-party-service credentials. Do not treat a deployed UI as evidence the production records or provider settings changed.

## Verification and rollback

Local `npm run check`, `npm test` (502 tests in 75 files), and `npm run build:vercel` passed. Added native PostgreSQL tests for catalog-only row updates, concurrent version rejection, unauthorized/unsafe inputs, and private-data-free independent directories. Added browser regressions for conflict/refresh/save persistence, product-photo/fallback display, and all-directory downloads. Synthetic test fixtures only; the public image response is stubbed with synthetic pixels in CI.

The existing full FRC CI workflow remains the merge gate, including production CSP and service worker. Record actual final integration/browser results and inspect rendered screenshots on the PR before merge. Then verify the exact merge SHA's Vercel deployment status and read-only production health. Rollback for this code-only change is to the preceding main commit; do not reverse legitimate staff-entered data when rolling back UI code.
