# Audit and verification record

## Original repository

Audit completed before application edits. Inventory covered root configuration, all web scripts/HTML/CSS/manifests, icons, Android activity/manifest/Gradle/version catalog, resources, tests, and the duplicate APK asset tree. The two web trees were byte-identical. There is no `.git` directory and no applicable repository `AGENTS.md` was found.

- Entry points: Node `server.js` → `public/index.html` → ES module `app.js`; Android `MainActivity` → `file:///android_asset/www/index.html`.
- Web runtime dependencies: none. Original `build` merely echoed success; no web lint/type/test commands existed. Kotlin sample tests only exercised a greeting, a string, and arithmetic.
- Pairing was entirely local and accepted nonexistent codes. Firebase config and implementation were placeholders; BroadcastChannel could only communicate locally and did not isolate recipients. Ping success was shown before sending and backend errors were swallowed.
- Persistent history rendered user-controlled names through innerHTML. Clipboard failures falsely showed “Copied”. Settings and history could become stale. Local state could claim a real relationship without one existing.
- Static server had unhandled malformed URL decoding, weak path containment, and returned index.html for missing assets. PWA used conflicting absolute/relative manifest paths, cached broadly, and swallowed precache failures.
- Android had broad file/universal access, missing custom debug keystore, unused Firebase/AI/AppCheck dependencies, and only Gradle wrapper properties (no launchers/JAR). No actual Firebase/Gemini credentials or private signing keys were found in the supplied files. No history was available to inspect for previous secrets.
- Ignore rules omitted server data, Node dependencies, nested build outputs and private signing material. README incorrectly required Gemini setup.

## Changes

- Added `backend.js`; updated `server.js`: same-origin JSON API, hashed bearer sessions, server-issued expiring codes, mutual pairing, recipient-specific ping history, retry deduplication, rate limits, bounded bodies, atomic saves with rollback and restart persistence. Correct static status codes/MIME/security headers.
- Updated all seven web text files in `public/`: server-driven app flow, clear errors, submission guards, safe DOM rendering, honest demo/notification wording, accurate clipboard feedback, relative manifests, restricted SW cache, accessible zoom/focus/reduced-motion and mobile layout fixes. Existing assets and core visual design retained.
- Synchronized the same seven files under `app/src/main/assets/www/`. Gradle now generates APK assets from `public/` so Studio builds cannot silently use a stale copy.
- Updated Android `MainActivity.kt`, `AndroidManifest.xml`, app/root Gradle files and `gradle.properties`: WebViewAssetLoader, lifecycle cleanup, navigation/origin restriction, optional HTTPS hosted origin, no broad file permissions, no unused Firebase initialization, standard debug signing, private backup disabled.
- Restored official Gradle 9.3.1 `gradlew`, `gradlew.bat`, and wrapper JAR. JAR SHA-256 matches the official Gradle checksum page; distribution SHA-256 is pinned in wrapper properties.
- Updated `.gitignore`, `.env.example`, `metadata.json`, `package.json`, and README. Added build verification script and API/browser regression tests. No credentials were added.

## Actual verification

- Initial `node --check` for server/app/service/SW: PASS. Syntax alone did not validate functionality.
- Initial `npm --version` and `npm run build`: FAIL — npm is not on PATH. Used installed Node v24.19.0 directly; app has no dependencies to install.
- `node scripts/build.mjs`: PASS — JS syntax, HTML references, real PNG dimensions and matching manifest aliases; mirror synchronized.
- `node --test tests/backend.test.mjs`: PASS (2 integration tests with multiple assertions) — two users, empty/invalid/self/nonexistent/occupied/expired codes, both ping directions, isolated recipients, deduplicated retries including after history clearing, restart persistence, mutual unpair/code rotation, unauthenticated/cross-origin/invalid JSON rejection, malformed/traversal/missing-asset handling, request throttling, storage failure rollback. The intentional disk-failure case prints an EEXIST error; it is expected evidence, not suppressed.
- First `node tests/browser.mjs`: FAIL — bundled Playwright had no downloaded Chromium binary. Retried using installed Edge (`BROWSER_CHANNEL=msedge`) and bundled Playwright (`PLAYWRIGHT_MODULE`); no project runtime dependency added.
- Browser test with Edge: PASS — separate mobile browser contexts (390 and 320 CSS px), onboarding, invalid-code error, mutual pairing, two-way pings, HTML-like name safely displayed as text, reload state/history, offline send error and retry, static offline shell and reconnect, private API absent from SW cache, unpair and demo. No uncaught page errors. Screenshots reviewed from ignored `.audit/screenshots/`.
- Official wrapper download first failed due to sandbox networking; succeeded after approved network access. JAR hash: b3a875ddc1f044746e1b1a55f645584505f4a10438c1afea9f15e92a7c42ec13.
- `.\gradlew.bat :app:assembleDebug :app:testDebugUnitTest :app:lintDebug`: FAIL before project configuration — JAVA_HOME unset and no Java executable. Android SDK/Studio/emulator absent. No APK compile/runtime success claimed.
- `git status` / `git diff`: unavailable because the supplied folder is not a Git checkout. Compared SHA-256 baseline inventory instead: only intended source/config files and their Android mirrors changed; no original files deleted. Icons, native resources, existing native test files and version catalog preserved.

## Limits / external work

Use one persistent Node server behind HTTPS for both devices. No Firebase/Gemini setup. File storage is deliberately small and single-process; no horizontal scaling, account recovery, or automated session retention cleanup. Sessions remain until browser storage/server data is removed; codes expire after one day. Keep the data file private and backed up. Recent history is capped at 100 entries and retry IDs at 200.

Closed-app push is not implemented. Polling resumes when the app is visible; recent missed pings are recovered from server history. Actual PWA installation, OS alerts/vibration, physical-device delivery, and native APK behavior still require device testing. No emulator logs were supplied, so no particular graphics warning was classified; hardware acceleration remains enabled.

Android bundles support local demo unless an HTTPS HeartPing origin is configured with `-PheartpingUrl=...`. Release signing remains user-owned. Install JDK/SDK and run the documented Gradle checks before distributing an APK.

References: [Android local WebView content guidance](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content), [official Gradle checksums](https://gradle.org/release-checksums/).
