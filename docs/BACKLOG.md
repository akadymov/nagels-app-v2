## Tech Debt

### [tech][engine][HIGH][PRIORITY-NEXT] Под-козыривание на all-trump руке не запрещено (2026-05-30)

  - defaultExpanded: false
    ```md
    `supabase/functions/_shared/engine/rules.ts:281,318` — правило «нельзя класть младший козырь, чем уже лежащий старший» (`cardRank < highestPlayed.rank && leadCard.suit !== trumpSuit && hasNonTrump`) проверяется ТОЛЬКО при `hasNonTrump` (на руках есть некозырные карты). Если у игрока на руках ОДНИ козыри — движок разрешает «слить» младший козырь, даже когда на руке есть козырь, которым можно перебить. По каноническому правилу Nägels перебивать обязан, если есть чем: нельзя класть младший козырь, пока есть либо некозырная карта, либо козырь старше уже лежащего.

    Сценарий-репро: lead = ♥ (не козырь), козырь = ♠, в взятке уже лежит Q♠. Рука игрока — только ♠: K♠ и 9♠ (нет некозырных). `hasNonTrump=false` → движок разрешает 9♠ (под-козыривание), хотя K♠ обязан перебить.

    Fix: при выборе козыря, когда lead не козырь и старший козырь уже лежит, добавить ветку «если в руке есть козырь старше `highestPlayed`, то любой козырь ниже него — нельзя» — независимо от `hasNonTrump`. Т.е. условие блокировки: `cardRank < highestPlayed.rank && leadCard.suit !== trumpSuit && (hasNonTrump || hasHigherTrumpThan(highestPlayed))`. Покрыть юнит-тестом обе ветки (`rules.test.ts`). ВАЖНО: игровая логика immutable (CLAUDE.md) — сверить с legacy `info_en.html` перед правкой, чтобы не разойтись с каноном.

    Связано с задачей «Инструкции для оффлайн игры» (`docs/superpowers/specs/2026-05-30-offline-game-instructions-design.md`) — текст правила `offline.rules.noDumpTrump` уже описывает корректное поведение, движок его недоисполняет в краевом случае.
    ```

### [tech][security][HIGH] Revoke switch_role RPC from anon (2026-05-26)

  - defaultExpanded: false
    ```md
    `supabase/migrations/20260524000000_switch_role.sql:142` грантит EXECUTE на `switch_role` для роли `anon`. Защищено внутренним `auth.uid() IS NULL → auth_failed`, но это формальный регресс относительно других RPC (transfer_rating, get_my_active_room, can_announce_telegram — все `TO authenticated` только). Fix: миграция с `REVOKE EXECUTE ON FUNCTION public.switch_role(...) FROM anon;`.
    ```

### [tech][security][HIGH] Stop logging user email in authService (2026-05-26)

  - defaultExpanded: false
    ```md
    `src/lib/supabase/authService.ts:96, 128, 155` — `console.log('[AuthService] Signed in as', data.user.email)`. PII в браузерных devtools и любых remote log sinks. Fix: либо логать только `data.user.id`, либо маскировать local-part: `email.replace(/(.).+(@)/, '$1***$2')`.
    ```

### [tech][security][MEDIUM] adminGrantTelegram: validate target_user_id exists (2026-05-26)

  - defaultExpanded: false
    ```md
    `supabase/functions/game-action/actions/adminGrantTelegram.ts:22-25`. Upsert проходит для любого UUID, FK к auth.users падает 500. Не security-дыра, но operational шум. Fix: предварительный select через `get_auth_user_info`, возврат `{ok:false, error:'user_not_found'}`.
    ```

### [tech][security][LOW] release-announce.txt в корне репо (2026-05-26)

  - defaultExpanded: false
    ```md
    Untracked, без секретов, но `git add .` подцепит. Fix: добавить `release-*.txt` в `.gitignore` или перенести в `docs/releases/`.
    ```

### [tech][arch][R1][HIGH] Split GameTableScreen.tsx (2407 строк) на слои (2026-05-26)

  - defaultExpanded: false
    ```md
    44 хука, 14-dep VM `useMemo` на 250 строк, geometry-математика inline (clockToScreen, getPlayerCardOffset), trump-таблицы цветов, ~10 модалок условно отрендеренных в одном return. Каждое изменение фичи трогает этот файл. Target: (a) `useGameTableVM(snapshot, isMultiplayer)` хук в `src/screens/gameTable/useGameTableVM.ts`; (b) presentational компоненты `<TopBar>`, `<TableSurface>`, `<MyHandTray>`, `<TrickOverlay>`, `<BannersStack>` по ≤200 строк; (c) `GameTableScreen` — ~150-строчный оркестратор. Geometry → pure functions в `src/screens/gameTable/geometry.ts`. Effort: 2-3 дня, слайсами. Самый высокий pay-off в репо.
    ```

### [tech][arch][R2][HIGH] Унифицировать «direct RPC vs edge action» (2026-05-26)

  - defaultExpanded: false
    ```md
    Сейчас `placeBet/playCard` идут через edge function, а `switchRole/setMinCardsPerHand/joinRoomAsSpectator/transferRating` — direct-to-RPC. Direct-RPC обходят broadcast в `supabase/functions/game-action/index.ts:138-142`, поэтому другие клиенты узнают об этих мутациях только через heartbeat/reload. Правило: «любая мутация RoomSnapshot → через game-action». Effort: 1 день, обёртки вокруг существующих PL/pgSQL RPC. Pay-off: устраняет целый класс «почему не пропагировалось?» багов.
    ```

