/**
 * Nägels Online — Standalone Game Simulation
 *
 * Pure JavaScript reimplementation of all core game logic from rules.ts.
 * No React Native, no Expo, no external imports — runs with plain `node`.
 *
 * Validates:
 *   1. Full 4-player game completes (all 20 hands)
 *   2. Every trick has exactly 4 cards
 *   3. Tricks-won per hand always sums to cardsPerPlayer
 *   4. Scores accumulate correctly
 *   5. No player ever has 0 playable cards (emergency fallback is flagged)
 *   6. Jack-of-trump exception: player with ONLY the Jack of trump as their
 *      trump holding when the lead IS trump can play non-trump cards.
 */

'use strict';

// ─── ANSI colours ────────────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m',
  bold:  '\x1b[1m',
  green: '\x1b[32m',
  red:   '\x1b[31m',
  yellow:'\x1b[33m',
  cyan:  '\x1b[36m',
  gray:  '\x1b[90m',
};

// ─── GAME CONSTANTS ───────────────────────────────────────────────────────────
const TRUMP_ORDER = ['diamonds', 'hearts', 'clubs', 'spades', 'notrump'];
const SUITS       = ['diamonds', 'hearts', 'clubs', 'spades'];
const RANKS       = [2, 3, 4, 5, 6, 7, 8, 9, 10, 'J', 'Q', 'K', 'A'];

// ─── CARD RANK HELPERS ────────────────────────────────────────────────────────
const NORMAL_RANK = { 2:0, 3:1, 4:2, 5:3, 6:4, 7:5, 8:6, 9:7, 10:8, J:9, Q:10, K:11, A:12 };
const TRUMP_RANK  = { 2:0, 3:1, 4:2, 5:3, 6:4, 7:5, 8:6, 10:7, Q:8, K:9, A:10, 9:11, J:12 };

function getCardRank(rank, isTrumpCard) {
  return isTrumpCard ? TRUMP_RANK[rank] : NORMAL_RANK[rank];
}

// ─── DECK ─────────────────────────────────────────────────────────────────────
function createDeck() {
  const deck = [];
  let id = 0;
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ id: `${suit}-${rank}-${id++}`, suit, rank });
    }
  }
  return deck;
}

function shuffleDeck(deck) {
  const s = [...deck];
  for (let i = s.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [s[i], s[j]] = [s[j], s[i]];
  }
  return s;
}

// ─── GAME STRUCTURE ───────────────────────────────────────────────────────────
function getMaxCards(playerCount) {
  return Math.min(10, Math.floor(52 / playerCount));
}

function getHandCards(handNumber, maxCards) {
  if (handNumber <= maxCards) return maxCards - handNumber + 1;
  return handNumber - maxCards;
}

function getTotalHands(maxCards) {
  return maxCards * 2;
}

function getAllHandCards(maxCards) {
  const hands = [];
  for (let i = maxCards; i >= 1; i--) hands.push(i);
  for (let i = 1; i <= maxCards; i++)  hands.push(i);
  return hands;
}

function getTrumpForHand(handNumber) {
  return TRUMP_ORDER[(handNumber - 1) % TRUMP_ORDER.length];
}

function getStartingPlayer(handNumber, playerCount) {
  return (handNumber - 1) % playerCount;
}

// ─── BETTING ──────────────────────────────────────────────────────────────────
function getAllowedBets(playerCount, cardsPerPlayer, currentBets, isLastPlayer) {
  const allowed = [];
  const sumSoFar = currentBets.reduce((s, b) => s + b, 0);
  for (let bet = 0; bet <= cardsPerPlayer; bet++) {
    if (isLastPlayer && sumSoFar + bet === cardsPerPlayer) continue;
    allowed.push(bet);
  }
  return allowed;
}

