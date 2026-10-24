# FRC post-release review follow-up

This follow-up preserves the independently merged PR #7 (759aff5) and its a8a2ee5 draft-snapshot repair. An expected-head guard prevented an overlapping alternative UI patch; it was not force-applied. PR #8 remains an unmerged alternative and must not be merged into these duplicate catalogue paths.

## Final corrections

- All items remain in the staff-only review API, including complete items requiring a later photo or measurement correction.
- Reviewed pounds and canonical unit grams are updated together. Money and pounds require supported database precision. Both measurement and photo updates advance the browser-visible millisecond version monotonically; stale measurement edits still return 409.
- A product photo links its safe same-origin source/credit page. Provider images identify the contributing project, original source, CC BY-SA 3.0 and no endorsement. Staff uploads receive no invented open license. Private metadata is excluded, and credits incur no per-card automatic request.
- Donor/partner directory CSVs carry generation timestamps in Baltimore and UTC separately from the selected transaction dates.
- Fulfillment passes its committed request to the existing optional durable email helper, just like the other request-state updates. External delivery begins only after the stock and notification commit and the database client is released. Failed provider attempts cannot undo pickup; unlinked kiosk identities cannot become email destinations.

## Verification required

Added attribution and directory-generation unit tests and PostgreSQL tests for complete-item correction, synchronized measurements/versioning, precision refusal, private-safe credits, post-commit email acceptance, uncertain provider results and exclusion of unlinked kiosk identities. Tests use isolated synthetic data and intercepted provider calls, not live customers or credentials.

Run the complete existing quality workflow before merge and record its exact candidate/run/results. Inspect the final browser evidence and verify the merged deployment's Vercel status and read-only production health separately. The temporary patch workflow is removed from this final tree.

No production catalogue values/photos were populated by this code commit. No historical entries, schema migrations or provider settings were applied. Optional email still needs the explicit 0002 migration and verified FRC account configuration. Optional analytics and Turnstile remain subject to actual provider setup and evidence. Core application tests do not prove that the user's entire security/operations checklist has passed.

The photographed historical material has been transcribed into a private, review-only artifact outside GitHub. Unknown quantities, mixed aliases, disposal classification, October dates and possible duplicate stock remain explicit reconciliation requirements rather than invented board totals.