### [tech][arch][R3][HIGH] Убрать is_connected boolean → derive из last_seen_at (2026-05-26)

  - defaultExpanded: false
    ```md
    `room_players.is_connected` ставится в true heartbeat'ом, но НИКОГДА не сбрасывается обратно — был тот самый live-баг 2026-05-26 с host-left rescue. Сейчас 7 разных RPC дублируют фильтр по `last_seen_at` (`20260520180000_filter_stale_spectators.sql`, `20260522080000_expose_avatar_url.sql` и др). Target: дроп колонки, derive через SQL view или helper `now() - last_seen_at < interval '15s'`. Effort: 0.5 дня. Снапшот-тип `_shared/types.ts:77` не меняется. Pay-off: фиксит баг структурно, киляет 3-5 будущих миграций.
    ```

### [tech][arch][R4][MEDIUM] Унифицировать SP+MP через useTableVM адаптер (2026-05-26)

  - defaultExpanded: false
    ```md
    `gameStore.ts` (841 строк, SP-движок) vs `roomStore.ts` (29 строк, MP-снапшот). Каждый экран (`GameTableScreen.tsx`, `BettingPhase.tsx`, `ScoreboardModal.tsx`) ветвится `if (isMultiplayer) ... else ...` ~250 строк суммарно plumbing'а. Target: один `useTableVM()` хук, всегда возвращающий ту же `GameVM` форму через `adaptSnapshot()` / `adaptSp()`. Effort: 1-1.5 дня. Парится с R1.
    ```

### [tech][arch][R5][MEDIUM] Broadcast пушит сам snapshot вместо refetch (2026-05-26)

  - defaultExpanded: false
    ```md
    Сейчас: server мутация → `{event:'state_changed', version}` → каждый клиент делает `gameClient.refreshSnapshot(room_id)` = 2 RPC roundtrip × N игроков. Target (cheap): broadcast несёт `{version, state}` в payload, не-actor'ы делают `applySnapshot` напрямую. `my_hand` re-fetch можно пропускать для большинства action'ов. Effort: 0.5 дня. Pay-off: -150-400мс perceived latency, ~3× меньше snapshot-чтений.
    ```

### [tech][arch][cleanup] Console.* (98 вызовов) → logger.ts (2026-05-26)

  - defaultExpanded: false
    ```md
    98 `console.log/warn/error` в `src/`, 5 в edge функциях. Обернуть в `logger.ts` с level + structured fields. Делает будущий Sentry/Datadog hook one-line change.
    ```

### [tech][arch][cleanup] Type RootStackParamList properly — kill 35 `as any` в AppNavigator (2026-05-26)

  - defaultExpanded: false
    ```md
    `AppNavigator.tsx` — 35 `as any`, в основном на `navigation.navigate(...)`. Прописать `RootStackParamList` один раз и удалить касты. Effort: 1-2 часа.
    ```

### [tech][arch][cleanup] Typed payload parser в gameClient вместо `as any` (2026-05-26)

  - defaultExpanded: false
    ```md
    `src/lib/gameClient.ts:94-104, 292, 305, 312, 322` — server payloads парсятся через `data as any` без narrowing'а. Если сервер изменит форму ответа, TS промолчит — runtime сломает где-то ниже. Fix: маленький validator (zod или ручной guard) на границе. Покрывает Rating, Telegram, getMyActiveRoom RPC.
    ```

### [tech][arch][cleanup] Расхардкодить список языков в переключалках (2026-05-26)

  - defaultExpanded: false
    ```md
    Сейчас при добавлении нового языка в `src/i18n/config.ts` (resources + languages map) приходится вручную дописывать его в двух местах с хардкодом — иначе кнопка не появится в UI. На примере добавления `fr` (commit 4cfefce): пришлось править `WelcomeScreen.tsx:172` (`['en','ru','es']` → `['en','ru','es','fr']`) и `SettingsBody.tsx:512-515` (массив `{key,label}` с native-именами). Один из этих хардкодов был забыт при первом проходе, FR-кнопка не появилась в Profile/Settings — обнаружилось только глазами.
    
    Канонический источник уже есть — `languages` map в `src/i18n/config.ts` с полями `code` и `nativeName`. Два других компонента уже используют его правильно:
    - `src/components/LanguageSwitcher.tsx:41-42` — `Object.keys(languages).map(...)` + `languages[code].nativeName`
    - `src/components/DesktopWelcomePane.tsx:220-236` — то же
    
    Fix: переписать `WelcomeScreen.tsx:170-189` и `SettingsBody.tsx:510-521` на тот же паттерн (`Object.keys(languages)` + `languages[code].nativeName`). После этого добавление нового языка = одна правка в `config.ts` + один новый `.json` файл, без правок UI-компонентов. Effort: 30 мин, риск минимальный (механический рефакторинг).
    
    Дополнительно: вынести подпись `Language / Язык / Idioma / Langue` в `LanguageSwitcher.tsx:39` тоже сделать derived — `Object.values(languages).map(l => l.nativeName).join(' / ')`. Иначе при добавлении языка эту строку тоже придётся править руками.
    ```

### Удалить ненужное поле Users.Display Name

  - defaultExpanded: false

## Backlog

