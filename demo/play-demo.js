/**
 * Nägels Online — Multiplayer Demo
 *
 * Один процесс Chrome, два независимых контекста (разные localStorage/cookies):
 *   Alice — левое окно    Bob — правое окно
 *
 * Оба: iPhone 14 Pro эмуляция, DevTools открыт.
 *
 * Запуск:
 *   Terminal 1:  npm run web
 *   Terminal 2:  npm run demo          (нормальная скорость)
 *                npm run demo:slow     (медленно, для записи)
 *                npm run demo:fast     (быстро, для отладки)
 *
 * Env vars:
 *   DEMO_URL      http://localhost:8081
 *   DEMO_SLOW     задержка мс между действиями (default 900)
 *   DEMO_HANDS    кол-во рук, 0 = до конца (default 0)
 *   DEMO_DEVTOOLS 1 = DevTools открыт (default 1)
 */

'use strict';

const { chromium, devices } = require('@playwright/test');

const BASE_URL      = process.env.DEMO_URL      || 'http://localhost:8081';
const SLOW_MO       = parseInt(process.env.DEMO_SLOW  || '900',  10);
const MAX_HANDS     = parseInt(process.env.DEMO_HANDS || '0',    10);
const OPEN_DEVTOOLS = (process.env.DEMO_DEVTOOLS ?? '1') !== '0';

// iPhone 14 Pro — то же что DevTools → device mode → iPhone 14 Pro
const IPHONE = devices['iPhone 14 Pro'];
const VIEWPORT = { width: 393, height: 852 };

// ─── Логирование ─────────────────────────────────────────────────────────────

function log(who, msg) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`[${t}] [${who.padEnd(5)}] ${msg}`);
}

