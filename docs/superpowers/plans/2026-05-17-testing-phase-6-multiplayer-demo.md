# Phase 6 addendum — multiplayer-demo implementation plan

> Companion spec: `docs/superpowers/specs/2026-05-17-testing-phase-6-multiplayer-demo-design.md`.

## Tasks

### Task 1: Seed migration for test accounts

**Files:** create `supabase/migrations/<YYYYMMDDHHMMSS>_seed_demo_accounts.sql`

Insert 4 confirmed users into `auth.users` with bcrypt-hashed password `demo-pass-1234` and `user_metadata` set per the design table.

`ON CONFLICT (email) DO NOTHING` so re-running `supabase db reset` is idempotent.

Verify: `supabase db reset --local --no-seed` succeeds, then `psql ... -c "SELECT email, raw_user_meta_data FROM auth.users"` lists 4 rows.

Commit: `feat(supabase): seed 4 demo test accounts (alice/bob/dave/eve)`.

### Task 2: Helper module `tests/fixtures/multiplayer-demo.ts`

**Files:** create `tests/fixtures/multiplayer-demo.ts`

Port + adapt from `demo/play-demo.js`:

- `loginAsRegistered(page, email, password, label)` — Welcome → `btn-sign-in` → `auth-tab-signIn` → fill email/password → submit → wait `input-player-name`.
- `applyGuestSettings(page, prefs)` — open Settings modal via `btn-open-settings`, click theme/lang/deck/avatar pills, close.
- `changeNicknameInLobby(page, nickname)` — focus `input-player-name`, triple-click, type, blur via `keyboard.press('Tab')`.
- `joinViaDeepLink(page, code)` — `page.goto('/join/' + code)`, wait for `room-code`.
- `sendChatMessage(page, { phase, text })` — branch on phase: betting uses `betting-chat-input` + `betting-chat-send`; play uses `game-btn-chat` to open panel + `chat-input` + `chat-send`.
- `viewLastTrick(page)` — `game-btn-last-trick` → wait modal → `last-trick-close`.
- `openScoreboardMobile(page)` — `game-btn-scoreboard` → wait `scoreboard-modal` → close.
- `toggleDesktopRightPane(page)` — desktop wrapper specific (find pane toggle testID — TBD during implementation).
- `toggleDesktopChat(page)` — desktop wrapper's chat panel close + reopen.

Plus `runDemoGameLoop(page, opts)`:

- Wraps existing `runGameLoop` from `multiplayer.ts`.
- Maintains `handsPlayed` counter via hook on Continue clicks.
- After each hand transition, attempts the per-viewport interactions once.
- All interaction attempts try/catch; failures increment `failureCount` but never throw.
- Returns `{ result: GameLoopResult, interactions: { chat: N, lastTrick: M, scoreboardOpen: K, ... } }`.

Verify: `npx tsc --noEmit tests/fixtures/multiplayer-demo.ts` clean.

Commit: `test(fixtures): multiplayer-demo.ts — auth, settings, chat, panes`.

### Task 3: The spec — `tests/e2e/multiplayer-demo.spec.ts`

**Files:** create `tests/e2e/multiplayer-demo.spec.ts`

Structure:

```ts
const ROSTER = [
  { label: 'P1', vp: MOBILE, role: 'host', auth: { type: 'registered', email: 'alice@nigels.test', password: PASS, displayName: 'Alice' }, prefs: { lang: 'en', theme: 'light', deck: 'fourColor' }, joinPath: null },
  { label: 'P2', vp: MOBILE, role: 'player', auth: { type: 'registered', email: 'bob@nigels.test',   password: PASS, displayName: 'Bob'   }, prefs: { lang: 'ru', theme: 'dark',  deck: 'fourColor' }, joinPath: 'code' },
  { label: 'P3', vp: MOBILE, role: 'player', auth: { type: 'guest',      displayName: 'Carol'        }, prefs: { lang: 'es', theme: 'light', deck: 'twoColor'  }, joinPath: 'deepLink' },
  { label: 'P4', vp: MOBILE, role: 'player', auth: { type: 'registered', email: 'dave@nigels.test',  password: PASS, displayName: 'Dave'  }, prefs: { lang: 'en', theme: 'dark',  deck: 'fourColor' }, joinPath: 'code' },
  { label: 'P5', vp: DESKTOP, role: 'player', auth: { type: 'registered', email: 'eve@nigels.test',  password: PASS, displayName: 'Eve'   }, prefs: { lang: 'ru', theme: 'light', deck: 'fourColor' }, joinPath: 'code' },
  { label: 'P6', vp: DESKTOP, role: 'player', auth: { type: 'guest',      displayName: 'Frank'       }, prefs: { lang: 'es', theme: 'dark',  deck: 'twoColor'  }, joinPath: 'deepLink' },
];
```