### Resizable desktop side panels (Akula, 2026-05-26)

  - defaultExpanded: false
    ```md
    На десктопе боковые панели (чат, профиль, last trick, scoreboard) фиксированной ширины. Сделать их ресайзабельными: drag-and-drop за внутреннюю границу левого/правого контейнера. Сохранять ширину в `useSettingsStore` (per-panel, per-side), чтобы переживало reload. Реализация: тонкий компонент-разделитель `<PanelResizer side="left" min={240} max={520} onResize={…} />` внутри `DesktopGameLayout.tsx`; клампить до viewport-минус-центральная зона стола; только web (touch-устройства оставляем со статическими ширинами).
    ```

### Mid-game settle при уходе игрока в рейтинговой партии (Akula, 2026-05-26)

  - defaultExpanded: false
    ```md
    Сейчас если игрок уходит посреди рейтинговой партии — никому ничего не начисляется, ставка просто развязывается (`leaveRoom.ts:77-100` сбрасывает раздачу, settle не вызывается). Это плюс — нельзя «зафиксировать выгодный счёт уходом», но и минус — у тех, кто остался, нет защиты от намеренного бросания партии тем, кто проигрывает.
    
    Идея: при уходе игрока из рейтинговой партии (после N сыгранных раздач? после первой?) автоматически провести расчёт «здесь и сейчас» вместо обнуления. Два варианта на выбор:
    
    Вариант A — фиксированный штраф. У уходящего списывается фиксированное число рейтинговых очков (например, текущая `stake × player_count`), и эта сумма делится поровну между оставшимися. Простая, предсказуемая механика. Подходит для борьбы с tilt-уходами.
    
    Вариант B — досрочный settle по текущим очкам. Берём накопленные `hand_scores` на момент ухода, прогоняем тот же `computeSettlement(inputs, stake)` из `_shared/engine/stakes.ts`, и записываем дельты как сегодня. Если уходящий проигрывал — он платит, остальные забирают. Если выигрывал (редкий, но возможный сценарий) — он получает свою долю, остальные платят (нечестно к ним? обсуждать).
    
    Связанные открытые вопросы:
    - Применять только при намеренном уходе (Leave button) или и при disconnect'е? Скорее всего нужен grace period (60-120с) для disconnect'а перед триггером settle.
    - С какого момента партия «достаточно сыграна» для settle? После hand 1? После hand 5? До этого — поведение как сегодня.
    - Что если уходит не один игрок, а сразу несколько (group rage quit)?
    - Как взаимодействует с заморозкой партии (см. соседний пункт): если хост успел заморозить — settle не триггерится; если игрок убежал до заморозки — триггерится.
    - UX: уходящему показать модалку «Уход из рейтинговой партии: с тебя спишется N очков. Подтвердить?» — чтобы не было неожиданности.
    
    Связано с [[Заморозка партии хостом]] (это альтернативный путь — не пауза, а расчёт).
    ```

### Post-game scoreboard + "Play again" on host exit (Akhmed, 2026-05-16)


### Screenshots in feedback form (PopovIsNit, 2026-05-08)


### Push notifications — follow-ups


### Player stats — game history, win rate, exact bid percentage


### Leaderboard — global rankings


### Discord integration

First playable Activity test DONE (2026-06-14, branch `feat/discord-activity`, app id `1515717699928588458`): loads + playable in Discord (desktop, bots verified). Remaining follow-up work:

- **Hide in-game chat in Discord** — redundant with the channel's own voice/text; gate chat UI on `isDiscordActivity()`. Also frees vertical space (helps the layout item below). Small.
- **Layout / card-visibility adaptation** — Discord's viewport differs (even on desktop); fixed safe-area insets + offsets clip the cards. Add a `useIsDiscordActivity` hook (mirror `useIsDesktop`) threaded through `App.tsx` (drop top safe-area inset, suppress PWA/push prompts), `AppNavigator` (hide feedback FAB), `GameTableScreen` (top-bar relayout + recompute hand-section height for the real Activity viewport). Needs measurement on a real device. Medium.
- **Auth — stop the double login** — user is already authenticated in Discord but we still show our own auth. Quick level: Embedded SDK `authorize()` → `authenticate()`, play as guest with Discord nick+avatar (additive over the anonymous Supabase session). Full level (separate, bigger): link Discord identity to a persistent game account (store `discord_id` ↔ account, rating continuity). Most important per Akula.
- **Discord-native invite** — hide our share/spectator-share links in Discord (external links are out of place there); replace with the Embedded SDK's native `commands.openInviteDialog()` so players are invited straight into the Activity session via Discord. Small; can ride along with the UI track or be its own item.
- **Leave/exit lifecycle in Discord** — the abrupt-exit path differs from the browser. Browser leans partly on `beforeunload`, which may not fire reliably inside the Discord iframe. Good news: the freeze mechanism keys off heartbeat staleness (`heartbeat.ts` → `hostAbsent` → freeze), which is transport-agnostic — closing the Activity stops heartbeats → others detect absence → party freezes. So the safety net likely already works. TODO: subscribe to Embedded SDK lifecycle events (Activity close / channel participant changes) so an abrupt exit triggers the same graceful-leave path immediately instead of waiting out the staleness window. Keep the explicit `leaveWithConfirm` flow as-is. Part of the deeper sync/auth phase, not the UI track.
  - **Bug observed 2026-06-15 (desktop Discord): opening the Discord channel chat resets the game.** Hypothesis: the chat panel shrinks the Activity width below the `useIsDesktop` 1024px breakpoint → layout flips (desktop two-pane ↔ mobile) → the game screen REMOUNTS → an in-memory BOT/offline game (not server-persisted) is lost. Real multiplayer likely survives (state is server-side + rejoin), but VERIFY. Fix options: preserve game state across the breakpoint flip (lift/persist offline game state so it survives remount), avoid remounting on breakpoint change, or pin/relax the layout breakpoint inside a Discord Activity. Fix in this leave/exit + session-sync track.
