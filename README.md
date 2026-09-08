# HeartPing

A small romantic web/PWA app for two partners. The existing mobile UI is preserved. Real pairing and pings use the included Node server; Firebase and Gemini are not used.

## Run the web app

Requires Node.js 24.x (selected by `.node-version` and `package.json`). No runtime packages or dependency installation are needed.

```powershell
cd C:\Users\yamin\Downloads\heartping
node scripts/build.mjs
node --test tests/backend.test.mjs tests/deployment.test.mjs
node server.js
```

Open http://localhost:3000. If npm is installed, `npm run build`, `npm test`, and `npm start` are equivalent. This environment has Node but no npm on PATH.

For two users, use two devices or independent browser profiles (a normal window and an incognito window also work). Tabs in the same browser profile share an identity. Both users must open the **same server URL**. Each enters their own first name and continues; one shares their six-digit code and the other enters it. Both screens update automatically. Names come from the partner's session, not a manually entered alias.

## State and operation

- `server.js` serves `public/index.html` and the `/api/` endpoints; `backend.js` owns sessions, pairing and pings. There is no frontend bundler.
- Browser storage retains the private session token. The server stores its hash, names, pairing state, and up to 100 recent pings per user in `data/heartping.json`.
- Writes replace the data file atomically. Run **one Node process with a persistent writable data directory**. This is a small single-server app, not a horizontally scalable service. Back up its private data securely; never put the data directory under `public/`.
- Browser reload and server restart retain real pairings. Clearing browser storage loses access to that session; there is no account recovery. An unpaired user can create a new session. An abandoned paired session must be unpaired by the remaining partner before pairing again.
- Codes expire after 24 hours. On the pairing screen, go back to your name and continue again to renew an expired code. Pairings themselves do not expire. Unpairing disconnects both users, clears their histories, and replaces their codes.
- Open, visible pages poll every two seconds. Recent pings missed while away appear on reconnect. There is **no closed-app/background push delivery**, and no receipt confirming the partner actually read a ping. Notification permission enables local alerts only while the app is running.
- The PWA caches its static shell only. Pairing, sending and history synchronization require a connection. Failed sends show an error; retry uses the same ping ID. The last 200 sent IDs are retained independently of visible history to avoid duplicate retries.
- Demo mode is clearly labeled, stays on one screen/device, and resets on reload. It does not change a real pairing.

Set `PORT`, `HOST`, or `DATA_FILE` as environment variables to customize the server. If using `.env`, explicitly run `node --env-file=.env server.js`; no dotenv dependency is used.

## Public HTTPS deployment (recommended: Render)

The production entry point is **server.js**, started with **npm start** (equivalent to **node server.js**). It listens on the provider's PORT, defaults to binding 0.0.0.0, and serves both public/ and /api/ from one origin. Frontend requests are relative; there is no API base URL, localhost endpoint, Firebase project, or push service to configure. Deploy at the origin root, not under a path prefix.

### Why Render for this exact project

