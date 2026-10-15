# Portal account scope

The portal now uses the persisted request.userId association for requests, cancellation, notifications and read mutations. A typed roster identifier is not proof of ownership. Notification authorization is included in each database write.

Existing account-linked requests continue to work. Legacy requests with no account association remain available to authorized staff but are not automatically exposed to a newly registered account that supplies the same student identifier. Linking those records requires a separate verified staff process; this release does not relink, delete or rewrite historical data.

Regression coverage includes two accounts with the same typed student identifier, accountless legacy requests, unread counts and denied cross-account read/cancel mutations. The existing student cancellation concurrency fixture is explicitly account-linked so its reservation race remains tested.

This is scoped authorization hardening, not proof of complete application security, email-domain verification, database certificate verification, provider activation or live configuration review.