- **Update legal drafts before verification** — ToS + Privacy Policy drafts exist at `docs/legal/terms-of-service.draft.md` and `docs/legal/privacy-policy.draft.md` (marked DRAFT, with `[OPERATOR]`/`[JURISDICTION]`/`[CONTACT_EMAIL]`/`[EFFECTIVE_DATE]` placeholders). Do this AFTER all technical Discord integration is finished: fill placeholders, sync the docs with the final data flows (esp. Discord auth + account linking), host them at stable URLs (e.g. `nigels.online/terms` + `/privacy`), and put those URLs in the Developer Portal. Required for Activity verification (public launch); not needed while unverified (testers only, servers <25 members).

### Sound effects — card played, bonus earned, turn notification


### Lobby chat — general chat for finding players and socializing


### Video/voice chat — "home game" atmosphere during multiplayer


### Table/skin customization — visual themes


## Next Up

### Хост: «Покинуть комнату» после конца игры возвращает в комнату, а не в лобби (Akula via feedback, 2026-05-30)

  - defaultExpanded: false
    ```md
    После завершения партии хост нажимает «Покинуть комнату», но попадает обратно в комнату вместо лобби. Ожидается: по окончании игры нажатие Leave у хоста ведёт в Lobby.

    Отличается от соседних пунктов: «Post-game scoreboard + Play again on host exit» — про сам пост-игровой scoreboard / Play Again; «Host leaves WaitingRoom → kick everyone to lobby» (Done) — pre-game сценарий. Здесь именно пост-игровой Leave хоста, который ошибочно ре-входит в комнату вместо навигации в лобби.

    Где смотреть: обработчик Leave на пост-игровом экране (ScoreboardModal `onLeaveRoom` / GameTableScreen `handleLogoLeave`) при `room.phase='finished'` — после `leaveRoom` нужна навигация в Lobby, а не повторный вход/остаток в комнате.
    ```

### Никнейм анонима из лобби не применяется в комнате до «Done» в настройках (Akula via feedback, 2026-05-30)

  - defaultExpanded: false
    ```md
    Аноним (или только что зарегистрированный, ещё не залогиненный) вводит никнейм в лобби и заходит в комнату — но остальным участникам он показывается старым/дефолтным до тех пор, пока игрок не откроет настройки и не нажмёт «Done» у display-никнейма (что триггерит edge-action `set_display_name`). То есть в настройках имя есть, а в игре — нет, пока вручную не подтвердишь.

    Ожидается: никнейм, введённый в лобби, сразу применяется к `room_sessions.display_name` при join и виден всем.

    Связано с «Guests can change visible nickname during the game» (Done) — там пробросили settings-save через `set_display_name`, но join-time имя из лобби по-прежнему не попадает в `room_sessions`. Fix: при join подставлять лоббийный никнейм в `display_name` (или сразу после join дёргать тот же `set_display_name`), без ручного Done.
    ```

## In Progress

### WaitingRoom — preserve membership across page refresh (Akula via feedback, 2026-05-20)

  - defaultExpanded: false
    ```md
    Если обновить страницу в не стартовавшей игре (WaitingRoom), пользователя выкидывает из комнаты. Похоже, refresh пересоздаёт anon-сессию и связь с room_players / room_spectators теряется. Нужно сохранять roomCode в localStorage и тихо вступать обратно при mount, либо матчить по auth_user_id в SQL и переставлять session_id у существующей записи.
    ```

### Заморозка партии хостом — pause & resume для рейтинговых игр (Akula, 2026-05-26)

  - defaultExpanded: false
    ```md
    Хост может «заморозить» текущую партию (особенно важно для рейтинговых) — снапшот state'а сохраняется, и партию можно возобновить позже при условии, что вернулся тот же состав игроков. Зачем: сегодня если кому-то надо отойти (еда, дети, работа), партия либо тянется, либо прерывается с потерей прогресса. На рейтинге это особенно болезненно — ставка либо «висит» в воздухе, либо никому ничего не начисляется (см. поведение `continueHand.ts:40-105` — settle только при естественном финише).
    
    Идея: кнопка «Заморозить партию» доступна только хосту, в любой момент после старта. Эффект: room.phase → 'paused' (новый), `paused_at`/`paused_lineup` (session_ids) фиксируются. Все игроки видят экран «Партия заморожена хостом — ждём <N> игроков». Любой игрок может уйти/вернуться без штрафа. Возобновление: когда все участники из `paused_lineup` снова в комнате, хост видит кнопку «Продолжить партию». Если за TTL (предложить 24-48ч?) не собрались — партия списывается, рейтинг не трогается (как сегодня при прерывании).
    
    Связанные открытые вопросы:
    - Можно ли продолжить, если кто-то из исходного состава недоступен? Голосование оставшихся? Замена ботом с пометкой «играет за <name>»?
    - Что со ставкой — остаётся залоченной (`stake_locked: true`) на время паузы или развязывается?
    - Если хост не возвращается за TTL — кто получает контроль? Auto-promote второго eligible игрока?
    - Hand-in-progress: пауза только между раздачами или прямо посреди трюка тоже?
    
    Связано с [[Mid-game settle при уходе игрока в рейтинговой партии]] (альтернативный сценарий — не пауза, а досрочный расчёт).
    ```

