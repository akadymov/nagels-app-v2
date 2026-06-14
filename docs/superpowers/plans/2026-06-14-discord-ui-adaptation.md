# Discord UI Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When running inside a Discord Activity, fit the full hand in the shorter viewport and strip Discord-redundant chrome — all gated by `isDiscordActivity()` so normal web/PWA play is unchanged.

**Architecture:** One new hook `useIsDiscordActivity` (returns `isDiscordActivity()`), threaded as small gated conditionals through `App.tsx`, `usePushSubscribe`, `AppNavigator`, and `GameTableScreen`. The hand switches from the 2-row grid to `CardHand`'s existing single-row overlap+scroll mode. The Discord-native invite uses the Embedded SDK exposed from `bootstrap.ts`.

**Tech Stack:** Expo (React Native) + react-native-web, TypeScript, `@discord/embedded-app-sdk`, jest (ts-jest).

**Spec:** `docs/superpowers/specs/2026-06-14-discord-ui-adaptation-design.md`

**Branch:** continue on `feat/discord-activity`. (Note: the post-frame-capture WIP has a 1-line uncommitted change in `GameTableScreen.tsx` ~line 1614 — different region, no collision; do not stage it.)

---

## File Structure

- Create: `src/hooks/useIsDiscordActivity.ts` — boolean hook gating all Discord UI.
- Create: `src/hooks/__tests__/useIsDiscordActivity.test.ts`.
- Modify: `src/App.tsx` — drop top safe-area inset + skip PWA install listener in Discord.
- Modify: `src/lib/push/usePushSubscribe.ts` — no push permission prompt in Discord.
- Modify: `src/navigation/AppNavigator.tsx` — hide feedback FAB in Discord.
- Modify: `src/screens/GameTableScreen.tsx` — hide chat/share/spectator; single-row hand; native invite button.
- Modify (only if needed): `src/components/cards/CardHand.tsx` — already supports single-row overlap+scroll via `horizontal` + `cardOverlap`; no change expected.
- Modify: `src/lib/discord/bootstrap.ts` — expose the initialized SDK via `getDiscordSdk()`.

---

## Task 1: `useIsDiscordActivity` hook

**Files:**
- Create: `src/hooks/useIsDiscordActivity.ts`
- Test: `src/hooks/__tests__/useIsDiscordActivity.test.ts`

`isDiscordActivity()` is session-constant, so the hook needs no internal
state — it just returns the value. That keeps it callable like a plain
function in tests (no react-test-renderer) while reading like the
existing `useIsDesktop` at call sites.

- [ ] **Step 1: Write the failing test**

```ts
// src/hooks/__tests__/useIsDiscordActivity.test.ts
import { useIsDiscordActivity } from '../useIsDiscordActivity';

describe('useIsDiscordActivity', () => {
  it('returns false outside a Discord Activity (jest node env, no window)', () => {
    expect(useIsDiscordActivity()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- src/hooks/__tests__/useIsDiscordActivity.test.ts`
Expected: FAIL — cannot find module `../useIsDiscordActivity`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/hooks/useIsDiscordActivity.ts
/**
 * True when the app runs inside a Discord Activity. Mirrors the
 * `useIsDesktop` hook form for call-site consistency. Discord context is
 * fixed for the session, so this is a thin wrapper over `isDiscordActivity()`
 * — no internal state needed. False on native/SSR and in the smoke browser.
 */
import { isDiscordActivity } from '../lib/discord/context';