function step(title) {
  console.log(`\n${'─'.repeat(56)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(56));
}

// ─── Утилиты ─────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Ждёт появления элемента, выводит прогресс каждые 5с */
async function waitVisible(locator, who, hint, timeout = 40000) {
  log(who, `жду: ${hint}…`);
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await locator.isVisible({ timeout: 1000 }).catch(() => false)) {
      log(who, `✓ нашёл: ${hint}`);
      return true;
    }
    const elapsed = Math.round((Date.now() - started) / 1000);
    if (elapsed % 5 === 0 && elapsed > 0) log(who, `  …${elapsed}с`);
    await sleep(500);
  }
  log(who, `✗ таймаут: ${hint} (${timeout / 1000}с)`);
  return false;
}

async function click(locator, who, hint) {
  const ok = await waitVisible(locator, who, hint);
  if (!ok) throw new Error(`[${who}] элемент не найден: ${hint}`);
  await locator.click();
  log(who, `✓ клик: ${hint}`);
}

async function fill(locator, value, who, hint) {
  const ok = await waitVisible(locator, who, hint);
  if (!ok) throw new Error(`[${who}] элемент не найден: ${hint}`);
  await locator.click({ clickCount: 3 });
  await locator.type(value, { delay: 60 });
  log(who, `✓ ввёл "${value}" → ${hint}`);
}

async function readText(locator, who, hint) {
  const ok = await waitVisible(locator, who, hint);
  if (!ok) throw new Error(`[${who}] элемент не найден: ${hint}`);
  const t = (await locator.textContent())?.trim() ?? '';
  log(who, `✓ текст: "${t}" ← ${hint}`);
  return t;
}

// ─── Шаги навигации ──────────────────────────────────────────────────────────

/** Ждёт загрузки Expo-приложения (большой JS-бандл) */
async function waitForApp(page, who) {
  log(who, `открываю ${BASE_URL}…`);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Expo React Native Web грузит бандл после domcontentloaded —
  // ждём пока появится хоть что-то из нашего UI
  log(who, 'жду загрузки React-приложения…');
  await page.waitForFunction(() => {
    // Проверяем, что на странице есть хотя бы один data-testid
    return document.querySelector('[data-testid]') !== null;
  }, { timeout: 60000 }).catch(async () => {
    // Если data-testid не появились — делаем скриншот для диагностики
    log(who, '⚠ data-testid не обнаружены, пробуем продолжить…');
  });

  await sleep(1500); // финальная анимация
  log(who, '✓ приложение загружено');
}

async function goToLobby(page, who) {
  await waitForApp(page, who);

  // Welcome screen → "Skip to Menu"
  const skip = page.locator('[data-testid="btn-skip-to-lobby"]');
  if (await skip.isVisible({ timeout: 8000 }).catch(() => false)) {
    await click(skip, who, 'btn-skip-to-lobby');
    await sleep(1200);
  } else {
    log(who, 'Welcome screen не найден — возможно уже в лобби');
  }
}

async function setNameAndCount(page, who, name, count) {
  await fill(page.locator('[data-testid="input-player-name"]'), name, who, 'input-player-name');
  await click(page.locator(`[data-testid="player-count-${count}"]`), who, `player-count-${count}`);
}

async function createRoom(page, who, name, count) {
  await setNameAndCount(page, who, name, count);
  await sleep(300);
  await click(page.locator('[data-testid="btn-create-room"]'), who, 'btn-create-room');
  log(who, 'жду создания комнаты в Supabase…');
  await sleep(4000);
  const code = await readText(page.locator('[data-testid="room-code"]'), who, 'room-code');
  console.log(`\n  ╔══════════════════════╗`);
  console.log(`  ║  КОД КОМНАТЫ: ${code}  ║`);
  console.log(`  ╚══════════════════════╝\n`);
  return code;
}

async function joinRoom(page, who, name, code) {
  await fill(page.locator('[data-testid="input-player-name"]'), name, who, 'input-player-name');
  await fill(page.locator('[data-testid="input-join-code"]'),    code, who, 'input-join-code');
  await sleep(300);
  await click(page.locator('[data-testid="btn-join-room"]'), who, 'btn-join-room');
  log(who, 'жду подключения к комнате…');
  await sleep(4000);
}

async function pressReady(page, who) {
  await click(page.locator('[data-testid="btn-ready"]'), who, 'btn-ready');
}

async function pressStart(page, who) {
  // Ждём пока Bob станет ready (хост видит кнопку Start только тогда)
  const startBtn = page.locator('[data-testid="btn-start-game"]:not([disabled]):not([aria-disabled="true"])');
  await click(startBtn, who, 'btn-start-game (enabled)');
}

// ─── Игровые действия ────────────────────────────────────────────────────────

async function tryBet(page, who) {
  // Кнопки ставок появляются только когда МОЙ ход делать ставку.
  // Ищем первую не-disabled кнопку.
  const btns = page.locator('[data-testid^="bet-btn-"]:not([disabled]):not([aria-disabled="true"])');
  const n = await btns.count();
  if (n === 0) return false;

  const btn = btns.first();
  const val = (await btn.textContent())?.trim() ?? '?';
  await btn.click();

  // Верифицируем: кнопки ставок должны исчезнуть (не мой ход больше)
  await sleep(600);
  const stillVisible = await btns.first().isVisible({ timeout: 300 }).catch(() => false);
  if (!stillVisible) {
    log(who, `✓ ставка = ${val}`);
    return true;
  }
  // Ставка не прошла (гонка состояний — не мой ход)
  log(who, `  ↩ ставка ${val} не принята`);
  return false;
}

async function tryPlayCard(page, who) {
  // Ищем карты ТОЛЬКО внутри враппера my-hand (GameTableScreen, фаза игры).
  // Это исключает карты из BettingPhase hand-preview, у которых тот же testID.
  const hand = page.locator('[data-testid="my-hand"]');
  if (!(await hand.isVisible({ timeout: 300 }).catch(() => false))) return false;

  const cards = hand.locator('[data-testid^="card-"]');
  const countBefore = await cards.count();
  if (countBefore === 0) return false;

  for (let i = 0; i < countBefore; i++) {
    const card = cards.nth(i);
    const tid = await card.getAttribute('data-testid').catch(() => null);
    if (!tid) continue;

    try {
      // Tap 1 — выбрать карту
      await card.click({ timeout: 1500 });
      await sleep(500);

      // Tap 2 — подтвердить (ищем ту же карту в той же руке)
      const same = hand.locator(`[data-testid="${tid}"]`);
      const exists = await same.isVisible({ timeout: 500 }).catch(() => false);
      if (!exists) {
        // Карта исчезла после первого тапа — значит сыграна (иногда бывает без второго тапа)
        log(who, `✓ сыграл ${tid} (1 тап)`);
        return true;
      }
      await same.click({ timeout: 1500 });
    } catch (_) {
      continue; // элемент пропал или недоступен — пробуем следующую карту
    }

    // Верифицируем: количество карт в руке уменьшилось?
    await sleep(700);
    const countAfter = await cards.count();
    if (countAfter < countBefore) {
      log(who, `✓ сыграл ${tid} (${countBefore}→${countAfter} карт)`);
      return true;
    }

    // Карта не ушла — ход не прошёл.
    // Могло быть: (а) не мой ход/completeTrick не сработал — тогда и другие карты не пройдут,
    // или (б) карта запрещена правилами (нужно следовать масти) — тогда пробуем следующую.
    log(who, `  ↩ карта ${tid} не принята, жду хода`);
    // continue — пробуем следующую карту вместо немедленного выхода
  }
  // Ни одна карта не прошла — сигнализируем «жди» (timing или ошибка)
  return false;
}

// ─── Игровой цикл ────────────────────────────────────────────────────────────

async function gameLoop(page, who, maxHands) {
  log(who, 'вошёл в игровой цикл');
  let hands = 0;
  let idle  = 0;
  const IDLE_MAX = 180; // 180 тиков × ~1с = 3 минуты тишины → стоп

  while (true) {
    await sleep(900);

    // Конец игры
    const over = await page.locator('text=/Game Over|Конец игры|Fin del juego/i')
      .first().isVisible({ timeout: 300 }).catch(() => false);
    if (over) { log(who, '🏁 Игра завершена!'); await sleep(5000); break; }

    // Continue (между руками)
    const cont = page.locator('text=/Continue Playing|Продолжить|Continuar/i').first();
    if (await cont.isVisible({ timeout: 300 }).catch(() => false)) {
      await cont.click();
      hands++;
      log(who, `✓ Continue (рук: ${hands})`);
      idle = 0;
      if (maxHands > 0 && hands >= maxHands) { log(who, `лимит ${maxHands} рук`); break; }
      continue;
    }

    // Ставка
    if (await tryBet(page, who)) { idle = 0; continue; }

    // Карта
    if (await tryPlayCard(page, who)) { idle = 0; continue; }

    // Ничего
    idle++;
    if (idle % 20 === 0) log(who, `⌛ жду хода (${idle}с)`);
    if (idle >= IDLE_MAX) { log(who, '⚠ таймаут ожидания хода'); break; }
  }
}

// ─── Позиционирование окон (CDP) ─────────────────────────────────────────────

async function positionWindow(page, x, y, w, h) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Browser.setWindowBounds', {
      windowId: (await session.send('Browser.getWindowForTarget')).windowId,
      bounds: { left: x, top: y, width: w, height: h },
    });
  } catch (_) { /* CDP метод может быть недоступен */ }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  step('Nägels Online — Multiplayer Demo');
  console.log(`  URL      : ${BASE_URL}`);
  console.log(`  Device   : iPhone 14 Pro (${VIEWPORT.width}×${VIEWPORT.height}, @3x, touch)`);
  console.log(`  DevTools : ${OPEN_DEVTOOLS ? 'открыт' : 'скрыт'}`);
  console.log(`  slowMo   : ${SLOW_MO}ms`);
  console.log(`  Руки     : ${MAX_HANDS || 'до конца'}\n`);

  // Единый процесс Chrome с двумя независимыми контекстами
  const browser = await chromium.launch({
    channel:  'chrome',       // системный Chrome (не Playwright Chromium)
    headless: false,
    slowMo:   SLOW_MO,
    devtools: OPEN_DEVTOOLS,
    args: [
      '--disable-features=TranslateUI',
      '--disable-infobars',
      '--lang=en-US',
    ],
  });

  // Alice — левое окно
  const aliceCtx = await browser.newContext({
    ...IPHONE,
    viewport: VIEWPORT,
  });

  // Bob — правое окно, независимое хранилище (другой игрок)
  const bobCtx = await browser.newContext({
    ...IPHONE,
    viewport: VIEWPORT,
  });

  const alicePage = await aliceCtx.newPage();
  const bobPage   = await bobCtx.newPage();

  // Размер окна с учётом DevTools (≈280px) и тулбара Chrome (≈88px)
  const winH = VIEWPORT.height + (OPEN_DEVTOOLS ? 280 : 0) + 88;
  const winW = VIEWPORT.width + 16;
  const gap  = 10;

  step('Шаг 0: позиционирование окон');
  await positionWindow(alicePage, 0,             0, winW, winH);
  await positionWindow(bobPage,   winW + gap,    0, winW, winH);
  log('Alice', `окно слева  (0, 0, ${winW}×${winH})`);
  log('Bob',   `окно справа (${winW + gap}, 0, ${winW}×${winH})`);

  try {
    // ── 1. Оба загружают приложение ───────────────────────────────────────
    step('Шаг 1: загрузка приложения');
    await Promise.all([
      goToLobby(alicePage, 'Alice'),
      goToLobby(bobPage,   'Bob'),
    ]);

    // ── 2. Alice создаёт комнату ──────────────────────────────────────────
    step('Шаг 2: Alice создаёт комнату');
    const roomCode = await createRoom(alicePage, 'Alice', 'Alice', 2);

    // ── 3. Bob присоединяется ─────────────────────────────────────────────
    step('Шаг 3: Bob входит по коду');
    await joinRoom(bobPage, 'Bob', 'Bob', roomCode);

    // ── 4. Bob → Ready ────────────────────────────────────────────────────
    step('Шаг 4: Bob нажимает Ready');
    await sleep(1500);
    await pressReady(bobPage, 'Bob');

    // ── 5. Alice запускает игру ───────────────────────────────────────────
    step('Шаг 5: Alice запускает игру');
    await sleep(2500); // ждём пока Bob станет ready в Supabase
    await pressStart(alicePage, 'Alice');

    // ── 6. Играем ─────────────────────────────────────────────────────────
    step('Шаг 6: Игра!');
    await sleep(4000); // загрузка игрового экрана
    await Promise.all([
      gameLoop(alicePage, 'Alice', MAX_HANDS),
      gameLoop(bobPage,   'Bob',   MAX_HANDS),
    ]);

    step('✅ Демо завершено — закрою браузер через 15 секунд');
    console.log('  (останови запись экрана сейчас)\n');
    await sleep(15000);

  } catch (err) {
    step(`❌ Ошибка: ${err.message}`);
    console.log('\n  Браузер открыт для ручной проверки. Ctrl+C для выхода.\n');
    await sleep(120000);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
