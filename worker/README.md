# Cloudflare Worker + GitHub Releases

This directory contains the zero-VPS deployment of the Telegram vehicle bot. The Worker
accepts Telegram webhooks and reads only the required gzip shard from a GitHub Release ZIP
using HTTP Range. The full MVS dataset and even the full ZIP are never stored on the Worker.

## Data flow

1. `.github/workflows/update-vehicle-index.yml` checks registration and National Police
   wanted-vehicle CKAN metadata every six hours.
2. When the registration resource changes, `tools/build_release_index.py` downloads it on the
   temporary GitHub runner and creates 4096 small gzip shards. The much smaller wanted index is
   rebuilt independently, so a daily police update does not rebuild the multi-year history.
3. Both indexes are packed into 16 uncompressed-container ZIP files and published to immutable
   releases. The stable `vehicle-data-current` manifest is updated only after all assets exist.
4. The Worker hashes the plate or VIN, range-reads the ZIP directory and only the matching
   plate/vehicle members, then decompresses those small members in memory.

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
   ```

7. Deploy and copy the resulting `https://...workers.dev` URL:

   ```powershell
   npm run deploy
   ```

8. Register the webhook. Replace the placeholders with the same secret values used above:

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
       allowed_updates = @('message')
       drop_pending_updates = $true
     } | ConvertTo-Json)
   ```

9. Verify `https://...workers.dev/health` and send `/start` to the bot.

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
- Every report contains a separate wanted-registry result, VIN/WMI analysis, import indicators,
  estimated ownership changes, plate/region history, historical characteristic changes and
  rapid-resale heuristics. These are explicitly marked as open-data matches or the service's own
  analytics, never as a legal conclusion. A wanted-index failure is displayed as unavailable,
  not converted to "no matches".
- The report does not claim a vehicle-specific ДТП result. Published police crash statistics do
  not provide a reliable public VIN/plate-to-crash mapping.
- Every vehicle report offers buttons to copy its current plate/VIN and opens the official
  MTSBU policy-check service. MTSBU does not prefill the form from documented URL parameters,
  protects the interactive search with Turnstile and does not publish a server API for this
  flow, so the Worker does not scrape or bypass it and never treats a technical failure as
  "no policy".
- Do not commit the Telegram token or webhook secrets.
