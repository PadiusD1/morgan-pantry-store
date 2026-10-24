# FRC completeness and integration release

## Preserved baseline

Based on merged release `602839f862f0b0db25cfbc844633784f5deeaa73`. Preserve its donor visibility, partner registration, canonical source caches, selected board model, saved receipt snapshots and browser regressions. No registration, board or receipt implementation is replaced by this additive pass.

## Changes

- Independent donor and partner directory CSVs retain new records with zero activity, apply selected movement dates, separate partner receiving/distribution and flag unmeasured units. Donor attribution uses the complete directory even when exporting a searched subset. Contacts and student identities are excluded; names in the selected directory are intentionally included.
- A donor review panel surfaces unregistered name-only receiving records for explicit staff review. Registering a reviewed name publishes the canonical donor cache without replaying stock or rewriting old attribution IDs. It does not prove an unsaved earlier entry was recovered.
- Staff can review missing item weight, estimated unit value and product photos. Suggestions use unambiguous net-mass labels or an existing saved unit cost only. Multipacks, servings and fluid volumes are not automatically converted to mass. Each measurement correction requires a source, estimate flag and current item version. The database row lock and version check protect concurrent edits; quantity, reservations and historical transaction snapshots stay unchanged.
- Student item cards use actual saved/provider product photos via an allowlisted same-origin image route. Staff uploads are resized to JPEG in the browser; the server accepts only bounded raster signatures and never SVG/HTML or arbitrary remote hosts. Missing/broken photos are clearly labelled. Uploaded image bytes are excluded from inventory-list responses. This adds a capability, not verified photos for every live item.
- Optional Cloudflare Turnstile on login/signup verifies success, hostname and action server-side and fails closed on partial configuration. Its narrow script/frame CSP allowlist is added; general CSP is not relaxed. Turnstile is not DNS or WAF configuration.
- Optional PostHog captures anonymous server-side request events only. No identifiers, form contents, student records, IP addresses, browsing URLs, replay or user profiles are deliberately sent. It must be explicitly enabled in this FRC project.
- Optional Resend emails only account-linked requests to the account email, with generic notification text and a portal link. A durable notification-key ledger prevents concurrent sends, reuses payloads/keys on uncertain retries, and holds old uncertain attempts before the provider's 24-hour key expiration. Provider acceptance is not inbox delivery.
- Admin integration status reports configuration, queue states, required migration and explicit limits. Manual tests send only anonymous events or email to the signed-in administrator. Failed providers do not turn an already-saved food request into a failed save.

## Enable external services only after account-side verification

Store FRC-specific credentials in the established Vercel project, never in Git, chat messages, screenshots, analytics or test artifacts. The default flags in `.env.example` are disabled. Do not use another application's identity or silently purchase a plan.

1. Resend: verify the sender domain/account, set `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `FRC_PUBLIC_URL=https://morgan-frc.vercel.app`, and `FRC_EMAIL_ENABLED=true`. First review and apply the additive `migrations/0002_email_delivery.sql` using authorized database access. No runtime or application startup automatically applies it. Verify RLS/role grants, retention, backups and a staging restore. Use the admin test and reconcile provider acceptance with inbox delivery. There is no new automatic cron retry; the first attempt is made within the request and bounded admin retries are provided.
2. PostHog: verify the FRC project and its region; set `POSTHOG_PROJECT_TOKEN`, `POSTHOG_HOST` to exactly the US/EU ingestion host, and `FRC_ANALYTICS_ENABLED=true`. Verify the synthetic event in that project and confirm billing/retention and privacy disclosure before normal use.
3. Turnstile: create the correct site widget; set `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` and `TURNSTILE_ALLOWED_HOSTNAMES` together. Test a successful login, rejected tokens, expiry, wrong action/hostname and recovery. Partial configuration intentionally blocks authentication. Verify Cloudflare DNS, TLS and WAF separately; a `vercel.app` hostname is not proof of a user-managed Cloudflare zone.
4. Verify existing distributed rate-limit credentials and database certificate authority settings separately. Do not flip certificate verification without testing the provider CA. The status screen reports configuration, not confirmed enforcement.

## Historical data boundaries

Photographed notes are source evidence, not an authorized duplicate-free ledger by themselves. Keep original images and row-level transcriptions private. Resolve exact dates, direction (IN, student/partner OUT, waste), units per case, source identity, canonical inventory IDs and earlier imports. October records must remain October; damaged/expired notes must not become student visits. Do not replay old IN movements into current stock, silently update all historical unit prices from today's price, restore JSON snapshots into production, or invent zero-valued measurements to claim completeness. Unknowns remain flagged until supported.

## Quality and source receipt

Applied project guidance: `AGENTS.md`, `docs/SBD-DESIGN-SYSTEM.md`, `docs/RESEARCH-QUALITY-REVIEW.md`. Owner's Enterprise App Engineering Standards and Handbook Volume I were retrieved from the authorized Library: use server authority, minimal access, input validation, privacy, auditable corrections, explicit deployment/rollback checks. This is a scoped application of those standards, not a claim that their full checklist passed.

Official documentation reviewed October 15, 2026:
- Cloudflare server-side Turnstile validation: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/ (single-use/expiry, hostname/action checks).
- Cloudflare Turnstile CSP: https://developers.cloudflare.com/turnstile/reference/content-security-policy/ (narrow challenge host policy).
- Resend idempotency: https://resend.com/docs/dashboard/emails/idempotency-keys (same payload/key, 24-hour limit, older uncertainty held).
- PostHog API and personless capture: https://posthog.com/docs/api and https://posthog.com/docs/data/anonymous-vs-identified-events (explicit anonymous event fields, no session replay).

Reproduction and tests: original baseline 472 unit tests; three targeted missing-capability checks failed before edits. The latest registration/receipt branch was independently merged while this work was underway, so it was retrieved and preserved rather than overwritten. Local reconciled typecheck and 527 unit tests passed. Run the full existing PostgreSQL 17 and production browser gates before release; record their actual result on the PR. CI uses only isolated synthetic data and refuses live provider credentials. A local build, configuration flag, generated screenshot or mocked provider does not verify live account activation, migration application, physical printers, real-user performance, complete accessibility, or production data backfill.

Rollback: revert this application's release/deployment after read-only health checks. The optional email ledger is additive and can remain during application rollback; do not delete delivery history or replay old sends. Application rollback does not undo reviewed database corrections. Core item/directory/photo capabilities require no new migration; automated email does require 0002.
