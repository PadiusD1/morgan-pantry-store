# Measurement review state and release regression

Candidate 8b02b24 passed typecheck, 527 unit tests and 75 native PostgreSQL tests, but CI 38683189879 failed one of 51 production-browser tests. Measurements saved correctly; a React Effect tied to a query row's updatedAt erased the success notice during the asynchronous refetch. The candidate was not merged.

The correction makes selection an explicit event and holds the reviewed row/version as a draft snapshot. Query refreshes no longer erase typed entries or feedback or silently advance the version used by the optimistic database guard. Staff explicitly review a concurrent updated row before replacing their draft. Successful saves refresh the review queue and leave a persistent confirmation. Changing selected item resets its photo editor state via its item key.

The original browser assertion is retained and additionally checks a completed refresh. Another browser regression changes the row through a second request, refreshes, checks preserved draft fields, verifies HTTP 409 for the stale version and confirms the concurrent database value stays unchanged.

Guidance applied: React's You Might Not Need an Effect, https://react.dev/learn/you-might-not-need-an-effect (read October 15, 2026). Event outcomes belong in event handlers rather than query-dependent effects. This test repair does not activate external services or alter production records.