export function useIsDiscordActivity(): boolean {
  return isDiscordActivity();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- src/hooks/__tests__/useIsDiscordActivity.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useIsDiscordActivity.ts src/hooks/__tests__/useIsDiscordActivity.test.ts
git commit -m "feat(discord): useIsDiscordActivity hook"
```

---

## Task 2: App.tsx — drop top safe-area inset + skip PWA install in Discord

**Files:**
- Modify: `src/App.tsx`

`AppContent` (line ~16) renders `<SafeAreaView ... edges={['top']}>`. In a
Discord window there's no notch, and Discord already pads the top — the
inset wastes vertical space we need for the hand. The PWA install listener
(line ~235) is meaningless inside Discord.

- [ ] **Step 1: Import the hook**

In `src/App.tsx`, after the existing `import { isDiscordActivity } from './lib/discord/context';` line (added in the first-test work), add:

```ts
import { useIsDiscordActivity } from './hooks/useIsDiscordActivity';
```

- [ ] **Step 2: Gate the SafeAreaView top edge**

In `AppContent` (around line 16-20), the current line is:

```tsx
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['top']}>
```

Add the hook at the top of `AppContent` and make `edges` conditional:

```tsx
function AppContent() {
  const { colors } = useTheme();
  const isDiscord = useIsDiscordActivity();

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={isDiscord ? [] : ['top']}>
```

- [ ] **Step 3: Skip the PWA install listener in Discord**

In the web effect (line ~235), the current code is:

```ts
      void import('./lib/pwaInstall').then(({ setupPwaInstallListener }) => {
        setupPwaInstallListener();
      });
```

Wrap it so it doesn't run inside Discord:

```ts
      if (!isDiscordActivity()) {
        void import('./lib/pwaInstall').then(({ setupPwaInstallListener }) => {
          setupPwaInstallListener();
        });
      }
```

(`isDiscordActivity()` is already imported in `App.tsx`; use the function form here since this is inside a `useEffect`, not render.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors in `src/App.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(discord): drop top safe-area inset + skip PWA install in Discord"
```

---

## Task 3: usePushSubscribe — no permission prompt in Discord

**Files:**
- Modify: `src/lib/push/usePushSubscribe.ts`

Line ~64 calls `Notification.requestPermission()`. Inside Discord we don't
want a web-push permission prompt.

- [ ] **Step 1: Read the function around line 64**

Read `src/lib/push/usePushSubscribe.ts` to find the function that wraps the
`await Notification.requestPermission()` call and its early-return shape.

- [ ] **Step 2: Add an early guard**

At the top of the subscribe routine that contains `Notification.requestPermission()` (before any prompt is shown), add:

```ts
  if (isDiscordActivity()) return; // no web-push prompt inside a Discord Activity
```

Add the import at the top of the file:

```ts
import { isDiscordActivity } from '../discord/context';
```

Match the function's existing early-return type (if it returns a value/status object elsewhere, return the same "noop/declined" shape rather than bare `return`; read the surrounding code and mirror it).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors in `src/lib/push/usePushSubscribe.ts`.

- [ ] **Step 4: Run unit suite (no regressions)**

Run: `npm run test:unit`
Expected: all suites pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/push/usePushSubscribe.ts
git commit -m "feat(discord): suppress web-push permission prompt in Discord"
```

---

## Task 4: AppNavigator — hide feedback FAB in Discord

**Files:**
- Modify: `src/navigation/AppNavigator.tsx`

`GlobalFeedbackOverlay` (line ~441) renders `<FeedbackButton .../>`.

- [ ] **Step 1: Import the hook**

Add near the existing imports in `src/navigation/AppNavigator.tsx`:

```ts
import { useIsDiscordActivity } from '../hooks/useIsDiscordActivity';
```

- [ ] **Step 2: Return null in Discord**

In `GlobalFeedbackOverlay`, add the hook and an early return before the final `return <FeedbackButton ... />`:

```ts
const GlobalFeedbackOverlay: React.FC = () => {
  const isDiscord = useIsDiscordActivity();
  const [routeName, setRouteName] = useState<string | undefined>(undefined);

  useEffect(() => {
    // ... existing effect unchanged ...
  }, []);

  if (isDiscord) return null;
  return <FeedbackButton screenName={routeName} />;
};
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/navigation/AppNavigator.tsx
git commit -m "feat(discord): hide feedback FAB in Discord"
```

---

## Task 5: GameTableScreen — hide chat / share / spectator in Discord

**Files:**
- Modify: `src/screens/GameTableScreen.tsx`

Anchors: chat button `testID="game-btn-chat"` (Pressable ending ~line 1367);
share button `testID="game-btn-share-spectator"` (~1368-1385); spectator
count `testID="spectator-count"` (~1386); `ChatPanel` mount (~1692). The
`isDesktop`/`isTrueDesktop` hooks are defined at lines ~120-123.

- [ ] **Step 1: Import the hook + add `isDiscord`**

Add to the imports (near line 46 where `useIsDesktop` is imported):

```ts
import { useIsDiscordActivity } from '../hooks/useIsDiscordActivity';
```

After `const isTrueDesktop = useIsTrueDesktop();` (line ~123) add:

```ts
  const isDiscord = useIsDiscordActivity();
```

- [ ] **Step 2: Hide the chat button**

Wrap the entire chat `Pressable` (the one with `testID="game-btn-chat"`, from its opening `<Pressable` through its closing `</Pressable>` at ~1367) in `{!isDiscord && ( ... )}`. Read the block first to get the exact opening line, then wrap it.

- [ ] **Step 3: Hide share + spectator-count**

The share button condition (line ~1368) is currently:

```tsx
            {isMultiplayer && !isSpectator && !!room && !isScorekeeper && (
```

Change to:

```tsx
            {!isDiscord && isMultiplayer && !isSpectator && !!room && !isScorekeeper && (
```

The spectator-count condition (line ~1386) is currently:

```tsx
            {spectators.length > 0 && (
```

Change to:

```tsx
            {!isDiscord && spectators.length > 0 && (
```

- [ ] **Step 4: Suppress the ChatPanel mount**

The ChatPanel mount condition (line ~1692) is currently:

```tsx
        {isMultiplayer && !hideChat && (() => {
```

Change to:

```tsx
        {isMultiplayer && !hideChat && !isDiscord && (() => {
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors in `src/screens/GameTableScreen.tsx`.

- [ ] **Step 6: Run unit suite + lint (testID coverage)**

Run: `npm run test:unit && npm run test:lint`
Expected: unit passes; `test:lint` exit 0 (it never fails). The hidden buttons still render outside Discord, so their testIDs are not orphaned — confirm `test:lint` reports no new orphans for `game-btn-chat` / `game-btn-share-spectator` / `spectator-count`.

- [ ] **Step 7: Commit**

```bash
git add src/screens/GameTableScreen.tsx
git commit -m "feat(discord): hide chat, share, spectator chrome in Discord"
```

---

## Task 6: GameTableScreen — single-row hand fan in Discord

**Files:**
- Modify: `src/screens/GameTableScreen.tsx`

The hand (`testID="my-hand"`, CardHand at lines ~1676-1684) currently uses
`horizontal={false}` → `CardHand`'s 2-row grid. In Discord we want one
overlapping row (with the component's built-in horizontal scroll as the
natural fallback), and a shorter `handSection`.

- [ ] **Step 1: Switch CardHand to single-row in Discord**

The current call (lines ~1676-1684) is:

```tsx
                <CardHand
                  cards={vm.myPlayer.hand.map((c) => ({ id: c.id, suit: c.suit, rank: c.rank })) as any}
                  selectedCards={selectedCard ? [selectedCard] : []}
                  playableCards={playableCards.map((c: any) => c.id)}
                  dimUnplayable={isMyTurnPlaying}
                  onCardPress={handleCardPress}
                  size={isTrueDesktop ? 'huge' : 'tiny'}
                  horizontal={false}
                />
```

Change the last two props to:

```tsx
                  size={isDiscord ? 'tiny' : (isTrueDesktop ? 'huge' : 'tiny')}
                  horizontal={isDiscord}
                  cardOverlap={isDiscord ? vm.myPlayer.hand.length : undefined}
```

(`horizontal={isDiscord}` → in Discord, `horizontal` is true so `CardHand`
renders the single-row overlap+scroll mode; elsewhere it stays `false` =
the existing 2-row grid. `cardOverlap={hand.length}` drives the dynamic
tight overlap for 10 cards.)

- [ ] **Step 2: Shrink the handSection height in Discord**

The handSection wrapper (line ~1674) is currently:

```tsx
            <View style={[styles.handSection, { backgroundColor: colors.surface, borderTopColor: colors.accent, maxHeight: SCREEN_HEIGHT * 0.36 }]}>
```

Change `maxHeight` to be smaller in Discord (one row needs far less than two):

```tsx
            <View style={[styles.handSection, { backgroundColor: colors.surface, borderTopColor: colors.accent, maxHeight: SCREEN_HEIGHT * (isDiscord ? 0.20 : 0.36) }]}>
```

(0.20 is a starting value — Task 7 tunes it on a real device.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Run unit suite**

Run: `npm run test:unit`
Expected: all suites pass (no behavior change off-Discord).

- [ ] **Step 5: Commit**

```bash
git add src/screens/GameTableScreen.tsx
git commit -m "feat(discord): single-row hand fan in Discord"
```

---

## Task 7: On-device measure & tune (table footprint + ratios)

**Files:**
- Modify: `src/screens/GameTableScreen.tsx` (table styles / ratios only)

This is the measurement-dependent step the spec calls out. The table oval
lives in `styles.playArea` (line ~1601) / `styles.tableFelt` / `styles.tableEdge`.
After Tasks 5-6 most clipping should already be gone (2 rows → 1). This
task verifies on a real Discord window and tunes the remaining vertical
budget.

- [ ] **Step 1: Deploy the branch preview**

```bash
git push
```
Wait for the Vercel preview (branch alias `nigels-app-v2-git-feat-discord-e1ab61-akhmeds-projects-a51ec9bd.vercel.app`) to reach READY.

- [ ] **Step 2: Launch the Activity and observe**

Open the Activity on **desktop** Discord, start a hand. Confirm: the full
10-card hand is visible as one fanned row, no chat/share/spectator/FAB, no
top-inset gap. Note whether the table oval + hand still clip or fit.

- [ ] **Step 3: If still clipping, tune the table footprint**

Only if needed: in Discord mode reduce the table area's vertical footprint.
Read `styles.playArea` / `styles.tableFelt` / `styles.tableEdge` and the
`playArea` render (line ~1601). Apply a Discord-gated height reduction
(e.g. a smaller flex / maxHeight on the play area when `isDiscord`), and/or
nudge the `handSection` ratio from Step 6 (try 0.18-0.24). Make the change
Discord-gated so normal play is untouched. Surface the chosen ratios in the
commit message rather than leaving them unexplained.

- [ ] **Step 4: Re-verify on desktop AND phone**

Re-launch on desktop and on the phone (mobile Discord). Confirm a full hand
is comfortably visible and tappable on both.

- [ ] **Step 5: Typecheck + commit (if changed)**

Run: `npx tsc --noEmit`
Expected: no new errors.

```bash
git add src/screens/GameTableScreen.tsx
git commit -m "fit(discord): tune table+hand vertical budget for the Activity viewport (handSection <ratio>, playArea <ratio>)"
```

If Step 2 already fit with no tuning, record that in a no-op note and skip the commit.

---

## Task 8: Discord-native invite button

**Files:**
- Modify: `src/lib/discord/bootstrap.ts`
- Modify: `src/screens/GameTableScreen.tsx`

Replace the (now hidden) share affordance with Discord's native invite
dialog. The SDK is created in `bootstrap.ts` but not exposed.

- [ ] **Step 1: Expose the SDK from bootstrap**

In `src/lib/discord/bootstrap.ts`, store the constructed SDK in the
module scope and add a getter. Change `initDiscordSdk` so the `sdk` is kept:

```ts
let discordSdk: import('@discord/embedded-app-sdk').DiscordSDK | null = null;

// inside initDiscordSdk, after `const sdk = new DiscordSDK(clientId);`:
//   discordSdk = sdk;
// (assign before `await ...ready()`)

export function getDiscordSdk() {
  return discordSdk;
}
```

Apply the assignment: in `initDiscordSdk`, change

```ts
  const { DiscordSDK } = await import('@discord/embedded-app-sdk');
  const sdk = new DiscordSDK(clientId);
  await withTimeout(sdk.ready(), SDK_READY_TIMEOUT_MS, 'sdk.ready()');
```

to

```ts
  const { DiscordSDK } = await import('@discord/embedded-app-sdk');
  const sdk = new DiscordSDK(clientId);
  discordSdk = sdk;
  await withTimeout(sdk.ready(), SDK_READY_TIMEOUT_MS, 'sdk.ready()');
```

- [ ] **Step 2: Typecheck bootstrap change**

Run: `npx tsc --noEmit`
Expected: no new errors in `src/lib/discord/bootstrap.ts`.

- [ ] **Step 3: Add the invite button in Discord (GameTableScreen)**

In the top-bar button area (right after the hidden `game-btn-share-spectator`
block, ~line 1385), add a Discord-only invite button mirroring the share
button's styling:

```tsx
            {isDiscord && isMultiplayer && !isSpectator && !!room && !isScorekeeper && (
              <Pressable
                testID="game-btn-discord-invite"
                onPress={async () => {
                  try {
                    const { getDiscordSdk } = await import('../lib/discord/bootstrap');
                    await getDiscordSdk()?.commands.openInviteDialog();
                  } catch (e) {
                    console.warn('[Discord] openInviteDialog failed', e);
                  }
                }}
                accessibilityLabel="Invite"
                style={[
                  isDesktop ? styles.iconBtnLabeled : styles.iconBtn,
                  { backgroundColor: colors.iconButtonBg, borderColor: colors.glassLight },
                ]}
              >
                <Text style={{ fontSize: 18, color: colors.iconButtonText }}>➕</Text>
                {isDesktop && (
                  <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.iconBtnLabel, { color: colors.iconButtonText }]}>
                    Invite
                  </Text>
                )}
              </Pressable>
            )}