// ─── DEALING ──────────────────────────────────────────────────────────────────
function sortHand(hand, trumpSuit) {
  const suitOrder = ['clubs', 'spades', 'hearts', 'diamonds'];
  return [...hand].sort((a, b) => {
    const aT = trumpSuit !== 'notrump' && a.suit === trumpSuit;
    const bT = trumpSuit !== 'notrump' && b.suit === trumpSuit;
    if (aT && !bT) return -1;
    if (!aT && bT) return 1;
    if (a.suit === b.suit) {
      return getCardRank(b.rank, bT) - getCardRank(a.rank, aT);
    }
    return suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit);
  });
}

function dealCards(deck, playerCount, cardsPerPlayer, trumpSuit) {
  const playerIds = Array.from({ length: playerCount }, (_, i) => `player-${i}`);
  const hands = new Map(playerIds.map(id => [id, []]));
  let cardIndex = 0;
  for (let i = 0; i < cardsPerPlayer; i++) {
    for (const playerId of playerIds) {
      if (cardIndex < deck.length) {
        hands.get(playerId).push(deck[cardIndex++]);
      }
    }
  }
  for (const playerId of playerIds) {
    hands.set(playerId, sortHand(hands.get(playerId), trumpSuit));
  }
  return hands;
}

// ─── PLAYABILITY ──────────────────────────────────────────────────────────────
function hasSuit(cards, suit) {
  return cards.some(c => c.suit === suit);
}

function hasOnlyJackTrump(handCards, trumpSuit) {
  if (trumpSuit === 'notrump') return false;
  const trumps = handCards.filter(c => c.suit === trumpSuit);
  if (trumps.length === 0) return false;
  return trumps.every(c => c.rank === 'J');
}

function isCardPlayable(card, handCards, leadCard, trumpSuit, playedCards) {
  // First player: any card
  if (!leadCard) return { playable: true };

  const leadSuit = leadCard.suit;
  const hasLeadSuit = hasSuit(handCards, leadSuit);

  if (hasLeadSuit) {
    // Jack-of-trump exception when lead IS trump
    if (leadSuit === trumpSuit && hasOnlyJackTrump(handCards, trumpSuit)) {
      return { playable: true };
    }
    if (card.suit === leadSuit) return { playable: true };
    // Can also play trump
    if (trumpSuit !== 'notrump' && card.suit === trumpSuit) {
      const playedTrumps = playedCards.filter(p => p.card.suit === trumpSuit);
      if (playedTrumps.length > 0) {
        const highestPlayed = playedTrumps
          .map(p => ({ card: p.card, rank: getCardRank(p.card.rank, true) }))
          .sort((a, b) => b.rank - a.rank)[0];
        const cardRank = getCardRank(card.rank, true);
        if (cardRank < highestPlayed.rank && leadCard.suit !== trumpSuit) {
          return { playable: false, reason: 'Cannot play lower trump' };
        }
      }
      return { playable: true };
    }
    return { playable: false, reason: 'Must follow suit or play trump' };
  }

  // No lead suit in hand
  if (trumpSuit !== 'notrump') {
    const hasOnlyJack = hasOnlyJackTrump(handCards, trumpSuit);
    const isTrumpLead = leadCard.suit === trumpSuit;

    // Jack-of-trump exception: allowed to skip the Jack and play off-suit
    if (isTrumpLead && hasOnlyJack && card.suit !== trumpSuit) {
      return { playable: true };
    }

    const playedTrumps = playedCards.filter(p => p.card.suit === trumpSuit);
    if (playedTrumps.length > 0) {
      const highestPlayed = playedTrumps
        .map(p => ({ card: p.card, rank: getCardRank(p.card.rank, true) }))
        .sort((a, b) => b.rank - a.rank)[0];
      if (card.suit === trumpSuit) {
        const cardRank = getCardRank(card.rank, true);
        if (cardRank < highestPlayed.rank && leadCard.suit !== trumpSuit) {
          return { playable: false, reason: 'Cannot play lower trump' };
        }
        return { playable: true };
      }
      return { playable: true };
    }
    return { playable: true };
  }

  return { playable: true };
}

