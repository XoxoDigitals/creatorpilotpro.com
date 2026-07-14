# 08 — Security, Roles & Compliance

## 1. Roles & Permission Matrix

| Capability | Owner | Admin | Reviewer | Worker | Analyst |
|---|:-:|:-:|:-:|:-:|:-:|
| Manage users/roles | ✅ | partial (not owners) | — | — | — |
| Connect/disconnect accounts | ✅ | ✅ | — | — | — |
| View/edit AI keys & providers | ✅ | edit (values never re-shown) | — | — | — |
| Edit channel profiles/prompts | ✅ | ✅ | edit metadata only | — | — |
| Approve/reject review queue & ideas | ✅ | ✅ | ✅ | — | — |
| Schedule/publish/retry | ✅ | ✅ | ✅ | — | — |
| Manage sources/watchers | ✅ | ✅ | ✅ | — | — |
| Worker portal (own tasks, upload) | ✅ | ✅ | ✅ | ✅ own only | — |
| Dashboards/analytics | ✅ | ✅ | ✅ | own stats | read-only |
| System settings, storage, kill-switches | ✅ | ✅ | — | — | — |
| Audit log | ✅ | view | — | — | — |

Enforced twice: API guards (route + resource ownership) and UI hiding. Workers' API surface is a minimal allowlist (their tasks, brief download, upload endpoint).

## 2. Secrets & Token Security

- All OAuth tokens, PostQued credentials, AI keys, SMTP/Telegram secrets: **AES-256-GCM** encrypted columns; `MASTER_KEY` only in server env (dotenv on VPS, never committed; rotation procedure documented).
- Keys displayed once at entry, stored write-only from UI perspective (show label + last-4 only).
- Web session: HttpOnly Secure SameSite=Lax cookies; CSRF token on mutations; strict CORS (dashboard origin only); rate-limited login + 2FA (TOTP) for Owner/Admin.
- Upload endpoints: authenticated, size-capped, extension+MIME sniffed, stored outside web root, virus-scan optional (ClamAV container toggle).
- Outbound: platform API calls only from worker/API processes; no secrets or platform calls in the browser.
- VPS: Caddy TLS, firewall (only 80/443/SSH-key-only), fail2ban, unattended security updates, Postgres bound to localhost only.

## 3. Auditability

`audit_log` (append-only) records: logins, role changes, account connections, key changes, approvals/rejections, prompt edits, schedule changes, manual retries, deletions — actor + before/after. Incidents + publish_attempts give a full forensic trail per video.

## 4. Backups & Disaster Recovery

- Nightly `pg_dump` (compressed, encrypted) → Google Drive, 30-day rotation; weekly restore-test job (restores into a scratch DB, sanity-checks row counts — backups that aren't tested don't exist).
- Media already redundant: originals + finals live on Drive.
- Job queues live in Postgres (pg-boss) — included in the same dump; a boot recovery job re-derives any missing jobs from entity state machines.
- Documented VPS rebuild runbook: fresh VPS → compose up → restore dump → re-enter MASTER_KEY → re-auth check. Target RTO < 4 h.

## 5. Content Rights & Platform Policy (PM straight talk)

This platform is rights-agnostic machinery; **legality depends on inputs**. Recorded here so we build the right guardrails:

1. **Repurposed content:** downloading and republishing others' videos (even re-voiced) is copyright infringement unless you have a license/authorization from the rights holder or the content is otherwise cleared. Re-dubbing licensed Chinese short-form content is a real, legitimate industry — the system therefore makes the **rights note a required field** at review, records who confirmed it, and archives originals as evidence. Getting/holding those licenses is on you; the system gives you the paper trail.
2. **Kuaishou scraping:** no official API; automated collection may violate their ToS and can break anytime. Built as best-effort with the bulk-URL fallback; watchers auto-pause on blocks rather than evading them (no captcha-solving, no anti-bot circumvention — that's out of scope by design).
3. **Platform strike risk:** repeated copyright incidents can terminate channels. The dashboard's incident center + auto-hold-siblings setting (doc 06 §5) + per-account strike counter exist to make risk visible early. Recommendation: set a per-account rule "2 open copyright incidents ⇒ auto-pause that account's queue."
4. **AI-content disclosure:** YouTube and TikTok require synthetic/AI-content labels in various cases — per-channel `aiLabelDefault` covers it; keep it ON for AI pipelines.
5. **AI Studio multi-key usage:** see doc 05 §4 warning. Support exists; paid Flash keys are my recommended path (doc 09 shows it's nearly free anyway).
6. **Meta/Google app compliance:** OAuth apps must pass Google verification & Meta App Review — both require honest scope justifications and a privacy policy URL (we'll host one on the dashboard domain). Timelines in roadmap.
