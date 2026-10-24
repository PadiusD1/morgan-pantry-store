# FRC events, event attribution and board analytics

## Baseline

Builds on PR 9, the first slice made on October 15 from `602839f862f0b0db25cfbc844633784f5deeaa73`, merged with main at `b32b344` so it keeps every later fix, PR 11 and PR 12 included. The checkout, receipts, registration, donor directory and selected board summary keep their behaviour. Only new fields and screens are added.

## What staff see

* **Events page** (Operate, Events). Staff and admins create an event with a name, a start, an optional end and an optional description. Each event has a stable UUID. Staff can edit, end and reopen an event. An admin can delete an event only while nothing names it. Ending keeps every attributed record and stops new visits counting toward it. Each event has a history of who created, changed, ended, reopened, deleted or selected it.
* **Active event bar** on Check-Out and Check-In. A staff member or volunteer chooses the event once. It stays selected through every checkout, a reload, other pages and other tabs of the same sign in, until they switch it, clear it or someone ends the event. Switching keeps the cart. Signing out forgets it, and no other user, later session or student ever sees it. On Check-In a donation counts toward the event only when the staff member ticks that box.
* **Receipts** show the event the server saved on that checkout.
* **Reports, Events and contributors.** Choose all activity or chosen events, with or without activity that has no event. Choose the sections (distributions by event, donations received by event, unique clients served, top donors and partners, event comparison and trend) and the measures (units, pounds, estimated value), the ranking measure and how many contributors to list. The screen, the CSV and the Systems by Design print document are built from one model and one selection.

## Rules the figures follow

* A transaction belongs to the event saved on it. A row saved without an event, every row from before this release included, stays "Not assigned to an event". No date window or name moves it.
* Each transaction is counted once. Totals add event lines, and every transaction is in exactly one line. Unique clients are distinct linked client records counted again for the whole selection, never a sum of per event counts. Visits without a linked client are listed separately.
* Distributions are OUT rows and donations are IN rows. They are never added together.
* Donations are credited through `shared/donation-source.ts`, the authority the donor directory and each individual report use. A typed name shared by several records credits no one, and name only matches are disclosed.
* Only recorded positive weights and values are summed. Units without one are counted as incomplete. A ranking by pounds or value marks contributors whose units lack that measure.
* Students are never named. Students who brought food in appear as one combined line. No student name, identifier or contact detail is in the screen, the CSV or the PDF. Donor, partner and event names do appear and should be reviewed before sharing outside the pantry.

## Server behaviour

* `POST /api/transactions` and `POST /api/requests/:id/fulfill` accept `eventId`. Inside the same database transaction that claims the idempotency key and moves the stock, the server takes a share lock on the event and refuses with 409 when it has ended, does not exist or the event tables are absent. A refusal rolls back everything, frees the key and keeps the cart on screen. An identical retry with the same key replays the saved answer. The same key with a different event answers 422, and the client reads back what was recorded.
* The session selection is stored in `frc_event_sessions`, keyed by a SHA-256 of the session cookie and checked against the user. Each sign in now carries a unique token id, so two sign ins never share a key. Clearing uses `PUT /api/frc-events/session` with a null event, because volunteers may not send deletes.
* Volunteers may list and select events and record attributed visits. Creating, editing, ending and reopening require staff. Deleting requires an admin. Students are refused by the existing guard.
* The code reads whether migration 0003 is present. Until it is, every event route answers that tracking is not set up, the bar is hidden and checkouts are recorded exactly as before.

## Migration 0003, review, backup and rollback

`migrations/0003_frc_events.sql` is hand written like 0001, one transaction with a 5 second lock timeout, and safe to run twice. It creates `frc_events`, `frc_event_sessions` and `frc_event_audit`, adds the nullable `transactions.event_id` with a foreign key added `NOT VALID` and then validated (instant, every value is NULL) with `ON DELETE RESTRICT`, adds a partial index on `(event_id, timestamp)`, enables row level security on the three new tables and revokes their grants from `PUBLIC`, `anon` and `authenticated`. It backfills nothing.

Locks. Adding the nullable column is a brief catalog lock with no rewrite. Validation takes a share update exclusive lock that allows reads and writes. The partial index starts empty. The lock timeout makes the migration fail and roll back rather than queue behind a long transaction, so it can be retried.

Before applying it in production.

1. Take a schema only dump (`pg_dump --schema-only`) into a private folder outside the repository. It holds no records.
2. Record the read only fingerprint from `tests/integration/frc-events-migration.pgtest.ts` (counts and MD5 of every transaction, line and stock count).
3. Apply the migration over one connection. On any error send `ROLLBACK` on that same connection.
4. Record the fingerprint again. It must be identical, which proves no earlier transaction, line or stock count changed.

Rollback. The previous application release ignores the new tables and column, so rolling back the Vercel deployment is enough and keeps attribution history. `migrations/rollback/0003_frc_events_rollback.sql` removes the schema only while no transaction names an event, and refuses otherwise. It is never applied by any script.

Order of release. Apply the migration, verify the fingerprint, then merge so Vercel deploys. The code also works on the old schema, so a deployment that lands first only hides the event controls.

## Verification

* Unit, `tests/event-board.test.ts` and `tests/event-client.test.ts`. Unassigned history, single counting, client deduplication, incomplete measurements, IN and OUT separation, ranking, shared names, student anonymity, scope, Baltimore dates, unknown events, one selection for every output, escaping and formula guards, receipts.
* PostgreSQL 17, `tests/integration/frc-events.pgtest.ts` through the real sign in, cookie, guard and routes, and `tests/integration/frc-events-migration.pgtest.ts`. Behaviour before the migration, idempotent additive migration, database constraints, permissions, retried create, same day twins, session scoping across users and sessions, sign out, ended events, attribution with stock, retries, refusals that free the key, rollback after a failed later write, the share lock against ending, request pickups, rollback script.
* Production bundle in Chromium, `tests/e2e/events.spec.ts`. Create at checkout, several checkouts, reload, navigation, switching with the cart kept, clearing, a lost answer saved once, an event ended mid cart, volunteer and student permissions, separate sessions, board filters, ranking, CSV, the print document rendered to a tagged PDF, the events page with history, and a 390 pixel phone.

Not covered. Real scanners and printers, the live Supabase plan's backup retention, and acceptance by pantry staff.