## Done

### Затемнять нелегальные карты в руке в момент хода (Akula, shipped 2026-06-07)

  - defaultExpanded: false
    ```md
    В свой ход карты, которыми нельзя пойти по правилам, теперь блёклые (opacity 0.4) и непрожимаемые — легальные стоят полной яркостью. Вне хода / когда легальна вся рука — рука в обычном виде.
    Реализация оказалась как и предсказано — presentational: новый проп `dimUnplayable` у `<CardHand>` (`src/components/cards/CardHand.tsx`); когда он true, карты не из `playableCards` рендерятся с `disabled` у `PlayingCard` (уже даёт opacity 0.4 + non-pressable). В `GameTableScreen.tsx` проброшено `dimUnplayable={isMyTurnPlaying}` — существующий гейт «сейчас мой ход», так что вне хода ничего не гасится; `BettingPhase` не затронут (проп по умолчанию false).
    Проверено: tsc clean; `npm run smoke` без регрессий (9/4 — те же фикстурные registered-фейлы, что и в baseline); визуально через SP quick-match — при lead ♥ легальны только черви (K♥/10♥/3♥, opacity 1.0), остальные (8♣/6♣/5♣/3♣/10♠) затемнены (opacity 0.4), баннер «Your turn / Must follow ♥».
    Возможные follow-ups (не делали): анимация перехода dim↔normal при смене хода; десатурация вдобавок к opacity для дальтоников.
    ```

### Pre-post security pass: CORS allowlist, feedback RLS, email-oracle throttle, drop legacy migrations (2026-06-06)

  - defaultExpanded: false
    ```md
    Четыре находки из аудита 2026-05-26 закрыты одним заходом перед публичным постом.
    (1) CORS: `_shared/cors.ts` теперь эхо-список разрешённых origin'ов (`nigels.online`, `localhost:8081/8082`, `*.vercel.app`) + `Vary: Origin` вместо `*`; неизвестный origin откатывается к prod-origin. `req` пробрасывается явно через локальные `respond`/`preflight` в трёх index (module-level мутабельный origin небезопасен под Fluid Compute).
    (2) Feedback RLS: миграция `20260606000000_feedback_insert_policy.sql` — `feedback_insert_anyone WITH CHECK (true)` → `feedback_insert_own WITH CHECK (player_id IS NULL OR player_id = auth.uid())`. Закрывает подмену чужого player_id. IP/session-throttle оставлен как отдельный follow-up.
    (3) Email-oracle: миграция `20260606000100_rpc_throttle.sql` — таблица `rpc_throttle` (RLS on, без политик) + хелпер `rpc_throttle_check(fn,max,window)`; `lookup_rating_recipient` переведён STABLE→VOLATILE и ограничен 30 вызовов/10 мин, возвращает `{ok:false,error:'rate_limited'}`. Клиент: новый i18n-ключ `transferRating.error.rateLimited` (en/ru/es/fr) + обработка в `TransferRatingModal`.
    (4) Удалён `supabase/migrations.legacy/` (26 файлов) — всё в baseline, только сбивал с толку.
    ⚠️ Бэкенд-эффект только после деплоя: `supabase db push` (2 миграции) + `supabase functions deploy game-action push-subscribe push-unsubscribe` (CORS). До деплоя находки на проде ещё открыты.
    ```

### Инструкции для оффлайн игры (Akula, shipped 2026-05-31)

  - defaultExpanded: false
    ```md
    Динамические подсказки в scorekeeper-режиме. Экран ставок: всегда раскрытая карточка-брифинг (козырь + раздающий, рассадка/порядок хода с ▶ первым и 🃏 раздающим, сколько карт сдать, кто ходит первым, сворачиваемые краткие правила — включая «нельзя слить козырь» и исключение-валет). Экран ввода взяток: инструкция «разыграйте раздачу до конца и посчитайте взятки» + те же краткие правила. Сопутствующие баги: таймер хода выключен в scorekeeper, карточный стол не мелькает между экранами; баг «0 игрока» над селектором ботов закрыт (дефолт 4). Несколько итераций по фидбэку. Спека/план: `docs/superpowers/specs|plans/2026-05-30-offline-game-instructions*`. Открытый связанный долг: `[engine][HIGH]` под-козыривание на all-trump руке.
    ```

### Change the copy above the number of player selector (shipped 2026-05-31)

  - defaultExpanded: false
    ```md
    Вкладка «Боты» теперь открывается с предвыбранными 4 игроками — лейбл сразу осмысленный («4 игрока»), странного «0 игрока» больше нет (`LobbyScreen.tsx`, дефолт `playerCount = 4`).
    ```

### Active turn highlight — gradient fill + screen pulse (Akula, 2026-05-08)


### Cross-device user sessions

  - defaultExpanded: false
    ```md
    Надо сделать так, чтобы пользователь зайдя с другого устройства при логине попадал в ту игру или комнату, в которой он был, будучи залогиненным на другом устройстве. То есть чтобы полноценно поддерживалась кросс-девайс игра.
    ```

