# HeartPing

A romantic web/PWA app for two partners. The existing UI and HTTP API are preserved. The Node server uses the **Supabase JavaScript client and hosted Supabase Postgres** for sessions, pairing and history. No local JSON persistence, Render disk, Docker, WSL, Supabase CLI, Firebase, or Gemini is required.

## Create the hosted Supabase database

1. Create a project in [Supabase](https://supabase.com/dashboard). The Free plan can be used. Choose a region near Render. Save its database password privately; HeartPing does not use that password.
2. Open **SQL Editor → New query**, paste the complete contents of [`supabase/migrations/001_heartping.sql`](supabase/migrations/001_heartping.sql), and run it **once**. The migration is transactional.
3. Keep the **Data API enabled**, with the default `public` schema exposed. Do **not** expose `heartping_private`. The migration creates four tables in that private schema:
   - `users`: SHA-256 session-token hashes, first names, current pair membership.
   - `pairing_codes`: unique six-digit codes and expiry times.
   - `pairs`: active relationships.
   - `events`: ping IDs, name snapshots, timestamps, per-user visibility and retry deduplication.
4. It also creates `public.heartping_api` and private helper functions. RLS is enabled; anonymous/authenticated clients have no table access or RPC execution. Only `service_role` can execute the public RPC. No Supabase Auth user/provider, Storage bucket, Realtime publication or Edge Function is needed. HeartPing's existing bearer sessions remain the application authentication mechanism.
5. From **Connect** or **Settings → API / Data API**, copy the project URL: `https://YOUR_PROJECT_REF.supabase.co`.
6. From **Settings → API Keys → Legacy API Keys**, copy the **service_role** key, not the anon key. This key bypasses RLS: keep it only in server environment variables. Never put it in frontend/Android assets, screenshots, commits, or messages. See [API keys](https://supabase.com/docs/guides/api/api-keys) and [database function permissions](https://supabase.com/docs/guides/database/functions).

Optional SQL checks: run [`tests/database.sql`](tests/database.sql) in SQL Editor after the migration. Its assertions check expiry/renewal, history limits, retry behavior, transactional rollback and permissions. The test transaction rolls back its own records and does not change existing users.

## Configure Render Free

Use [Yam-lab9/heartping](https://github.com/Yam-lab9/heartping), branch **main**. The supplied `render.yaml` describes a **Free Node Web Service** with no disk.

1. In Render choose **New → Blueprint** and connect the repository/main branch, or create a Node Web Service using the settings below.
2. Add these values in the service's **Environment** settings (the Blueprint prompts for them):

   | Variable | Value |
   | --- | --- |
   | `SUPABASE_URL` | Your hosted project origin: `https://YOUR_PROJECT_REF.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | The same project's private `service_role` key |

3. Verify: instance **Free**, Node **24.x**, build `npm ci && npm run build && npm test`, start `npm start`, health check `/healthz`. The Blueprint sets `NODE_ENV=production` and `HOST=0.0.0.0`. Leave `PORT` to Render. Remove any old `DATA_FILE` setting. There is no `/var/data` mount requirement.
4. For an existing paid service, configure Supabase and verify the new deployment first. Changing YAML may not change an existing service's plan: select Free in Render's instance settings. A pre-existing disk must be detached/deleted to use Free; back up any old data you need privately before doing so. This code change does not remove your disk or import its records.
5. Deploy and open the HTTPS URL and `/healthz`. Health returns `{"status":"ok"}` only after a successful database RPC. Missing variables prevent startup; database failures or missing SQL migration produce health 503 and explicit API errors.
6. Pair two independent profiles/devices, send pings both ways, then restart/redeploy Render. Reopen with the **same origin and browser storage**: pairing and history should survive. The hosted deployment test below checks this across Node process restarts too.

Render Free [spins down after 15 minutes without inbound traffic](https://render.com/docs/free), so its first request can be slow. State stays in Supabase across Render restarts/redeploys. Supabase Free projects with low activity [can pause after seven days](https://supabase.com/docs/guides/platform/free-project-pausing); resume them in Supabase. Free hosting does not guarantee always-on availability or replace private backups.

## Existing JSON data

The app no longer reads/writes `DATA_FILE` or `data/heartping.json`. Existing local files remain untouched and ignored by Git. **The migration starts an empty database; it does not import historical JSON users, pairings or pings.** For this first switch, both partners should use fresh browser profiles/site storage and pair again. Preserve the old JSON privately if you need a separately planned historical import. After switching, new state is stored exclusively in hosted Postgres.

## Run locally on Windows

Install Node.js 24.x with npm and apply the SQL to a hosted Supabase project (preferably a separate project for development/tests).

```powershell
npm ci
Copy-Item .env.example .env
# Edit .env locally with your hosted URL and service_role key.
npm run build
npm test
node --env-file=.env server.js
```

Open `http://localhost:3000`. `.env` is ignored; `npm start` does not load it automatically. Use the explicit Node command or set environment variables in your shell. Render injects variables directly and uses `npm start`. No database connection string or other persistence variable is needed.

## Verification

All commands use Node/npm on Windows. `npm test` is safe during Render builds: it checks configuration, the actual SDK's transport contract, failure handling, HTTP access boundaries and frontend/deployment leakage guards without contacting production Supabase. Transport doubles do **not** establish database persistence.

```powershell
npm run build
npm test
npm run test:backend
npm run test:deployment
npm run test:browser
```

The last three commands load ignored `.env` if present or use the process environment. **Without both Supabase variables they explicitly report SKIP.** With credentials they use the real hosted database and fail on errors; there is no fake/file/in-memory persistence fallback. `npm run test:hosted` combines backend and deployment suites.

Use a dedicated hosted test project with the migration applied. Tests create new sessions/pings and leave a few test users and bounded retry records. They do not clear the database. Coverage includes the two-user journey, invalid codes, partner isolation, concurrent duplicate pings, independent history clearing, concurrent joins across Node instances, unpair/code rotation, rate limits, provider PORT/HTTPS Origin handling and restart persistence.

Browser tests require Playwright and a browser as test tooling only:

```powershell
npm install --no-save --package-lock=false playwright
npx playwright install chromium
npm run test:browser
```

Alternatively set `$env:BROWSER_CHANNEL='msedge'` for installed Edge. `PLAYWRIGHT_MODULE` may point to an existing Playwright `index.mjs`. The test covers two mobile-size profiles, both ping directions, safe name rendering, reload/offline recovery, PWA cache isolation, unpair and demo. Screenshots go to ignored `.audit/screenshots/`.

For this migration, build/configuration/transport tests run without credentials. Hosted SQL assertions, backend/deployment persistence and browser journeys remain unverified until your project is configured. Skipped runs are not passes. A real Render redeploy and iPhone installation also need post-setup verification.

## Behavior and storage design

- `server.js` serves only `public/` and the API. `supabase-store.js` uses the server-only Supabase client with Auth persistence/refresh disabled. Frontend requests stay relative `/api/...`; browsers never receive the key or call Supabase directly.
- Each API action runs one Postgres function/transaction. A transaction-scoped advisory lock serializes requests across Node processes, preventing partial/concurrent pairing or ping updates. This favors correctness for a small app over high throughput. Only rate-limit counters are process-local; sessions, relationships and history live in Postgres.
- Database identities are token hashes. Browser storage retains raw bearer tokens. Clearing it loses access; there is no account recovery. The remaining partner can unpair an abandoned relationship.
- Codes expire after 24 hours. Continuing from the name screen renews an expired code for an unpaired user. Unpairing clears both histories and rotates both codes.
- Each user sees at most 100 pings. Clearing history affects only their view. The last 200 sent IDs per sender deduplicate retries across clears, unpairing and restarts. Unreferenced events outside that window are removed transactionally. Abandoned user sessions have no automatic retention cleanup.
- Open, visible apps poll about every two seconds. There is **no closed-app/background push delivery or read receipt**. Permissions enable local alerts only while running.
- The PWA caches only its static shell. Real operations need connectivity. Demo is explicitly local and resets on reload.

## Android wrapper

The package/application ID and frontend remain unchanged. `public/` is the source of truth; the Node build synchronizes `app/src/main/assets/www/`, and Gradle generates APK assets from `public/`. Neither tree contains Supabase credentials.

Default Android builds run the bundled demo. For real cross-device use, target the hosted origin:

```powershell
.\gradlew.bat :app:assembleDebug -PheartpingUrl=https://your-heartping-host.onrender.com/
```

Android builds require Android Studio, JDK 17+, and SDK 36.1. WebViewAssetLoader, disabled file/content/mixed-content access, lifecycle handling and the bounded vibration bridge are unchanged. Release signing remains private; never commit keystores or signing passwords. Android compilation/device testing is separate from this Node persistence migration.
