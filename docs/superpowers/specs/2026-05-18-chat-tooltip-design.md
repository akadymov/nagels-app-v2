# Player Chat Tooltip — design

**Date:** 2026-05-18
**Author:** Akula + Claude
**Status:** Approved, ready for implementation plan

## Goal

Surface incoming chat messages from other players without forcing the user to open the chat panel. A short, auto-dismissing tooltip appears above the sender's `profileCard`. Tapping the tooltip (or the underlying profile card) opens the chat.

This raises the social-presence ceiling during a game: a quick "nice play!" is seen even by someone whose chat is closed, without becoming a persistent visual element on the table.

## Non-goals

- No persistent unread badge on the avatar after the tooltip fades. The chat-icon unread counter already exists and is sufficient.
- No queueing or stacking of multiple messages — newer message replaces older.
- No tooltips for spectator-origin messages (no anchor on the table). The message still lands in `useChatStore` and in the global unread counter.
- No new realtime channel or DB schema.

## Behavior

| Aspect | Behavior |
| --- | --- |
| Trigger | New `chat` broadcast event where `payload.sessionId !== self.sessionId` AND sender is among current room `players[]` AND chat panel is currently closed. |
| Where | Absolutely-positioned bubble above the sender's `profileCard`. Wherever chat is supported: `WaitingRoomScreen`, `BettingPhase`, `GameTableScreen`, plus their desktop equivalents. |
| Duration | 5 seconds. Fade-in 150ms / fade-out 200ms. |
| Burst | A new message from the same sender **replaces** the body and **resets** the 5s timer. Different senders show independent tooltips simultaneously. |
| Preview | First 60 characters of `body`. If truncated, append `…`. Single line, `numberOfLines={1}`. |
| Tap target | The bubble itself. The underlying `profileCard` is intentionally **not** wired as a tap target — keeps the card free for future card-level interactions and avoids accidental opens when a user reaches for nearby UI. |
| Tap action | Mobile: open `<ChatPanel mode="modal">`. Desktop: `setChatVisible(true)` in the right pane (no-op if already visible). In both cases also call `chatTooltipStore.dismissAll()`. |
| Suppression | If the chat panel is already open at message-arrival time, do not show a tooltip — the user is already reading. |
| Player left mid-game | Listener checks membership in `useRoomStore.players` before calling `show()`. Out-of-room sender → skip. |
| Unmount cleanup | Listener's `useEffect` cleanup calls `dismissAll()` so stale timers don't fire after leaving the room. |

## Architecture

### New store: `src/store/chatTooltipStore.ts`

```ts
type Tooltip = { body: string; ts: number };

interface State {
  tooltips: Record<string, Tooltip>;   // keyed by sessionId
  show: (sessionId: string, body: string) => void;
  dismiss: (sessionId: string) => void;
  dismissAll: () => void;
}
```

Timers live in a **module-scope** `Map<string, ReturnType<typeof setTimeout>>` (not inside Zustand state, so the timers survive re-renders and are never serialized). `show()` clears any existing timer for that `sessionId`, sets a fresh 5s one whose callback calls `dismiss()`, then writes the new tooltip into the store. `dismissAll()` clears every timer and resets `tooltips` to `{}`.

Constant: `TOOLTIP_DURATION_MS = 5000`.

### New hook: `src/hooks/useChatToastListener.ts`

Mounted once per host screen (WaitingRoom, BettingPhase, GameTable, desktop counterparts). Signature:

```ts
useChatToastListener({
  selfSessionId: string | null,
  isChatOpen: boolean,
});
```

Implementation:
1. Subscribe to `useChatStore` via selector `(s) => s.messages[s.messages.length - 1]?.id`.
2. When this id changes, fetch the latest message via `useChatStore.getState()`.
3. Skip if: `msg.sessionId === selfSessionId`, OR `msg.fromSpectator === true`, OR `isChatOpen === true`, OR `msg.sessionId` is not among `useRoomStore.getState().players.map(p => p.session_id)`.
4. Otherwise call `useChatTooltipStore.getState().show(msg.sessionId, msg.body.slice(0, 60) + (msg.body.length > 60 ? '…' : ''))`.
5. On unmount: `useChatTooltipStore.getState().dismissAll()`.

### New component: `src/components/PlayerChatTooltip.tsx`

```ts
interface Props {
  sessionId: string;
  onPress: () => void;
}
```

- Subscribes to `useChatTooltipStore((s) => s.tooltips[sessionId])`.
- Renders an `Animated.View` with absolute positioning: `bottom: 100%, left: '50%', transform: [{ translateX: -50% }, { translateY: animatedY }], marginBottom: 4`.
- Animations: opacity 0→1 (150ms in) / 1→0 (200ms out); translateY 8→0 (in) / 0→4 (out). React Native `Animated` API — works in RN-Web.
- Body: `<Text numberOfLines={1}>{tooltip.body}</Text>` with `maxWidth: 200`.
- Wrap in `<Pressable onPress={onPress} testID={"chat-tooltip-" + sessionId}>`.
- Styling: rounded rectangle with `colors.surface` background, 1px `colors.glassLight` border, downward-pointing triangle (`▼` text node or `borderTop` trick) at bottom-center.
- Renders `null` when `tooltips[sessionId]` is undefined.