### Leave-room rescue when host already left (Akula, 2026-05-26)

  - defaultExpanded: false
    ```md
    Если хост вышел из комнаты, а другие игроки застряли внутри (например на frozen-руке, которая не авто-резолвилась) — выйти невозможно, кнопка Leave доступна только хосту. Сделать страховку: показывать Leave обычным игрокам, когда хост уже вышел. Условие в WaitingRoomScreen / GameTableScreen: рендерить контрол выхода если `host_session_id IS NULL` или строка хоста в `room_sessions` отсутствует/disconnected, независимо от сидения зрителя.
    ```

### Email-confirmed redirect — extra screen on confirm (Dima via Akula, 2026-05-08)


### Spectator ↔ Player toggle in WaitingRoom (Akula, 2026-05-24)

  - defaultExpanded: false
    ```md
    В моменты пауз между играми (rooms.status в waiting или finished) разрешить переключение роли spectator↔player. Правила: обычный пользователь конвертирует только себя; хост — любого, кроме себя. Во время активной игры (playing) переключения запрещены. RPC switch_role с server-side проверками auth + state + capacity, бамп rooms.version → broadcast. UI: маленькая toggle-иконка на player/spectator chip.
    ```

### Share spectator link from BettingPhase and desktop (Akula, 2026-05-24)

  - defaultExpanded: false
    ```md
    Сейчас share-spectator есть только в mobile-WaitingRoom и mobile-GameTable. Добавить ту же кнопку в DesktopWaitingRoom, DesktopGameLayout (десктопный игровой стол) и BettingPhase (mobile+desktop) — хост должен мочь пригласить зрителя из любого in-game экрана и из любой layout-версии.
    ```

### Turn timebank — countdown until auto-play (Akula, 2026-05-16)


### Unify Profile + Lobby on desktop — drop standalone Lobby route, in-game gear opens Profile in left sidebar alongside Score / Last Hand (Akula, 2026-05-17)


### GameTable desktop — gear icon opens Profile as bottom-sheet instead of toggling left pane (Akula via feedback, 2026-05-23)

  - defaultExpanded: false
    ```md
    На десктопе в игровой комнате клик по шестерёнке открывает Profile снизу как bottom-sheet модалку. Должно: тот же клик переключает (show/hide) Profile+Settings в левой боковой панели (рядом с Score / Last Hand), как остальные desktop-кнопки топ-бара. Связано с задачей "Unify Profile + Lobby on desktop".
    ```

### Profile/Settings — replace toggle-row labels with BrandSwitch (Akula, 2026-05-23)

  - defaultExpanded: false
    ```md
    Текущие переключатели «Вибрация», «Уведомления» в профиле и Settings отображаются как текстовые «Включено/Выключено» (Pressable + label). Перевести на компонент `<BrandSwitch>` (создан в этой ветке, src/components/BrandSwitch.tsx) — он уже использует brand-blue accent для on, серый для off, и работает на iOS/Android/Web одинаково. Заодно убрать ручную локализацию строк «Вкл/Выкл» если они станут лишними. Затронутые экраны: ProfileScreen, SettingsBody.
    ```

### Detailed scoreboard desktop — first-player icon stuck on the left across all rounds (Akula via feedback, 2026-05-22)

  - defaultExpanded: false
    ```md
    На десктопе в детализированном счёте иконка первого игрока всегда находится слева во всех раундах — то есть отображает неверную информацию о том, кто начинал раздачу. Должна сдвигаться по реальной ротации (как в brief-варианте / в соответствии с ▶ first player).
    ```

### BettingPhase desktop — chat opens from bottom, not from side (Akula via feedback, 2026-05-22)

  - defaultExpanded: false
    ```md
    На десктопе в мультиплеере на экране ставок нажатие кнопки чата открывает чат снизу, а не сбоку. Поведение должно совпадать с GameTable, где чат на десктопе открывается в боковой панели.
    ```

### Conditional stakes — opt-in rating wager per game + admin reset tools (Akula, 2026-05-23)

  - defaultExpanded: false
    ```md
    Хост перед стартом выбирает ставку 0/1/5/10/25; каждый eligible (email-confirmed / Google) игрок opt-in'ится индивидуально. После старта ставка и opt-in заблокированы. В конце игры — zero-sum: delta_i = round((score_i − mean) × stake), settle для всех opt-in (≥2). Журнал в rating_events, баланс в user_ratings. Гости видят disabled toggle с подсказкой. Provisional дельта в счёте видна только opt-in игрокам; финальный экран RatingSettlementModal — им же. Admin (по env ADMIN_EMAILS) может обнулить рейтинг отдельного игрока или всех — с записью в журнал. Релизный чек-лист: после merge нужно (1) задеплоить game-action edge function и (2) выставить ADMIN_EMAILS env для админ-функций. Полная спека: docs/superpowers/specs/2026-05-23-conditional-stakes-design.md
    ```

### Guests can change visible nickname during the game (Akula, 2026-05-21)

  - defaultExpanded: false
    ```md
    Settings → Profile nickname input уже был доступен через шестерёнку прямо за столом, но изменение не пробрасывалось в открытую игру — `room_sessions.display_name` фиксировался при join. Теперь после save в Settings клиент дополнительно вызывает новое edge-action `set_display_name`, которое обновляет `room_sessions.display_name` и бампит `rooms.version` → всем игрокам прилетает state_changed и они подтягивают новое имя через get_room_state. Avatar/avatar_color уже читались напрямую из auth.users.raw_user_meta_data, так что они проезжают на том же broadcast'е.
    ```