```

- [ ] **Step 4: Typecheck + new testID note**

Run: `npx tsc --noEmit`
Expected: no new errors.

Run: `npm run test:lint -- --update-todo`
This registers the new `game-btn-discord-invite` testID. Mention it in the final user message per CLAUDE.md.

- [ ] **Step 5: Verify in Discord (availability check)**

Push, redeploy preview, launch the Activity, tap the invite button.
- If the native invite dialog opens → done.
- If it throws an auth/authorization error (we're guest-only this track),
  **hide the button** (wrap so it doesn't render) and move the native-invite
  to the auth track — note this outcome in the commit/PR. Do not leave a
  button that errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/discord/bootstrap.ts src/screens/GameTableScreen.tsx tests/TEST_TODO.md
git commit -m "feat(discord): native invite dialog replaces share in Discord"
```

---

## Final verification (before any merge toward prod)

- [ ] Run `npm run smoke` — confirms the Discord gating didn't regress
  normal web play (everything is `isDiscordActivity()`-gated → false in the
  smoke browser, so chat/share/spectator/FAB/2-row hand all still render).
  Needs the `:8081` dev server; if it points at local Supabase, ensure the
  local stack is up first (prior spec's note) or the room-creating specs
  will hang. Expected: PASS (jest unit + 9 smoke + 2 desktop-layout).
- [ ] Visual pass inside a Discord Activity (desktop + phone): full hand
  visible, no clipped row, no Discord-redundant chrome, native invite works
  (or is hidden per Task 8 Step 5).

## Notes for the implementer

- Every change is `isDiscordActivity()`-gated; outside Discord the UI is
  byte-for-byte unchanged. Keep it that way — no ungated edits.
- Don't stage the post-frame-capture WIP (`GameTableScreen.tsx` ~1614 one-
  liner, `tests/TEST_TODO.md` unless you ran `--update-todo`, untracked
  `scripts/`, `assets/marketing/`).
- Resource limits: this is a 24 GB machine under memory pressure — don't run
  `sanity`/`demo` and don't keep dev servers alive across tasks.