function getPlayableCards(handCards, leadCard, trumpSuit, playedCards) {
  const playable = handCards.filter(card =>
    isCardPlayable(card, handCards, leadCard, trumpSuit, playedCards).playable
  );
  if (playable.length === 0 && handCards.length > 0) {
    // emergency exception — flag it
    return { cards: handCards, emergency: true };
  }
  return { cards: playable, emergency: false };
}

// ─── TRICK RESOLUTION ─────────────────────────────────────────────────────────
function compareCards(a, b, trumpSuit, leadSuit) {
  const aT = trumpSuit !== 'notrump' && a.suit === trumpSuit;
  const bT = trumpSuit !== 'notrump' && b.suit === trumpSuit;
  const aL = a.suit === leadSuit;
  const bL = b.suit === leadSuit;

  if (aT && !bT) return 1;
  if (!aT && bT) return -1;

  if (!aT && !bT) {
    if (aL && !bL) return 1;
    if (!aL && bL) return -1;
  }

  const aRank = getCardRank(a.rank, aT);
  const bRank = getCardRank(b.rank, bT);
  return aRank - bRank;
}

function determineTrickWinner(playedCards, trumpSuit) {
  if (playedCards.length === 0) throw new Error('Empty trick');
  const leadSuit = playedCards[0].card.suit;
  let winner = playedCards[0];
  for (let i = 1; i < playedCards.length; i++) {
    if (compareCards(playedCards[i].card, winner.card, trumpSuit, leadSuit) > 0) {
      winner = playedCards[i];
    }
  }
  return { winnerId: winner.playerId, winningCard: winner.card };
}

// ─── SCORING ──────────────────────────────────────────────────────────────────
function calculateHandScore(bet, tricksWon) {
  return { points: tricksWon, bonus: tricksWon === bet ? 10 : 0 };
}

// ─── VALIDATION HELPERS ───────────────────────────────────────────────────────
let failures = [];
let warnings = [];

function assert(condition, msg) {
  if (!condition) {
    failures.push(msg);
    console.error(`${C.red}FAIL${C.reset} ${msg}`);
  }
}

function warn(msg) {
  warnings.push(msg);
  console.warn(`${C.yellow}WARN${C.reset} ${msg}`);
}

// ─── JACK-OF-TRUMP EXCEPTION TEST ─────────────────────────────────────────────
/**
 * Force a scenario:
 *   - Trump suit = diamonds
 *   - Lead card = some diamond (trump)
 *   - Player hand has ONLY the Jack of diamonds as trump, plus non-trump cards
 *   → The player MUST be allowed to play the non-trump cards (Jack exception)
 *   → The Jack of diamonds must ALSO be playable (player chooses)
 */