### Detailed scoreboard on desktop — embedded in left pane, brief↔detailed toggle, rotated name headers, auto-advance to next hand, cap winner modal at 600px (Akula, 2026-05-18)


### Host leaves WaitingRoom → kick everyone to lobby (Akula via feedback, 2026-05-19)

  - defaultExpanded: false
    ```md
    Когда хост выходит из комнаты до старта игры (WaitingRoom), остальные игроки остаются на экране ожидания. Должны автоматически выкидываться в Lobby с уведомлением "комната закрыта". Отличается от «Post-game scoreboard + Play again on host exit» — там сценарий пост-игровой, а тут pre-game.
    ```

### Offline scorekeeper — record real-life game results without card dealing, manual score entry

  - defaultExpanded: false
    ```md
    Новый room mode для оффлайн-партий — комната работает как электронный «арбитр», карты не раздаются.
    
    **Flow**
    - Хост при создании приватной комнаты выбирает Mode: Standard / Scorekeeper (фиксируется после создания).
    - Игра стартует, но dealt_cards не пишется. Сразу идёт фаза `betting` в обычном порядке (десцендент по карт-капу, host pick для 1/2-карточных раздач — как сейчас).
    - После закрытия всех ставок hand переходит в новую фазу `tricks_recording` (вместо `playing`).
    - Каждый игрок сам видит ±-стейппер для своей заявки. Сервер пишет hand_trick_claims(hand_id, session_id, n).
    - Когда у всех есть claim И sum == cards_dealt → авто-переход в `closed`, hand_scores инсертится как обычно, дальше существующий cycle.
    - При sum ≠ cards_dealt: broadcast `tricks_mismatch` всем, баннер на столе, заявки НЕ сбрасываются, каждый правит свою.
    
    **DB (1 миграция)**
    - rooms.mode TEXT NOT NULL DEFAULT 'standard' CHECK ('standard'|'scorekeeper')
    - hands.phase допускает 'tricks_recording'
    - CREATE TABLE hand_trick_claims (hand_id UUID, session_id UUID, tricks_claimed INT, PRIMARY KEY (hand_id, session_id))
    - RPC claim_tricks(p_hand_id, p_tricks) — upsert + sum-check + автопереход в closed
    - create_room принимает p_mode
    
    **Engine**
    - start_hand в scorekeeper-режиме skip dealt_cards INSERT
    - place_bet_action на последней ставке — в scorekeeper-режиме phase=tricks_recording, иначе playing (как сейчас)
    
    **UI**
    - PrivateRoom create form: toggle Standard / Scorekeeper
    - GameTableScreen: hide hand row + trick area когда rooms.mode='scorekeeper' && phase=='tricks_recording', смонтировать TricksRecorder
    - TricksRecorder: ±-стейппер для своей заявки + сводка кто сколько заявил
    - Mismatch banner сверху стола: «Сумма не сходится — кто-то ошибся»
    - i18n: ~15 строк × EN/RU/ES
    
    **UX-решения**
    - Каждый вводит сам (не один хост за всех).
    - Mismatch → баннер всем, claims остаются (минимум кликов когда ошибся один).
    - Mode toggle при создании, потом фикс.
    
    SP-режим пока не трогаем — фича только для multiplayer комнат.
    ```

### Mobile Safari (iPhone) — GameTable layout breaks after opening chat and going back (Ol via Akula, 2026-05-19)

  - defaultExpanded: false
    ```md
    На iPhone Safari открытие чата с экрана стола и возврат назад в игру ломает вёрстку GameTable — починить можно только обновлением страницы. Подозрение на iOS Safari viewport/visualViewport reflow при показе/скрытии модалки чата или на оставшийся inert/overflow state на корневом контейнере после закрытия ChatPanel.
    ```

### Spectator count indicator on desktop — broken layout, tiny tap target (Akula via feedback, 2026-05-19)

  - defaultExpanded: false
    ```md
    Индикатор количества зрителей на десктопном GameTable отображается криво: иконка на одной строке, цифра — на другой. Сама кнопка слишком маленькая. Починить вёрстку и увеличить touch target.
    ```

### Сообщения в чате рядом с аватаром на столе

  - defaultExpanded: false
    ```md
    Отображается сообщение, отправленное в чате прямо на столе.
    ```

### Видимый "баттон"

  - defaultExpanded: false
    ```md
    Отображать заметную фишку-баттон, которая говорит о том, кто первый начинал ходить в раздаче. Аналогия из покера. Баттон справа от того, кто первый начинает ходить.
    ```

### Per-game seat shuffle in private rooms (Akula, 2026-05-08)


### Share spectator link from in-game GameTable (Akula via feedback, 2026-05-19)

  - defaultExpanded: false
    ```md
    Сейчас поделиться ссылкой для зрителей можно только из WaitingRoom (btn-share-spectator). Добавить ту же возможность прямо из GameTable, чтобы хост мог пригласить зрителя в любой момент партии.
    ```

