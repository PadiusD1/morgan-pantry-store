# FRC review corrections

Preserve the concurrent draft-snapshot repair in a8a2ee5. An expected-head guard prevented an overlapping alternative UI patch from replacing it. Only these independent changes are added:

- Complete items remain in the authorized quality endpoint, so a previously supplied photo/measurement can be corrected later.
- Measurement writes keep pounds and unit grams consistent, require supported decimal precision, and advance the browser-visible millisecond version monotonically. Photo uploads also advance this version. Stock, reservations and historical transaction snapshots are not rewritten.
- Product photos link a same-origin source/credit page. No extra automatic metadata fetch is made for each card. Provider photos credit the source project/contributors, link the source product/original image and CC BY-SA 3.0. Staff uploads do not receive an invented Creative Commons license. No staff IDs, source notes or raw photo payloads appear in credits.
- Added five pure attribution tests and three native PostgreSQL regressions. Full existing CI remains required before merging; no successful result is claimed by this document alone.

Sources reviewed October 15, 2026: Open Food Facts Product Opener license tutorial (https://openfoodfacts.github.io/openfoodfacts-server/api/tutorials/license-be-on-the-legal-side/) and its linked CC BY-SA 3.0 deed (https://creativecommons.org/licenses/by-sa/3.0/). The document identifies image attribution, original source, licensing and no endorsement. The source provider remains responsible for contributor metadata; the FRC does not claim ownership of provider artwork.

No production data import, provider activation, schema migration or new dependency in this follow-up. Historical source transcriptions remain outside the public repository.
