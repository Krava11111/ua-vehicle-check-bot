# Cloudflare Worker + GitHub Releases

This directory contains the zero-VPS deployment of the Telegram vehicle bot. The Worker
accepts Telegram webhooks and reads only the required gzip shard from a GitHub Release ZIP
using HTTP Range. The full MVS dataset and even the full ZIP are never stored on the Worker.

Cloudflare D1 stores optional VIN-linked marketplace/auction history, immutable listing
snapshots, original and normalized mileage values, source photo URLs and provider usage.
The official MVS and wanted indexes remain in GitHub Releases; D1 does not duplicate them.

## Data flow

1. `.github/workflows/update-vehicle-index.yml` checks registration and National Police
   wanted-vehicle CKAN metadata every six hours.
2. When the registration resource changes, `tools/build_release_index.py` downloads it on the
   temporary GitHub runner and creates 4096 small gzip shards. The much smaller wanted index is
   rebuilt independently, so a daily police update does not rebuild the multi-year history.
3. Both indexes are packed into 16 uncompressed-container ZIP files and published to immutable
   releases. The stable `vehicle-data-current` manifest is updated only after all assets exist.
4. The Worker hashes the plate or VIN, range-reads the ZIP directory and only the matching
   plate, plate-history, or vehicle members, then decompresses those small members in memory.
   Plate history has its own compact shard, so it is not limited by the 50 recent events kept
   in a normal vehicle report.

Index schema 5 identifies a vehicle by VIN first, then by a stable source identifier, and only
then by a conservative characteristics fingerprint. A reused plate can therefore return several
separate candidates; the user selects one before Starcar builds a report. Events belonging to
different VINs or incompatible no-VIN clusters are never presented as one vehicle history.

The official registration source is approximately monthly. The National Police wanted-vehicle
source is published separately and normally changes daily. The report identifies its checked
version and says only that a match was or was not found in that open dataset.

## Cloudflare deployment

Requirements: Node.js 20+, a Cloudflare account, and a GitHub repository containing this
project.

1. Make the repository public so standard GitHub-hosted Actions runners are free.
2. Push the project and run **Actions → Update vehicle release index → Run workflow**.
3. Wait until the `vehicle-data-current` release appears.
4. Edit `wrangler.toml` and replace `OWNER/REPOSITORY` in `INDEX_MANIFEST_URL`.
5. Install and authenticate Wrangler:

   ```powershell
   cd worker
   npm install
   npx wrangler login
   ```

6. Add secrets. Generate the two webhook secrets independently, for example with
   `python -c "import secrets; print(secrets.token_urlsafe(32))"`:

   ```powershell
   npx wrangler secret put BOT_TOKEN
   npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
   npx wrangler secret put WEBHOOK_SECRET_PATH
   npx wrangler secret put HISTORY_IMPORT_SECRET
   npx wrangler secret put AUTO_RIA_API_KEY
   npx wrangler secret put AUCTION_API_KEY
   ```

7. Create D1 once and apply migrations. Keep the generated database ID in `wrangler.toml`:

   ```powershell
   npx wrangler d1 create ua-vehicle-history
   npx wrangler d1 migrations apply ua-vehicle-history --remote
   ```

8. Deploy and copy the resulting `https://...workers.dev` URL:

   ```powershell
   npm run deploy
   ```

9. Register the webhook. The deployed Worker can safely register both Telegram message and
   callback updates without revealing `BOT_TOKEN`. Send the import secret only in the header:

   ```powershell
   Invoke-RestMethod -Method Post \
     -Uri "https://ua-vehicle-check-bot.YOUR-SUBDOMAIN.workers.dev/admin/register-webhook" \
     -Headers @{ Authorization = "Bearer YOUR_HISTORY_IMPORT_SECRET" }
   ```

   The equivalent direct Telegram call is:

   ```powershell
   $botToken = 'TOKEN_FROM_BOTFATHER'
   $workerUrl = 'https://ua-vehicle-check-bot.YOUR-SUBDOMAIN.workers.dev'
   $secretPath = 'YOUR_WEBHOOK_SECRET_PATH'
   $telegramSecret = 'YOUR_TELEGRAM_WEBHOOK_SECRET'
   Invoke-RestMethod -Method Post \
     -Uri "https://api.telegram.org/bot$botToken/setWebhook" \
     -ContentType 'application/json' \
     -Body (@{
       url = "$workerUrl/$secretPath"
       secret_token = $telegramSecret
       allowed_updates = @('message', 'callback_query')
       drop_pending_updates = $true
     } | ConvertTo-Json)
   ```

10. Verify `https://...workers.dev/health` and send `/start` to the bot.

## External vehicle-history providers

For a VIN search, the Worker can refresh two documented API providers and persist normalized
results in D1:

- `AUTO_RIA_API_KEY` enables current AUTO.RIA advertisements. Every returned record is accepted
  only when its VIN exactly matches the requested VIN, and the report links back to AUTO.RIA.
- `AUCTION_API_KEY` enables Apibara's documented vehicle-auction endpoint for Copart/IAAI
  history. Set `AUCTION_API_BASE_URL` only when the provider gives a different API base URL.
