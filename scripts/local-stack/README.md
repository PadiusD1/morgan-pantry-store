# Local stack

A local copy of the portal on synthetic data, for rendered checks in a browser. It can never reach production.

## Start and stop

```
env -i PATH=/usr/local/bin:/usr/bin:/bin HOME="$HOME" scripts/local-stack/start.sh
env -i PATH=/usr/local/bin:/usr/bin:/bin HOME="$HOME" scripts/local-stack/stop.sh
```

The `env -i` wrapper is there because the start script refuses to run when any variable starting with UPSTASH is set in the calling shell.

Start prints the address, http://127.0.0.1:5055 unless PORT is set, and a fresh admin and volunteer password. They are shown once and change on every start.

Stop kills only the process group the start script created and stops the local cluster. The data stays. To begin again from a clean seed, stop the stack and delete /srv/tools/frc-stack/pgdata.

## What start does

* Creates on first run a PostgreSQL 17 cluster at /srv/tools/frc-stack/pgdata, user frc, trust auth, listening on localhost port 55418 only, socket in /srv/tools/frc-stack/sock.
* Creates the frc_stack database and applies migrations/0000_salty_flatman.sql, the production only indexes and migration 0001. The index list is tests/fixtures/prod-only-indexes.json when the tree has it, otherwise the office schema file. Migration 0001 comes from the tree, otherwise from the frc-r1-server branch.
* Seeds synthetic data once. Four students, two partner organizations, three donors, twelve items with barcodes starting 20000002 and some reorder thresholds, and two check ins, one from a donor and one from a partner.
* Starts the dev server under `env -i` with an allowlist only, from /srv/tools/frc-stack/run, which holds no .env file, so dotenv loads nothing. The allowlist is PATH, HOME, NODE_ENV, PORT, HOST, TZ, DATABASE_URL, SESSION_SECRET, COOKIE_SECURE, ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME, FRC_BARCODE_STUB and VITE_CACHE_DIR. The server listens on 127.0.0.1 and runs in UTC as Vercel does.
* Sets FRC_BARCODE_STUB, so a barcode lookup answers from barcode-fixture.json in this folder and never calls an outside provider. Codes 2000000100017, 2000000100024 and 2000000100031 are found, any other unknown code answers not found.

## Before driving it with a browser

* The Inventory New item dialog looks a barcode up in the browser itself, straight at Open Food Facts, when the barcode field loses focus. The server stub cannot catch that call. Block that host in the browser, or leave the barcode field empty in that dialog.
* Keep the browser in Eastern time and the server in UTC, so month and day boundaries show what production does.