### Host-screen integration

Each screen that renders a player container gains:
1. Mount `useChatToastListener` once at top-level of the screen.
2. For every opponent `profileCard`, render `<PlayerChatTooltip sessionId={player.id} onPress={openChat} />` as a sibling inside the card's container (so `position: absolute` is relative to the card).
3. Do **not** wrap the user's own `profileCard`.
4. `openChat` resolution:
   - Mobile (`WaitingRoomScreen`, `GameTableScreen`, `BettingPhase`): call the existing `setChatOpen(true)` / equivalent setter that mounts `<ChatPanel mode="modal">`. The setter handler also calls `chatTooltipStore.dismissAll()`.
   - Desktop (`DesktopGameLayout`, `DesktopWaitingRoom`): call `setChatVisible(true)`. Same `dismissAll()` afterward.

A small helper `useOpenChat()` may centralize the "open + dismiss tooltips" idiom — decided during implementation if duplication becomes annoying.

## Files

New:
- `src/store/chatTooltipStore.ts`
- `src/hooks/useChatToastListener.ts`
- `src/components/PlayerChatTooltip.tsx`
- `src/store/__tests__/chatTooltipStore.test.ts`
- `tests/smoke/chat-tooltip.spec.ts`

Modified:
- `src/screens/GameTableScreen.tsx` — mount listener, wrap each opponent card, dismissAll on chat open.
- `src/screens/WaitingRoomScreen.tsx` — same pattern.
- `src/components/betting/BettingPhase.tsx` — same pattern.
- `src/screens/desktop/DesktopGameLayout.tsx` — same pattern.
- `src/screens/desktop/DesktopWaitingRoom.tsx` — same pattern.

No changes to `src/store/chatStore.ts`, `src/lib/realtimeBroadcast.ts`, Supabase functions, or DB.

## Test plan

### Unit (`src/store/__tests__/chatTooltipStore.test.ts`)

Use jest fake timers.

- `show()` adds an entry keyed by sessionId; timer fires after 5000ms and entry is gone.
- Calling `show()` again for the same sessionId before the timer fires replaces the body and resets the timer (advance 4s, second show, advance 4s — entry still present).
- `show()` for different sessionIds keeps independent entries and independent timers.
- `dismiss(sessionId)` removes the entry and clears its timer.
- `dismissAll()` clears every entry and every timer.

### Smoke (`tests/smoke/chat-tooltip.spec.ts`)

Single 2-player room, mobile viewport.
1. Players A and B join a room → land in WaitingRoom.
2. A sends `"hello"` via chat.
3. On B's page, assert `locator('[data-testid="chat-tooltip-${A.sessionId}"]')` becomes visible within 1s.
4. B taps the tooltip.
5. Assert `<ChatPanel>` is visible (`chat-input` testID), and that the message `"hello"` is in the list.
6. Assert tooltip is no longer in DOM.

A second smaller assertion: after step 3, wait 6s without interaction, assert the tooltip is gone (auto-dismiss).

The spec runs in the existing `npm run smoke` lane.

### What we explicitly don't test in smoke

- Desktop variant (covered by manual QA pre-merge; existing smoke suite doesn't have desktop multiplayer yet).
- Burst replacement (covered by unit test; smoke for this would be flaky on timing).
- Spectator suppression (no spectator harness in smoke yet).

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Tooltip overlaps cards in tight 6-player table layouts. | `maxWidth: 200`, `bottom: 100%` plus 4px margin. Manual QA on 6-player at 6.1" viewport before merge. If still tight, swap to top-anchor on bottom-half opponents (`clockPosition >= 6`). |
| Animated.View causes jank on low-end devices. | Use `useNativeDriver: true` for opacity/translate. Both are GPU-accelerated. |
| Race: tooltip rendered after sender leaves room. | Membership check at `show()` time. Late-render of an already-stored tooltip is acceptable (5s ceiling). |
| Memory leak from timers on hot reload. | Module-scope `Map` is the same instance across HMR; `dismissAll()` on unmount clears it. |
| Self-message echo (`broadcast: { self: true }`) leaks into our show path. | Explicit `msg.sessionId !== selfSessionId` guard in the listener. |

## Out of scope (future)

- Threaded reply from tooltip ("reply" affordance).
- Emoji-only "shoutout" mode (heart, "gg") with its own animation.
- Audio cue on tooltip appearance — would need a separate "notification sound" preference and is louder than this feature warrants.