- BidFax is offered as an external manual-check button with a copy-VIN button. Starcar does not
  scrape BidFax or claim that its public website provides an API.

External API errors never suppress the MVS/wanted report. A provider is shown as not configured,
temporarily unavailable, connected with no match, or connected with evidence. Provider refreshes
are cached for six hours by default; changing the configured secret automatically uses a new cache
variant.

## Legal external-history import

The Worker does not scrape AUTO.RIA, Copart or IAAI and does not invent undocumented endpoints.
When a provider supplies data through a documented contract that permits this use, normalize
the provider response into the import contract and send it to the protected endpoint:

```http
POST /admin/history/import
Authorization: Bearer HISTORY_IMPORT_SECRET
Content-Type: application/json
```

Example shape (values must come from the real source; do not fabricate production records):

```json
{
  "marketplace": [{
    "provider": "PROVIDER_NAME",
    "externalId": "SOURCE_LISTING_ID",
    "vin": "17_CHARACTER_VIN",
    "observedAt": "2026-08-20T12:00:00Z",
    "price": 0,
    "currency": "USD",
    "mileage": 0,
    "mileageUnit": "km",
    "isActive": true
  }],
  "auctions": [{
    "provider": "LEGAL_API_NAME",
    "externalId": "SOURCE_LOT_ID",
    "vin": "17_CHARACTER_VIN",
    "auctionDate": "2026-08-20T12:00:00Z",
    "photoUrls": []
  }]
}
```

Imports are idempotent by `provider + externalId`. A marketplace snapshot is created only when
price, mileage, description hash or active state changes. Miles are stored unchanged and also
normalized with `1 mile = 1.609344 km`. The service does not store seller names, phone numbers
or other personal data, and photo files remain at the source; D1 stores only permitted URLs.

The full-report button retrieves MVS/wanted data as before, then adds D1 auction events,
damage labels exactly as supplied, listing/price history, odometer warnings, repeated sale
periods, cross-source mismatches, timeline and the explicitly non-official history score.
Missing external records are described only as missing from connected sources.

## Local checks

```powershell
cd worker
npm install
npm run check
npm test
```

Build a small local index from the test fixture:

```powershell
python ..\tools\build_release_index.py build \
  --input ..\tests\fixtures\vehicles.csv \
  --repository owner/repository \
  --output ..\release-index
```

Build the wanted-vehicle fixture:

```powershell
python ..\tools\build_release_index.py build-wanted \
  --metadata wanted-source.json \
  --repository owner/repository \
  --output ..\wanted-index
```

## Operational notes

- The in-memory rate limiter is best-effort because Worker isolates do not share memory.
  Telegram's secret header and the unguessable webhook path protect the endpoint itself.
- GitHub Releases are suitable for a hobby/open-data service but do not provide a database SLA.
- The repository must remain public for free GitHub-hosted Actions. GitHub can disable scheduled
  workflows after long repository inactivity; re-enable the workflow in the Actions tab if needed.
- A build intentionally fails if one archive approaches GitHub's 2 GB asset limit or one shard
  exceeds the Worker's 12 MB safety limit. In that case increase `--prefix-length` and publish a
  new manifest schema/layout.
- The worker shows source attribution required by the dataset licence.
- The basic report is one compact Telegram card with up to three important registration events,
  insurance availability and the wanted-register result. Deep VIN, ownership, plate/region,
  import and characteristics analysis lives in the navigable full report. Section buttons edit
  the current message, and **all at once** is capped at three logical messages.
- `VehicleReportAggregator` collects source results once, `VehicleReportData` is the normalized
  report model, and `ReportRenderer` owns Telegram presentation. Report navigation reuses a
  24-hour Cloudflare Cache API entry instead of repeating external checks or range reads.
- Wanted matches and characteristic/resale indicators are explicitly marked as open-data matches
  or Starcar analytics, never as a legal conclusion. A wanted-index failure is displayed as
  unavailable, not converted to "no matches". No-VIN characteristic differences are labelled
  uncertain and are not asserted as modifications of one vehicle.
- The main menu and every report expose plate history. It lists all conservatively identified
  vehicle assignments for that plate in the available open-data period, warns that plates can
  be reused, and never describes the first known event as a proven first registration. Worker
  isolates cache an already-read plate result for 24 hours; no Redis or paid Cloudflare database
  is required.
- D1 is an optional enrichment store. If it is unavailable, the main MVS/wanted report still
  works and the Worker reports enrichment storage as unavailable rather than returning a false
  negative.
- The report does not claim a vehicle-specific ДТП result. Published police crash statistics do
  not provide a reliable public VIN/plate-to-crash mapping.
- Every vehicle report offers buttons to copy its current plate/VIN and opens the official
  MTSBU policy-check service. MTSBU does not prefill the form from documented URL parameters,
  protects the interactive search with Turnstile and does not publish a server API for this
  flow, so the Worker does not scrape or bypass it and never treats a technical failure as
  "no policy".
- Do not commit the Telegram token or webhook secrets.