### In-game messages over avatars even when chat is open (Akula via feedback, 2026-05-20)

  - defaultExpanded: false
    ```md
    Сейчас на десктопе с открытым чатом пузырь сообщения над аватаром игрока скрывается — текст идёт только в чат-панель. Хочется чтобы пузырь над аватаром показывался всегда, даже при открытом чате, чтобы видеть кто что сказал прямо за столом.
    ```

### сохранять курсор в чате

  - defaultExpanded: false
    ```md
    После ввода включения в чате сктопия и нажатия клавиши Enter, курсор должен сохраняться в чате.
    ```

### Detailed scoreboard headers — initials/avatar instead of rotated nickname (Akula via feedback, 2026-05-19)

  - defaultExpanded: false
    ```md
    На десктопе в детальной части счёта никнеймы показаны вертикально (rotated headers) и плохо читаются. Заменить на инициалы / аватар / простой цветной кружок.
    ```

### Real card images in Last Trick pane on desktop (Akula, 2026-05-18)


### Chat survives page refresh — localStorage per-room (Akula, 2026-05-18)


### Card double-tap on desktop confirms cleanly — no text-selection (Akula, 2026-05-18)


### Hand-1 starting seat randomized; rotation now relative to previous hand (Akula, 2026-05-17)


### Cup-style score icon — clearer trophy SVG (Akula, 2026-05-17)


### Desktop in-game icon buttons get text labels (settings/scores/chat/last-tricks/exit) — mobile stays icon-only (Akula, 2026-05-17)


### Cards huge + 5-per-row grid on true desktop, small on touch / iPad (Akula, 2026-05-17)


### Cards centred on desktop (PopovIsNit, 2026-05-08)


### Logo tap → leave with confirm — WaitingRoom / GameTable / BettingPhase (Akula, 2026-05-17)


### размещение карт на экране ставок Desktop

  - defaultExpanded: false
    ```md
    На экране ставок на десктопе необходимо отображать все карты в ширину экрана, даже если для этого придется делать вторую строку. Нельзя заставлять пользователей догадываться о том, что можно проскроить горизонтально список карт.
    ```

### SP scoreboard opens in left sidebar on desktop, button highlights when open — same as multiplayer (Akula, 2026-05-17)


### Контейнер онбординга на месте. Кнопок и описание игры на десктопе.

  - defaultExpanded: false
    ```md
    Гораздо лучше будет, если при нажатии на кнопку научиться играть или learn to play контейнер с обучающими материалами а-ля onboarding будет появляться вместо описания игры преимуществ игры кнопок. При этом селектор языка должен быть видимо даже в этом случае. В пользователе в таком случае будет возможность переключиться на другой язык уже в процессе онбординга, и нажатие понятно просто вернет старый экран с кнопками и описанием игры.
    ```

### Betting screen — cards span the full width (Akula, 2026-05-16)


### Quick Match without login broken — guest "Играть" CTA is dead (Akula, 2026-05-17)


### SP betting screen has no exit button — only logo→leave works there (Akula, 2026-05-17)


### Score icon is unclear (Akula, 2026-05-16)


### Пропала кнопка сохранения прогресса в профиле на Desktop

  - defaultExpanded: false
    ```md
    Нет кнопки сохранить прогресс в профиле на десктопе для не залогиненного пользователя.
    ```

### Hide auth form for logged-in users — desktop right pane mounts Lobby; mobile shows compact profile card (Akula, 2026-05-17)


### Nägels wordmark on one line on narrow desktop (Akula, 2026-05-17)


### Desktop welcome polish — embedded + standalone Lobby capped at 600px, flush panes, equal-width CTAs, primer below with fixed body height, duplicate logo header removed (Akula, 2026-05-17)


### Desktop layouts — 5 split-pane screens for ≥1024px viewports (2026-05-16)


### Bet confirmation — explicit Confirm button (Akula, 2026-05-16)


### Spectator mode — invite-link based read-only watcher with chat (Akula, 2026-05-08)


### Google OAuth + linking + auto-register + display_name backfill (2026-05-15)


### Bet confirmation — confirm step before locking bid


### Custom game modes — replace 1-card rounds with 2-card rounds (2026-05-15)


### Project principles + repo hygiene


### Rich feedback metadata — device, browser, settings, viewport


### TTL cleanup — 24h auto-delete of stale rooms and inactive guest accounts


### Haptic feedback on key gameplay events


### Installable PWA — manifest + service worker + icons


### Reconnect resilience — graceful disconnect, rejoin, bot takeover on timeout, fix realtime subscriptions


### In-game onboarding — contextual hints on first launch (bid, play, trump) shown at right moment


### Design system (Figma) — 3 pages, 11 screens, 9 components


### Scoreboard redesign — table layout with score history per round, bonus circles, ▶ first player


### Reset password flow

  - defaultExpanded: false

### Theme system — light/dark with system auto-detect


### Settings screen — theme, deck colors, language


### All screens themed — Welcome, Lobby, Betting, GameTable, Scoreboard, Chat, rooms


### PlayingCard redesign — themed, yellow selection, 4 sizes


### GameTable layout — green/gray table, icon top bar, semi-transparent profiles


### Auth flow — guest-to-registered conversion, login/register before first game, profile management


### BettingPhase — poker chips, smart hints, player grid


### Welcome + Lobby redesign — Akula logo, tab-based lobby


### i18n — all UI strings EN/RU/ES


### Vercel deployment — nigels-app-v2.vercel.app


### GitHub repo — github.com/akadymov/nagels-app-v2


