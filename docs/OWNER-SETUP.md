# Owner Setup Guide — External Accounts & Local Tools

These are the actions only you (account owner) can perform. Items 1–3 gate development milestones; start 2 and 3 **now** because their approval clocks run in weeks.

## 1. PostgreSQL 16 (needed for local database — blocks testing, ~10 min, no Docker)

1. Download the Windows installer: https://www.enterprisedb.com/downloads/postgres-postgresql-downloads (PostgreSQL 16.x, Windows x86-64).
2. Run it → keep defaults (port **5432**) → set a password for the `postgres` superuser and **remember it** → skip "Stack Builder" at the end.
3. Verify: open a new terminal and run `psql --version` (if not found, that's fine — the service still runs; Claude can verify).
4. Give Claude the go-ahead (not the password in chat — you'll be asked to put it in the local `.env` file yourself, or just tell Claude the password is set and type it into `.env` when prompted).

That's the only local service needed — job queues run inside Postgres (pg-boss), no Redis, no Docker anywhere.

## 2. Google Cloud project (YouTube analytics + Drive) — simplified: read-only only

YouTube **publishing** now goes through PostQued, so this project only needs read-only analytics access and Drive access. No upload scopes, no quota-increase form.

1. Go to https://console.cloud.google.com with the **Workspace account that owns the 10 TB Drive**.
2. Create project: name `SocialCreatorPilot` (note the Project ID).
3. **APIs & Services → Library** → enable: *YouTube Data API v3* (thumbnails + status checks), *YouTube Analytics API* (metrics + revenue), *Google Drive API* (media library).
4. **APIs & Services → OAuth consent screen**:
   - User type: **Internal** if all YouTube channels live under your Workspace org — this skips Google verification entirely. If some channels are outside the Workspace, choose External (read-only scopes keep verification light).
   - App name `SocialCreatorPilot`, support email = your email.
   - Scopes: `youtube.readonly`, `yt-analytics.readonly`, `yt-analytics-monetary.readonly`, `drive.file`, plus `youtube` (needed only for thumbnails.set; skip if you decide thumbnails can be set manually).
5. **Credentials → Create credentials → OAuth client ID** → Web application → authorized redirect URI: `http://localhost:3001/api/v1/auth/google/callback` (production URI added later when you have a domain).
6. Save the **Client ID + Client Secret** — you'll paste them into the app's settings page (never into chat/files).

## 3. Meta developer app (Facebook Reels) — start NOW

1. https://developers.facebook.com → My Apps → Create App → use case **"Other"** → type **Business**.
2. Name `SocialCreatorPilot`, link your Business Manager when asked.
3. Add product: **Facebook Login for Business**.
4. Settings → Basic: note **App ID + App Secret**; add privacy policy URL (temporary placeholder page is fine; we'll host a real one).
5. While the app is in **Development mode**, add your team's Facebook accounts under App Roles → Roles (Developers/Testers) — this lets all YOUR pages connect immediately without review.
6. App Review → Permissions: request `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `business_management` — needed only to connect pages not owned by app-role accounts; your own pages work in dev mode meanwhile.

## 4. PostQued API key (needed at Phase 1, ~2 min)

1. Log into your PostQued dashboard → Settings → API Keys → Create API key, name `SocialCreatorPilot`.
2. Copy the full key (`pq_…`) immediately — it is shown only once. Paste it into the app's TikTok connection settings page when Phase 1 lands (not into chat).
3. Make sure all TikTok accounts **and all YouTube channels** are connected inside PostQued (the app imports both via the API — YouTube publishing goes through PostQued now).

## 5. Telegram notifications (optional, ~5 min, free)

1. In Telegram, message **@BotFather** → `/newbot` → pick a name → copy the bot token.
2. Add the bot to your team group (or DM it), then the app's settings page will detect the chat and let you pick it.
3. Token goes into the app's notification settings page.

## Security rule for all of the above

Client secrets, API keys, and tokens go **only** into the app's encrypted settings pages (or the server `.env` for infrastructure secrets) — never into chat messages, Google Docs, or screenshots.