Steps:

1. Spawn 6 contexts (4 mobile + 2 desktop).
2. Each player goes through their entry path in parallel:
   - Registered → `loginAsRegistered`
   - Guest → `enterLobbyAsGuest` (existing) → `applyGuestSettings` → `changeNicknameInLobby`
3. Wait for everyone to reach the Lobby (poll `btn-create-room` visibility).
4. P1 (host) creates the room — `createRoomAsHost(pages[0], 6, 'P1')`.
5. Serial joins by joinPath:
   - 'code' players: `joinRoomByCode(p, code)`
   - 'deepLink' players: `joinViaDeepLink(p, code)`
6. All five non-host players `markReady`. Host `startGame`.
7. Parallel `runDemoGameLoop` for all 6.
8. Print summary: `console.log` per-player interaction counts.
9. **No hard expects** on interactions. One expect on overall game-over per player, OR no expect at all (just a log) — per "this is a demo" decision.

```ts
test.setTimeout(2 * 60 * 60 * 1000);  // 2 h
```

Commit: `test(e2e): multiplayer-demo.spec.ts — 6p feature showcase`.

### Task 4: Registry + npm scripts

**Files:** modify `tests/tests.config.json`, `package.json`

Registry: append (after `multiplayer-6p-mixed`):

```json
{ "name": "multiplayer-demo", "tier": "end-to-end", "enabled": false, "note": "Demo — run via npm run demo:full:local:headed" }
```

npm scripts (after `test:mp:local:headed`):

```json
"demo:full":              "playwright test tests/e2e/multiplayer-demo.spec.ts",
"demo:full:local":        "LOCAL_SUPABASE=1 HEADLESS=1 DEMO_URL=http://localhost:8082 playwright test tests/e2e/multiplayer-demo.spec.ts",
"demo:full:local:headed": "LOCAL_SUPABASE=1 SLOW_MO=120 DEMO_URL=http://localhost:8082 playwright test tests/e2e/multiplayer-demo.spec.ts",
```

Commit: `test(scripts): demo:full + multiplayer-demo registry entry`.

### Task 5: Documentation

**Files:** modify `tests/README.md`

Add a `## Multiplayer demo (tests/e2e/multiplayer-demo.spec.ts)` section explaining:

- What it is (feature-touching showcase, not regression)
- Player roster table (small version)
- How to run (`demo:full:local:headed`)
- What "passes" means (video produced + game reaches scoreboard)
- Where to find traces / videos after a run

Commit: `docs(tests): multiplayer-demo section in tests/README.md`.

### Task 6: Verification

Pre-flight:
- `lsof -i :8082` empty, supabase docker not up
- `vm_stat` shows ≥4 GB reclaimable

Run: `npm run demo:full:local:headed`

Watch for:
- All 6 windows open
- Logins for P1/P2/P4/P5 succeed (no "Invalid login credentials" alerts)
- Guests P3/P6 settings click through
- Room created, all join
- Game proceeds; chat bubbles appear
- Scoreboard transitions visible

Expected duration: 60-90 min.

If a step fails:
- Login fail → migration may not have applied; `psql` check
- Deep-link fail → check NavigatorGuard redirects + `useAuthStore` hydration
- Per-hand action fail → expected, demo is best-effort

Do NOT block on minor failures — record the run, note issues for future Phase 6.1+.

## Out of scope reminders

- Phase 6.1+: host-exit, reconnect, spectator
- Phase 7+: bot tier integration with multiplayer
- Mid-game language switching (separate scenario)
