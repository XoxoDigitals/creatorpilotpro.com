# 11 — UI Design System & Information Architecture

Owner directive (2026-07-14): account-centric navigation — selecting an account opens a workspace containing everything for that account; account **content type** chosen at connect time decides which workspace tabs exist. Professional, dense-but-clean dashboard design.

## 1. Information Architecture

```
Sidebar (dark, collapsible)
├── GLOBAL
│   ├── Dashboard        /dashboard          — cross-account overview, today's publishes, incidents, queue health
│   ├── Calendar         /calendar           — all-accounts content calendar
│   ├── Review Queue     /review             — all pending reviews (badge = count)
│   ├── Incidents        /incidents          — incident center (badge = open count)
│   ├── Workers          /workers            — task board & productivity (role-gated)
│   └── Analytics        /analytics          — cross-account rollups
├── ACCOUNTS                                 — the heart of the app
│   ├── [account list: avatar, platform icon, name, type badge, health dot]
│   │       → click = /accounts/[id] workspace
│   └── + Connect account                    — wizard (platform → content type → auth)
└── SYSTEM
    └── Settings         /settings           — tabs: General · AI Providers & Keys · Notifications · Users
Sidebar footer: user name + role badge, notification bell, logout.
```

### Account workspace `/accounts/[id]/*`
Header: avatar · name · platform icon · content-type badge · connection-health dot · quick actions (Pause queue, Open on platform).
Horizontal tab nav (tabs depend on `contentType`):

| Tab | Route | AI | REPURPOSED | Notes |
|---|---|:-:|:-:|---|
| Overview | `/accounts/[id]` | ✅ | ✅ | stat cards (followers, views, scheduled, incidents), recent posts, health |
| Sources | `…/sources` | — | ✅ | watched profiles + bulk URL import for THIS account |
| Review | `…/review` | ✅ | ✅ | this account's review queue |
| Ideas | `…/ideas` | ✅ | — | idea board (kanban) scoped to account |
| Dramas | `…/dramas` | ✅ | — | drama series list (TikTok accounts primarily) |
| Schedule | `…/schedule` | ✅ | ✅ | account calendar + slot rules |
| Analytics | `…/analytics` | ✅ | ✅ | account + per-post metrics, revenue if monetized |
| Settings | `…/settings` | ✅ | ✅ | channel profile: master prompt, styles, voice, templates, approval policy, scheduling prefs |

`contentType` enum on the account: `AI` | `REPURPOSED` | `MIXED` (MIXED shows all tabs). Chosen in the connect wizard; editable later in account settings. **Schema note:** lands as `social_accounts.contentType` in the Phase 1 migration.

### Connect wizard (modal, 3 steps)
1. Platform: YouTube / Facebook Page / TikTok (cards with logos).
2. Content type: AI content / Repurposed content / Both — with one-line explanations of what each enables.
3. Authorize: platform-specific (OAuth redirect or PostQued import) — Phase 1 wires this; until then the step shows a "connection arrives in Phase 1" state.

## 2. Design Tokens (Tailwind v4 `@theme` in globals.css)

- **Font:** Inter (next/font, variable), tabular numerals for metrics.
- **Neutrals:** zinc scale. App background `zinc-50`; content cards white; dark sidebar `zinc-950`.
- **Accent:** indigo-600 (primary actions, active nav, focus rings).
- **Semantic:** green-500 healthy/published · amber-500 pending/expiring · red-500 failed/incident · violet-500 AI badge · sky-500 repurposed badge.
- **Platform colors:** YouTube #FF0000, Facebook #1877F2, TikTok near-black w/ cyan/red glyph.
- **Radius:** lg (8px) cards, md (6px) inputs/buttons. **Shadows:** subtle single-layer; rely on borders (`zinc-200`) for separation.
- **Density:** compact tables (40px rows), 8px spacing grid, 13–14px body, 12px meta.
- Dark mode: deferred (tokens named semantically so it's a later drop-in).

## 3. Component Kit (`apps/web/src/components/ui/`)

Button (primary/secondary/ghost/danger; sm/md) · Card + CardHeader · StatCard (label, value, delta arrow) · Badge (semantic + platform + type variants) · Tabs (underline style, URL-driven) · Table (sticky header, compact) · Modal/Dialog · Drawer (right, for detail panes) · EmptyState (icon, title, hint, CTA) · Input/Select/Textarea/Toggle (consistent focus) · Avatar (image or initials) · HealthDot (green/amber/red + tooltip) · PlatformIcon (inline SVGs) · Skeleton loaders · Toast notifications.

Rule: pages compose ONLY from this kit — no ad-hoc styling in pages. New visual needs = extend the kit.

## 4. Page States

Every list/board ships all three states designed: loading (skeleton), empty (EmptyState with helpful CTA), populated. Until Phase 1 delivers real accounts, the UI runs on a clearly-marked mock layer (`src/lib/mock-data.ts`) behind the same TypeScript interfaces the API client will satisfy — swap is mechanical, no redesign.

## 5. Interaction Standards

- Account switching always via sidebar; workspace tabs preserve across account switch when the target account has the same tab, else land on Overview.
- Destructive actions: confirm dialog naming the object ("Disable account *Cooking Channel*?").
- All mutations: optimistic UI where safe + toast on result; errors always human-readable.
- Keyboard: `/` focuses search (later), `g d` dashboard, `g a` accounts (later phase; structure nav to allow it).
- Tables: right-align numbers, tabular-nums, relative timestamps with absolute on hover.
