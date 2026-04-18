# Nägels Online - Product Team Meeting Minutes

**Date:** March 13, 2026
**Time:** 14:00 UTC
**Attendees:** [Vibe-Alpha], [Vibe-Beta], [Researcher], [Archi], [Dev], [Guard], [Shark-1], [Shark-2]
**Location:** Virtual War Room
**Facilitator:** Claude (Studio Lead)

---

## Agenda: Roadmap Planning - Next 2-3 Iterations

### Current State Assessment

**[Dev]**: Let's ground ourselves. The codebase is solid:
- Complete Nägels rules engine in `src/game/rules.ts` (623 lines, battle-tested)
- Zustand store with bot AI and multiplayer sync
- React Native/Expo stack with Supabase real-time
- i18n ready for EN/RU/ES
- Glass morphism components implemented

**[Guard]**: But we have gaps. Multiplayer sync is partially implemented but untested on real devices. The "30-second to play" vision isn't met - onboarding is missing. And I see ZERO disconnect recovery logic.

**[Vibe-Alpha]**: The mobile ergonomics need work. Card hand layout doesn't respect thumb zones. The betting UI modal blocks the table - players can't see opponents while betting.

---

## ITERATION 1: The "Playable MMP" Sprint

### Objective: Complete core gameplay loop with polish for closed beta

| Priority | Feature | Owner | Rationale |
|----------|---------|-------|-----------|
| **P0** | Primer Screen (30-sec rules) | [Researcher] | Core vision requirement |
| **P0** | Mobile hand re-layout (thumb-zone) | [Vibe-Alpha] | Unplayable on 6.1" screens currently |
| **P0** | Betting UI - slide-up vs modal | [Vibe-Beta] | Keep table visible during betting |
| **P1** | Bot AI personality tiers | [Shark-2] | "Computer" needs to scale from newbie to expert |
| **P1** | Real-time multiplayer end-to-end test | [Archi] + [Guard] | Verify Supabase sync, handle disconnects |

**[Researcher]**: The Primer needs to be interactive - not a wall of text. I'm thinking:
1. Show card rank animation (A > K > Q...)
2. Demonstrate trump hierarchy (J♥ > 9♥ > A♥ in trump suit)
3. Quick betting demo ("Someone must stay unhappy!")
4. 30-second timer, skip available

**[Shark-2]**: Bot tiers should be:
- **Rookie**: Makes random valid bets, plays cards randomly
- **Regular**: Current implementation (hand-strength based)
- **Shark**: Counts cards, tracks who's void in suits, leads trump strategically

---

## ITERATION 2: The "Home Game" Sprint

### Objective: Social features that mimic playing with friends

| Priority | Feature | Owner | Rationale |
|----------|---------|-------|-----------|
| **P0** | In-game chat (emoji + quick phrases) | [Vibe-Beta] | Essential for "home game" feel |
| **P0** | Waiting room lobby with ready system | [Dev] | Need this for multiplayer flow |
| **P1** | Video call integration (overlay) | [Vibe-Beta] | Differentiator vs other card games |
| **P1** | Player avatars + customization | [Vibe-Alpha] | Social identity |
| **P2** | Table skins/themes unlock | [Vibe-Beta] | Retention mechanic |

**[Vibe-Beta]**: Chat should be thumb-friendly quick phrases:
- "Nice play!" / "Too slow!" / "Whoops!" / "😱"
- Emoji reactions to tricks
- Limited text (to avoid toxicity)

**[Guard]**: Video call... risky on mobile data. Make it optional, OFF by default, and show bandwidth warning.

---

## ITERATION 3: The "Retention Polish" Sprint

### Objective: Onboarding, analytics, and "one more game" hooks

| Priority | Feature | Owner | Rationale |
|----------|---------|-------|-----------|
| **P0** | Guest-first auth (phone/email optional) | [Archi] | Frictionless entry requirement |
| **P0** | Basic analytics (funnel tracking) | [Archi] | Need data on where users drop off |
| **P1** | "Rematch" button flow | [Vibe-Alpha] | Critical for retention |
| **P1** | Game recap/share card | [Vibe-Beta] | Viral mechanic |
| **P1** | Push notifications for "your turn" | [Guard] | Async multiplayer later |
| **P2** | Achievements system | [Shark-1] | Engagement hooks |