Choose a **paid Render Node Web Service with a persistent disk**, not a Static Site or a free service. The supplied render.yaml Blueprint describes one Starter instance in Frankfurt, a 1 GB disk mounted at /var/data, the build/start commands and the health endpoint. Review the current service and disk charge in Render before creating it. Only files under the disk mount survive replacement of the service instance. [Render persistent disks](https://render.com/docs/disks), [Blueprint reference](https://render.com/docs/blueprint-spec).

| Provider | Fit for the current application |
| --- | --- |
| Render | Recommended: native Node service and persistent disk, with a ready-to-use Blueprint in this repository. |
| Railway | Also suitable with a persistent volume and one instance. [Volumes](https://docs.railway.com/volumes/reference). |
| Fly.io | Suitable with one Machine and a volume; requires more Machine/volume deployment configuration. [Volumes](https://fly.io/docs/volumes/overview/). |
| Vercel | Current local-file backend would need persistent external storage and runtime adaptation. Function scratch space is not durable. [Function runtimes](https://vercel.com/docs/functions/runtimes). |
| Netlify | Current persistent Node process would need adaptation to functions and external storage. [Functions runtime](https://docs.netlify.com/build/functions/overview/). |

This is an engineering recommendation for the current architecture, not a claim that the other providers cannot host full-stack applications.

### Exact Render setup

1. Put this project in a GitHub repository. This supplied directory is not currently a Git checkout. If using Git, run the following locally, review the staged file list, then create an empty GitHub repository (no generated README). Replace YOUR_GITHUB_REPOSITORY_URL below with its HTTPS clone URL:

   ~~~powershell
   git init
   git add .
   git diff --cached --name-only
   git commit -m "Prepare HeartPing for HTTPS deployment"
   git branch -M main
   git remote add origin YOUR_GITHUB_REPOSITORY_URL
   git push -u origin main
   ~~~

   Keep data/, .env, backups/, signing keys, node_modules/ and .audit/ out of the repository; .gitignore covers them. Do not upload the entire folder through a UI that ignores .gitignore. No secrets need to be placed in GitHub for this deployment.

2. Sign in to Render, choose **New → Blueprint**, connect GitHub, and select this repository and its actual deployment branch. Render reads render.yaml at the root. Review the proposed paid web service and disk, then deploy the Blueprint.
3. Verify these settings in the service dashboard:
   - Runtime: Node; Node version: 24.x from .node-version.
   - Build command: node scripts/build.mjs && node --test tests/backend.test.mjs tests/deployment.test.mjs
   - Start command: npm start
   - Health check: /healthz
   - Instance count: **1**; do not add replicas, autoscaling, PM2 clusters or additional processes writing the same file.
   - Persistent disk: mount **/var/data**, size **1 GB**.
   - NODE_ENV=production, HOST=0.0.0.0, DATA_FILE=/var/data/heartping.json.
4. Leave PORT to Render. Wait until deployment is live, then copy its assigned **https://…onrender.com** URL. Render terminates HTTPS; no certificate/private key belongs in this Node application. You do not need a custom domain. [Render web services](https://render.com/docs/web-services).
5. Open the assigned URL and its **/healthz** path. The latter should return {"status":"ok"}. The app checks that its configured data directory is writable before starting and refuses production startup without DATA_FILE. It cannot detect whether a directory is truly backed by a provider disk: verify the disk attachment in Render.
6. Send the **same exact HTTPS URL** to both iPhones. Use Safari. If you want Home Screen installation, install on both phones first (Share → Add to Home Screen), then pair from the installed apps; browser and standalone storage can differ. Each person enters their own first name and continues. A shares their code privately; B enters A's code. Both should show the partner's name.
7. Keep both apps open and visible. A taps the heart and B checks history; then reverse. Refresh/reopen and verify the relationship survives. Finally trigger one Render redeploy and verify pairing and history still exist: this checks the actual persistent disk setup. Disk-backed deploys may briefly interrupt service; the browser reconnects automatically.

The two phones can be on unrelated Wi-Fi/mobile networks because they use the same public server. Local development pairings do not automatically migrate: browser sessions belong to the old origin and server data starts fresh. Re-pair on the public URL. Do not commit your existing local data file to migrate it.

### Environment variables

| Variable | Value / requirement |
| --- | --- |
| NODE_ENV | production (Blueprint sets it). |
| DATA_FILE | /var/data/heartping.json (Blueprint sets it); must be on the attached disk and outside public/. Required in production. |
| HOST | 0.0.0.0 (Blueprint sets it; also the default). |
| PORT | Supplied by Render; do not set a local development port manually. |

No API keys or frontend URL variables are required. On other Node hosts, attach persistent storage, set DATA_FILE to a file within it, run one instance, and preserve the public Host header through the HTTPS reverse proxy. Untrusted forwarded host/IP headers are not used to authorize requests. Request throttling uses the immediate socket address, so users behind the same proxy can share limits (10 joins/minute, 60 other mutations/minute per endpoint).

Back up the private data file through your provider's disk facilities. Never move it under public/ or remove the disk during redeploys. Graceful SIGTERM/SIGINT handling drains active HTTP requests; filesystem changes are saved synchronously before a successful API response. The JSON store is appropriate for this small single-instance app, not multi-instance/high-traffic deployment. There is no automatic account/session retention cleanup.

### PWA and notification limits

The manifest is public/manifest.webmanifest; manifest.json is a matching compatibility alias. The supplied icons are verified as 192×192 and 512×512. The service worker caches known static files only and excludes API traffic. HTTPS enables the production PWA features; actual installation and OS notification behavior on iPhones still require the device test above.

Pings synchronize while the app is open and visible (approximately every two seconds). Missed recent pings appear when it reconnects. **There is no closed-app push notification service and no read receipt.** Installing the PWA or enabling local alerts does not add background push. No Firebase was added.

### Verification status for this deployment preparation

The build and four backend/deployment tests pass, including public Host + HTTPS Origin simulation, process restart persistence, provider PORT binding, health check, and rejection of missing/unwritable/public storage. The two-context Edge browser regression also exercises mobile-size pairing, both ping directions, reload and offline recovery. Tests run locally; a real Render deployment, TLS endpoint, iPhone installation and inter-location delivery have not been performed from this environment. Android files were not changed for deployment preparation.

## Android wrapper

The package/application ID is preserved. Local content uses AndroidX WebViewAssetLoader at an HTTPS-style appassets URL, with file/content access disabled and mixed content blocked. No notification runtime permission or Firebase SDK is needed. The bounded vibration bridge is exposed only to bundled content. Android lifecycle pauses/resumes the WebView and disposes it with the screen.

`public/` is the source of truth: Gradle copies it into generated APK assets automatically. The Node build also synchronizes the original checked-in `app/src/main/assets/www/` mirror.

Default Android builds open the bundled **local demo**; they cannot reach a Node server inside an APK. For real cross-device use, point the wrapper at the hosted HTTPS origin:

```powershell
.\gradlew.bat :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
.\gradlew.bat :app:assembleDebug -PheartpingUrl=https://your-heartping-host.example/
```

Install Android Studio, a compatible JDK (17+), and the project's Android SDK 36.1 first. Configure `JAVA_HOME` and `local.properties` / SDK location. The wrapper files are restored for Gradle 9.3.1; its JAR matches the [official checksum](https://gradle.org/release-checksums/), and the distribution checksum is pinned. Debug uses the standard Android debug keystore. Release builds still require your signing keystore and `KEYSTORE_PATH`, `STORE_PASSWORD`, `KEY_PASSWORD` (alias `upload`). Do not commit these files or secrets.

Android compilation was attempted here but stopped before Gradle configuration because Java is unavailable. SDK/emulator tooling is also absent, so APK runtime/lifecycle behavior is not claimed verified. No emulator logs were supplied. Graphics/framework warnings cannot be diagnosed from their severity alone; hardware acceleration remains enabled.

## Verification

```powershell
node scripts/build.mjs
node --test tests/backend.test.mjs tests/deployment.test.mjs
```

The build performs syntax, manifest/icon and HTML asset checks, then synchronizes the Android mirror. The API tests cover the two-user journey, invalid/self/occupied/expired codes, authentication, cross-origin rejection, duplicate ping retries, recipient isolation, restart persistence, rate limiting, failed-write rollback and static server safety.

Optional browser checks require Playwright and a browser. With npm available:

```powershell
npm install --no-save --package-lock=false playwright
npx playwright install chromium
node tests/browser.mjs
```

Alternatively set `BROWSER_CHANNEL=msedge` to use installed Edge. `PLAYWRIGHT_MODULE` may point to an existing Playwright `index.mjs`; the verification here used the environment's bundled Playwright and installed Edge. These dependencies are for tests only. Screenshots are written to ignored `.audit/screenshots/`.

The browser test verifies two independent mobile-size sessions, pairing, bidirectional pings, safe rendering of HTML-like names, refresh persistence, offline send failure and retry, offline shell/recovery, cache isolation, mutual unpair and demo behavior. No production deployment, physical-device receipt, native notification, or Android build success is claimed.
