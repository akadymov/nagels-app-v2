## Tech Debt

> Источник: `docs/superpowers/audits/2026-05-26-security-audit.md` + `docs/superpowers/audits/2026-05-26-architecture-audit.md`. Все пункты тегированы `[tech]` чтобы отделить от продуктовых задач.

### [tech][security][HIGH] Revoke switch_role RPC from anon (2026-05-26)

  - defaultExpanded: false
    ```md
    `supabase/migrations/20260524000000_switch_role.sql:142` грантит EXECUTE на `switch_role` для роли `anon`. Защищено внутренним `auth.uid() IS NULL → auth_failed`, но это формальный регресс относительно других RPC (transfer_rating, get_my_active_room, can_announce_telegram — все `TO authenticated` только). Fix: миграция с `REVOKE EXECUTE ON FUNCTION public.switch_role(...) FROM anon;`.
    ```

### [tech][security][HIGH] Rate-limit lookup_rating_recipient (2026-05-26)

  - defaultExpanded: false
    ```md
    `supabase/migrations/20260525000000_rating_transfers.sql:22-86`. Любой залогиненный юзер может в цикле проверять, существует ли email в Nägels — RPC возвращает `{found:true|false}` без троттлинга. Email-oracle. Fix: добавить лёгкую таблицу `rpc_throttle(user_id, fn_name, called_at)` + проверку «не более 30 вызовов за 10 минут» в теле функции. Возвращать `{ok:false, error:'rate_limited'}`.
    ```

### [tech][security][HIGH] Stop logging user email in authService (2026-05-26)

  - defaultExpanded: false
    ```md
    `src/lib/supabase/authService.ts:96, 128, 155` — `console.log('[AuthService] Signed in as', data.user.email)`. PII в браузерных devtools и любых remote log sinks. Fix: либо логать только `data.user.id`, либо маскировать local-part: `email.replace(/(.).+(@)/, '$1***$2')`.
    ```

### [tech][security][MEDIUM] CORS wildcard on game-action (2026-05-26)

  - defaultExpanded: false
    ```md
    `supabase/functions/_shared/cors.ts:2` — `Access-Control-Allow-Origin: *`. JWT-верификация защищает мутации (нет cookie → low CSRF), но defense-in-depth ослаблен. Fix: эхо-список разрешённых origin'ов (`https://nigels.online`, `https://*.vercel.app`, `http://localhost:8081`) и Vary: Origin.
    ```

### [tech][security][MEDIUM] Feedback table accepts anon inserts + forgeable player_id (2026-05-26)

  - defaultExpanded: false
    ```md
    `supabase/migrations/20260516185139_remote_schema_baseline.sql:1412` — `feedback_insert_anyone WITH CHECK (true)`. Спам-вектор + можно подставить чужой `player_id` UUID. Fix: `WITH CHECK (player_id IS NULL OR player_id = auth.uid())` + триггер-throttle по IP/session.
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

### [tech][arch][cleanup] Drop supabase/migrations.legacy/ (2026-05-26)

  - defaultExpanded: false
    ```md
    26 файлов больше не применяются — baseline (20260516185139) содержит всё. Только сбивают с толку. Fix: удалить или переместить в `docs/history/`.
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

## Backlog

### Resizable desktop side panels (Akula, 2026-05-26)

  - defaultExpanded: false
    ```md
    На десктопе боковые панели (чат, профиль, last trick, scoreboard) фиксированной ширины. Сделать их ресайзабельными: drag-and-drop за внутреннюю границу левого/правого контейнера. Сохранять ширину в `useSettingsStore` (per-panel, per-side), чтобы переживало reload. Реализация: тонкий компонент-разделитель `<PanelResizer side="left" min={240} max={520} onResize={…} />` внутри `DesktopGameLayout.tsx`; клампить до viewport-минус-центральная зона стола; только web (touch-устройства оставляем со статическими ширинами).
    ```

### Post-game scoreboard + "Play again" on host exit (Akhmed, 2026-05-16)


### Screenshots in feedback form (PopovIsNit, 2026-05-08)


### Push notifications — follow-ups


### Player stats — game history, win rate, exact bid percentage


### Leaderboard — global rankings


### Discord integration


### Sound effects — card played, bonus earned, turn notification


### Lobby chat — general chat for finding players and socializing


### Video/voice chat — "home game" atmosphere during multiplayer


### Table/skin customization — visual themes


## Next Up

## In Progress

### WaitingRoom — preserve membership across page refresh (Akula via feedback, 2026-05-20)

  - defaultExpanded: false
    ```md
    Если обновить страницу в не стартовавшей игре (WaitingRoom), пользователя выкидывает из комнаты. Похоже, refresh пересоздаёт anon-сессию и связь с room_players / room_spectators теряется. Нужно сохранять roomCode в localStorage и тихо вступать обратно при mount, либо матчить по auth_user_id в SQL и переставлять session_id у существующей записи.
    ```

### Cross-device user sessions

  - defaultExpanded: false
    ```md
    Надо сделать так, чтобы пользователь зайдя с другого устройства при логине попадал в ту игру или комнату, в которой он был, будучи залогиненным на другом устройстве. То есть чтобы полноценно поддерживалась кросс-девайс игра.
    ```

## Done

### Active turn highlight — gradient fill + screen pulse (Akula, 2026-05-08)


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