**[Archi]**: Supabase auth supports phone natively. We'll implement:
1. Quick play → Anonymous account generated
2. Save progress prompt after 3rd game
3. Phone/email only for leaderboard (not required)

**[Shark-1]**: Achievements should reflect skill:
- "Sharpshooter" - Made exact bet 5 hands in a row
- "Trump Master" - Won 10+ tricks with J/9 of trump
- "Comeback Kid" - Won after being last place at halfway

---

## Technical Debt Flagged by [Guard]

1. **Disconnect Recovery**: Currently non-existent. If app backgrounds, state desyncs on return.
2. **State Conflicts**: No conflict resolution for simultaneous actions in multiplayer.
3. **Memory Leaks**: Suspected in game store - no cleanup on unmount.
4. **Test Coverage**: Zero unit tests for rules engine.

> **Verdict**: [Guard] assigns **Blocker** status to #1 and #2 before open beta.

---

## Cross-Cutting Concerns

### Mobile Performance ([Archi])
- Current bundle: ~2.3MB (acceptable)
- Need lazy loading for video call SDK
- Consider Hermes for Android

### i18n Gaps ([Researcher])
- All hardcoded English text in logs/alerts
- Missing context for "trump" vs "notrump" in Russian
- Spanish card rank names not localized

### Accessibility ([Vibe-Alpha])
- Screen reader support: ZERO
- Haptic feedback: Only on button press, missing on card play
- Color contrast: Trump indicators fail for red-green colorblind

---

## Decision Log

| ID | Decision | Votes |
|----|----------|-------|
| D-001 | **Defer video call to Iteration 3** - focus on chat first | Unanimous |
| D-002 | **Bot tiers** ship only Rookie + Regular in v1 | 7-1 ([Shark-2] dissented) |
| D-003 | **Supabase stays** - no migration to custom WebSocket | Unanimous |
| D-004 | **Primer is skippable** - don't gate gameplay | Unanimous |
| D-005 | **Guest-first** - no forced sign-up ever | Unanimous |

---

## Action Items

| Owner | Task | Due |
|-------|------|-----|
| [Dev] | Refactor betting to slide-up panel | Iteration 1 Week 1 |
| [Researcher] | Wireframe primer screens (interactive) | Iteration 1 Week 1 |
| [Vibe-Alpha] | Thumb-zone card hand prototype | Iteration 1 Week 2 |
| [Guard] | Design disconnect recovery flow | Iteration 1 Week 2 |
| [Archi] | Supabase multiplayer stress test (4 clients) | Iteration 1 Week 2 |
| [Shark-2] | Implement Rookie bot AI | Iteration 2 Week 1 |

---

## Risks & Mitigations

| Risk | Impact | Mitigation | Owner |
|------|--------|------------|-------|
| Supabase latency >200ms | HIGH (game feels laggy) | Client-side prediction + rollback | [Archi] |
| Rules bug discovered post-launch | CRITICAL | Comprehensive test suite first | [Dev] |
| Users don't understand trump hierarchy | MED | Primer emphasizes this | [Researcher] |
| Video call kills battery | HIGH | Make optional + warning | [Guard] |

---

## Next Steps

1. **[Dev]** to create Iteration 1 tickets by EOD
2. **[Vibe-Alpha]** to prototype thumb-zone hand by Friday
3. **[Archi]** + **[Guard]** pair on multiplayer stress test Thursday
4. Full team standup: **Monday 10:00 UTC**

---

## Notes

- [Shark-1] was muted for 15 min due to bad connection - missed betting UI discussion
- Legacy app (Svelte) still has edge cases not ported - need audit
- Spreadsheet requirements from 2023 may be stale - needs review

**Meeting adjourned at 15:47 UTC**

---

*Minutes recorded by Claude Studio Lead*
*Next meeting: March 20, 2026 - Iteration 1 Retro*