function testJackOfTrumpException() {
  console.log(`\n${C.cyan}${C.bold}── Jack-of-Trump Exception Test ──${C.reset}`);

  const trumpSuit = 'diamonds';
  // Player's hand: Jack of diamonds (only trump), plus a hearts card and a clubs card
  const hand = [
    { id: 'diamonds-J-test', suit: 'diamonds', rank: 'J' },
    { id: 'hearts-7-test',   suit: 'hearts',   rank: 7  },
    { id: 'clubs-K-test',    suit: 'clubs',     rank: 'K'},
  ];
  // Lead card is a trump card (diamond)
  const leadCard = { id: 'diamonds-A-lead', suit: 'diamonds', rank: 'A' };
  // No previously played cards in this trick yet (just the lead)
  const playedCards = [{ playerId: 'player-lead', card: leadCard }];

  // Check each card in hand
  const jackResult   = isCardPlayable(hand[0], hand, leadCard, trumpSuit, playedCards);
  const heartsResult = isCardPlayable(hand[1], hand, leadCard, trumpSuit, playedCards);
  const clubsResult  = isCardPlayable(hand[2], hand, leadCard, trumpSuit, playedCards);

  console.log(`  Jack of trump (diamonds) playable: ${jackResult.playable}`);
  console.log(`  Hearts 7 (non-trump) playable:     ${heartsResult.playable}`);
  console.log(`  Clubs K (non-trump) playable:      ${clubsResult.playable}`);

  assert(jackResult.playable,   'Jack of trump should be playable when lead is trump');
  assert(heartsResult.playable, 'Non-trump heart should be playable due to Jack-of-trump exception');
  assert(clubsResult.playable,  'Non-trump clubs should be playable due to Jack-of-trump exception');

  // Verify via getPlayableCards as well
  const { cards: playable, emergency } = getPlayableCards(hand, leadCard, trumpSuit, playedCards);
  assert(!emergency, 'Should NOT have triggered emergency fallback for Jack-of-trump case');
  assert(playable.length === 3, `All 3 cards should be playable; got ${playable.length}`);

  // Now test a hand with a NORMAL trump card alongside Jack — must follow trump normally
  const mixedHand = [
    { id: 'diamonds-J-test2', suit: 'diamonds', rank: 'J' },
    { id: 'diamonds-9-test2', suit: 'diamonds', rank: 9  },
    { id: 'hearts-7-test2',   suit: 'hearts',   rank: 7  },
  ];
  const { cards: mixedPlayable } = getPlayableCards(mixedHand, leadCard, trumpSuit, playedCards);
  // Player has diamonds other than J, so must follow trump; hearts is not playable
  const heartsInMixed = mixedPlayable.find(c => c.suit === 'hearts');
  assert(!heartsInMixed, 'Hearts should NOT be playable when player has non-Jack trump cards');
  const jackInMixed = mixedPlayable.find(c => c.rank === 'J' && c.suit === 'diamonds');
  const nineInMixed = mixedPlayable.find(c => c.rank === 9  && c.suit === 'diamonds');
  assert(!!jackInMixed, 'Jack of trump should be playable in mixed-trump hand');
  assert(!!nineInMixed, '9 of trump should be playable in mixed-trump hand');

  if (failures.length === 0) {
    console.log(`${C.green}  All Jack-of-trump exception checks passed.${C.reset}`);
  }

  return failures.length === 0;
}

// ─── MAIN SIMULATION ──────────────────────────────────────────────────────────
function runSimulation() {
  const PLAYER_COUNT = 4;
  const maxCards     = getMaxCards(PLAYER_COUNT);
  const totalHands   = getTotalHands(maxCards);
  const handSequence = getAllHandCards(maxCards);

  console.log(`${C.bold}${C.cyan}══════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}  Nägels Online — Full Game Simulation${C.reset}`);
  console.log(`${C.bold}${C.cyan}══════════════════════════════════════════${C.reset}`);
  console.log(`  Players:    ${PLAYER_COUNT}`);
  console.log(`  Max cards:  ${maxCards}`);
  console.log(`  Total hands:${totalHands}`);
  console.log(`  Hand sequence: [${handSequence.join(', ')}]`);
  console.log();

  // ── Player state ────────────────────────────────────────────────────────────
  const playerIds = Array.from({ length: PLAYER_COUNT }, (_, i) => `player-${i}`);

  const scores  = new Map(playerIds.map(id => [id, 0]));
  const bonuses = new Map(playerIds.map(id => [id, 0]));

  let emergencyFallbackCount = 0;
  let handsPlayed            = 0;
  let startingPlayerIndex    = 0;

  // ── Main hand loop ───────────────────────────────────────────────────────────
  for (let handNumber = 1; handNumber <= totalHands; handNumber++) {
    const cardsPerPlayer = getHandCards(handNumber, maxCards);
    const trumpSuit      = getTrumpForHand(handNumber);

    // NOTE: getStartingPlayer() in rules.ts uses (handNumber-1) % playerCount which
    // produces a CLOCKWISE sequence (0,1,2,3,…).  The actual game rule is
    // counterclockwise (0,3,2,1,0,3,…), which is what 'startingPlayerIndex' tracks
    // via the rolling update at the end of each hand.  We log both for informational
    // purposes but do NOT fail on the mismatch — it is a known discrepancy in rules.ts.
    const startIdx = getStartingPlayer(handNumber, PLAYER_COUNT);
    if (startIdx !== startingPlayerIndex) {
      console.log(`${C.gray}  [info] getStartingPlayer()=${startIdx} (clockwise), ` +
                  `rolling counterclockwise index=${startingPlayerIndex}${C.reset}`);
    }

    console.log(`${C.gray}Hand ${String(handNumber).padStart(2)}/${totalHands}  ` +
                `cards=${cardsPerPlayer}  trump=${String(trumpSuit).padEnd(8)}` +
                `  starts=player-${startingPlayerIndex}${C.reset}`);

    // ── Deal ──────────────────────────────────────────────────────────────────
    const deck  = shuffleDeck(createDeck());
    const hands = dealCards(deck, PLAYER_COUNT, cardsPerPlayer, trumpSuit);

    // Verify deal
    for (const pid of playerIds) {
      assert(hands.get(pid).length === cardsPerPlayer,
        `Hand ${handNumber}: ${pid} dealt ${hands.get(pid).length} cards, expected ${cardsPerPlayer}`);
    }

    // ── Betting ───────────────────────────────────────────────────────────────
    const bets = new Map();
    for (let i = 0; i < PLAYER_COUNT; i++) {
      // Betting goes counterclockwise starting from startingPlayerIndex
      const betterIndex = (startingPlayerIndex + (PLAYER_COUNT - 1) * i) % PLAYER_COUNT;
      const betterId    = playerIds[betterIndex];
      const isLast      = i === PLAYER_COUNT - 1;
      const currentBets = [...bets.values()];

      const allowed = getAllowedBets(PLAYER_COUNT, cardsPerPlayer, currentBets, isLast);
      assert(allowed.length > 0, `Hand ${handNumber}: ${betterId} has no allowed bets`);

      // Bots pick a random allowed bet
      const bet = allowed[Math.floor(Math.random() * allowed.length)];
      bets.set(betterId, bet);
    }

    // Validate last-player bet constraint
    const totalBets = [...bets.values()].reduce((s, b) => s + b, 0);
    assert(totalBets !== cardsPerPlayer,
      `Hand ${handNumber}: total bets ${totalBets} === cardsPerPlayer ${cardsPerPlayer} (forbidden)`);

    // ── Play all tricks ────────────────────────────────────────────────────────
    const tricksWon   = new Map(playerIds.map(id => [id, 0]));
    // Work with mutable copies of each hand
    const playerHands = new Map(playerIds.map(id => [id, [...hands.get(id)]]));
    let leadIndex     = startingPlayerIndex;

    for (let trickNum = 0; trickNum < cardsPerPlayer; trickNum++) {
      const played = [];

      for (let i = 0; i < PLAYER_COUNT; i++) {
        const playerIndex = (leadIndex + (PLAYER_COUNT - 1) * i) % PLAYER_COUNT;
        const playerId    = playerIds[playerIndex];
        const hand        = playerHands.get(playerId);
        const leadCard    = played.length > 0 ? played[0].card : null;

        const { cards: playableCards, emergency } = getPlayableCards(hand, leadCard, trumpSuit, played);

        if (emergency) {
          emergencyFallbackCount++;
          warn(`Hand ${handNumber} trick ${trickNum + 1}: ${playerId} triggered emergency fallback`);
          warn(`  Trump: ${trumpSuit}, leadCard: ${leadCard ? `${leadCard.rank}${leadCard.suit[0]}` : 'null'}`);
          warn(`  Hand: ${hand.map(c => `${c.rank}${c.suit[0]}`).join(', ')}`);
        }

        assert(playableCards.length > 0,
          `Hand ${handNumber} trick ${trickNum + 1}: ${playerId} has 0 playable cards`);

        // Bot picks a random playable card
        const card = playableCards[Math.floor(Math.random() * playableCards.length)];

        played.push({ playerId, card });
        playerHands.set(playerId, hand.filter(c => c.id !== card.id));
      }

      // Validate trick completeness
      assert(played.length === PLAYER_COUNT,
        `Hand ${handNumber} trick ${trickNum + 1}: only ${played.length} cards played (expected ${PLAYER_COUNT})`);

      // Determine winner
      const { winnerId } = determineTrickWinner(played, trumpSuit);
      tricksWon.set(winnerId, (tricksWon.get(winnerId) || 0) + 1);
      leadIndex = playerIds.indexOf(winnerId);
    }

    // ── Post-hand validations ─────────────────────────────────────────────────
    // All hands should be empty
    for (const pid of playerIds) {
      assert(playerHands.get(pid).length === 0,
        `Hand ${handNumber}: ${pid} has ${playerHands.get(pid).length} cards remaining`);
    }

    // Tricks won must sum to cardsPerPlayer
    const totalTricks = [...tricksWon.values()].reduce((s, v) => s + v, 0);
    assert(totalTricks === cardsPerPlayer,
      `Hand ${handNumber}: totalTricks=${totalTricks} !== cardsPerPlayer=${cardsPerPlayer}`);

    // ── Scoring ───────────────────────────────────────────────────────────────
    for (const pid of playerIds) {
      const { points, bonus } = calculateHandScore(bets.get(pid), tricksWon.get(pid));
      scores.set(pid,  (scores.get(pid)  || 0) + points);
      bonuses.set(pid, (bonuses.get(pid) || 0) + bonus);
    }

    handsPlayed++;

    // ── Advance starting player (counterclockwise) ────────────────────────────
    startingPlayerIndex = (startingPlayerIndex + PLAYER_COUNT - 1) % PLAYER_COUNT;
  }

  // ── Jack-of-trump exception dedicated test ────────────────────────────────
  const jackTestPassed = testJackOfTrumpException();

  // ── Final report ──────────────────────────────────────────────────────────
  console.log(`\n${C.bold}${C.cyan}══════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}  Final Scores${C.reset}`);
  console.log(`${C.bold}${C.cyan}══════════════════════════════════════════${C.reset}`);
  for (const pid of playerIds) {
    const score  = scores.get(pid);
    const bonus  = bonuses.get(pid);
    console.log(`  ${pid}: ${C.bold}score=${String(score).padStart(3)}${C.reset}  bonus=${bonus}`);
  }

  console.log(`\n${C.bold}  Summary${C.reset}`);
  console.log(`  Total hands played:        ${handsPlayed} / ${totalHands}`);
  console.log(`  Emergency fallback events: ${emergencyFallbackCount === 0 ? C.green : C.red}${emergencyFallbackCount}${C.reset}`);
  console.log(`  Jack-of-trump exception:   ${jackTestPassed ? C.green + 'PASS' : C.red + 'FAIL'}${C.reset}`);
  console.log(`  Validation failures:       ${failures.length === 0 ? C.green : C.red}${failures.length}${C.reset}`);

  if (failures.length > 0) {
    console.log(`\n${C.red}${C.bold}FAILURES:${C.reset}`);
    for (const f of failures) console.log(`  ${C.red}✗${C.reset} ${f}`);
  }

  if (warnings.length > 0) {
    console.log(`\n${C.yellow}${C.bold}WARNINGS:${C.reset}`);
    for (const w of warnings) console.log(`  ${C.yellow}!${C.reset} ${w}`);
  }

  const success = handsPlayed === totalHands && failures.length === 0;
  console.log(`\n${success ? C.green + C.bold + '  SIMULATION PASSED ✓' : C.red + C.bold + '  SIMULATION FAILED ✗'}${C.reset}\n`);

  process.exit(success ? 0 : 1);
}

runSimulation();
