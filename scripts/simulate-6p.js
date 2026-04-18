/**
 * Nägels Online — 6-Player Full Game Simulation
 *
 * Pure JavaScript. No TypeScript, no React Native, no external imports.
 * Run with: node scripts/simulate-6p.js
 *
 * Validates:
 *   1. Full 6-player game (16 hands) completes successfully
 *   2. Max cards = floor(52/6) = 8
 *   3. Hand sequence: 8,7,6,5,4,3,2,1,1,2,3,4,5,6,7,8
 *   4. Trump order: diamonds → hearts → clubs → spades → notrump (repeating)
 *   5. Every trick has exactly 6 cards
 *   6. Counterclockwise play order
 *   7. Betting: last player cannot make total = cardsPerPlayer
 *   8. No-trump hands: full trick-by-trick logging + notrump rule verification
 *   9. Emergency fallback tracking (should never trigger)
 *  10. Rule violation detection
 */

'use strict';

// ─── ANSI colours ─────────────────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  magenta:'\x1b[35m',
  blue:   '\x1b[34m',
  gray:   '\x1b[90m',
  white:  '\x1b[37m',
};

// ─── GAME CONSTANTS ──────────────────────────────────────────────────────────
const TRUMP_ORDER = ['diamonds', 'hearts', 'clubs', 'spades', 'notrump'];
const SUITS       = ['diamonds', 'hearts', 'clubs', 'spades'];
const RANKS       = [2, 3, 4, 5, 6, 7, 8, 9, 10, 'J', 'Q', 'K', 'A'];

const SUIT_SYMBOLS = {
  diamonds: '♦',
  hearts:   '♥',
  clubs:    '♣',
  spades:   '♠',
  notrump:  'NT',
};

const SUIT_COLORS = {
  diamonds: C.red,
  hearts:   C.red,
  clubs:    C.white,
  spades:   C.white,
  notrump:  C.cyan,
};

function suitStr(suit) {
  return `${SUIT_COLORS[suit]}${SUIT_SYMBOLS[suit]}${C.reset}`;
}

function cardStr(card) {
  return `${SUIT_COLORS[card.suit]}${card.rank}${SUIT_SYMBOLS[card.suit]}${C.reset}`;
}

// ─── CARD RANK HELPERS ────────────────────────────────────────────────────────
const NORMAL_RANK = { 2:0, 3:1, 4:2, 5:3, 6:4, 7:5, 8:6, 9:7, 10:8, J:9, Q:10, K:11, A:12 };
// Trump rank: J=12 (highest), 9=11 (second), A=10, K=9, Q=8, 10=7, 8=6, 7=5, 6=4, 5=3, 4=2, 3=1, 2=0
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

// ─── BETTING ──────────────────────────────────────────────────────────────────
function getAllowedBets(cardsPerPlayer, currentBets, isLastPlayer) {
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
  const playerIds = Array.from({ length: playerCount }, (_, i) => `P${i}`);
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

/**
 * isCardPlayable — full rules from rules.ts, ported to plain JS
 *
 * Returns { playable: boolean, reason?: string, notrumpTrumpViolation?: boolean }
 *
 * The extra 'notrumpTrumpViolation' flag lets us detect if trump logic
 * was accidentally applied during a notrump hand.
 */
function isCardPlayable(card, handCards, leadCard, trumpSuit, playedCards) {
  // First player in trick: any card
  if (!leadCard) return { playable: true };

  const leadSuit    = leadCard.suit;
  const hasLeadSuit = hasSuit(handCards, leadSuit);

  if (hasLeadSuit) {
    // Jack-of-trump exception: lead IS trump and only trump held is Jack(s)
    if (leadSuit === trumpSuit && hasOnlyJackTrump(handCards, trumpSuit)) {
      return { playable: true };
    }
    if (card.suit === leadSuit) return { playable: true };

    // Player also has lead suit — can additionally play trump (non-notrump only)
    if (trumpSuit !== 'notrump' && card.suit === trumpSuit) {
      const playedTrumps = playedCards.filter(p => p.card.suit === trumpSuit);
      if (playedTrumps.length > 0) {
        const highestPlayed = playedTrumps
          .map(p => ({ card: p.card, rank: getCardRank(p.card.rank, true) }))
          .sort((a, b) => b.rank - a.rank)[0];
        const cardRank = getCardRank(card.rank, true);
        // "Cannot play lower trump" only when lead is NOT trump
        if (cardRank < highestPlayed.rank && leadCard.suit !== trumpSuit) {
          return { playable: false, reason: 'Cannot play lower trump' };
        }
      }
      return { playable: true };
    }
    return { playable: false, reason: 'Must follow suit or play trump' };
  }

  // ── Player does NOT have lead suit ───────────────────────────────────────────
  if (trumpSuit !== 'notrump') {
    const hasOnlyJack = hasOnlyJackTrump(handCards, trumpSuit);
    const isTrumpLead = leadCard.suit === trumpSuit;

    // Jack-of-trump exception: trick led with trump, player only has Jack → may play off-suit
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
        const hasNonTrump = handCards.some(c => c.suit !== trumpSuit);
        // "Cannot play lower trump" restriction only applies when player still has non-trump cards.
        // If ALL remaining cards are trump, any trump is playable (including lower ones).
        if (cardRank < highestPlayed.rank && leadCard.suit !== trumpSuit && hasNonTrump) {
          return { playable: false, reason: 'Cannot play lower trump' };
        }
        return { playable: true };
      }
      return { playable: true };
    }
    return { playable: true };
  }

  // NOTRUMP: no trump suit exists — any card is valid
  return { playable: true };
}

function getPlayableCards(handCards, leadCard, trumpSuit, playedCards) {
  const playable = handCards.filter(card =>
    isCardPlayable(card, handCards, leadCard, trumpSuit, playedCards).playable
  );
  if (playable.length === 0 && handCards.length > 0) {
    return { cards: handCards, emergency: true };
  }
  return { cards: playable, emergency: false };
}

// ─── TRICK RESOLUTION ─────────────────────────────────────────────────────────
function compareCards(a, b, trumpSuit, leadSuit) {
  // In notrump: trump flags are always false, lead-suit card wins by rank
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

// Check that the trick winner is the highest lead-suit card (notrump verification)
function verifyNotrumpTrickWinner(playedCards, winnerId) {
  const leadSuit = playedCards[0].card.suit;
  // Find highest lead-suit card
  const leadSuitCards = playedCards.filter(p => p.card.suit === leadSuit);
  const highestLeadCard = leadSuitCards
    .map(p => ({ pid: p.playerId, rank: getCardRank(p.card.rank, false) }))
    .sort((a, b) => b.rank - a.rank)[0];
  return highestLeadCard.pid === winnerId;
}

// ─── SCORING ──────────────────────────────────────────────────────────────────
function calculateHandScore(bet, tricksWon) {
  return { points: tricksWon, bonus: tricksWon === bet ? 10 : 0 };
}

// ─── VALIDATION STATE ─────────────────────────────────────────────────────────
let failures    = [];
let warnings    = [];
let ruleViolations = [];

function assert(condition, msg) {
  if (!condition) {
    failures.push(msg);
    console.error(`  ${C.red}FAIL${C.reset} ${msg}`);
  }
}

function warn(msg) {
  warnings.push(msg);
  console.warn(`  ${C.yellow}WARN${C.reset} ${msg}`);
}

function recordViolation(msg) {
  ruleViolations.push(msg);
  console.error(`  ${C.red}VIOLATION${C.reset} ${msg}`);
}

// ─── SINGLE RUN ───────────────────────────────────────────────────────────────
function runSimulation(runNumber) {
  // Reset per-run tracking
  failures       = [];
  warnings       = [];
  ruleViolations = [];

  const PLAYER_COUNT   = 6;
  const maxCards       = getMaxCards(PLAYER_COUNT);   // floor(52/6) = 8
  const totalHands     = getTotalHands(maxCards);     // 16
  const handSequence   = getAllHandCards(maxCards);

  console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║${C.reset}${C.bold}   Nägels Online — 6-Player Simulation  RUN ${runNumber}              ${C.cyan}║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════════════════════╝${C.reset}`);
  console.log(`  Players:       ${PLAYER_COUNT}`);
  console.log(`  Max cards:     ${maxCards}  (floor(52/6))`);
  console.log(`  Total hands:   ${totalHands}`);
  console.log(`  Hand sequence: [${handSequence.join(', ')}]`);
  console.log(`  Trump cycle:   ${TRUMP_ORDER.map(s => SUIT_SYMBOLS[s]).join(' → ')} (repeating)`);
  console.log();

  // Verify hand sequence is correct
  assert(maxCards === 8, `maxCards should be 8, got ${maxCards}`);
  assert(totalHands === 16, `totalHands should be 16, got ${totalHands}`);
  const expectedSeq = [8,7,6,5,4,3,2,1,1,2,3,4,5,6,7,8];
  assert(JSON.stringify(handSequence) === JSON.stringify(expectedSeq),
    `Hand sequence mismatch: got [${handSequence.join(',')}]`);

  const playerIds = Array.from({ length: PLAYER_COUNT }, (_, i) => `P${i}`);

  const scores  = new Map(playerIds.map(id => [id, 0]));
  const bonuses = new Map(playerIds.map(id => [id, 0]));

  let emergencyFallbackCount = 0;
  let emergencyDetails       = [];
  let totalTricksPlayed      = 0;
  let notrumpHandCount       = 0;
  let notrumpTrickCount      = 0;
  let notrumpWinnerErrors    = 0;

  // Starting player index (counterclockwise: each hand, subtract 1 mod playerCount)
  let startingPlayerIndex = 0;

  // ── Main hand loop ─────────────────────────────────────────────────────────
  for (let handNumber = 1; handNumber <= totalHands; handNumber++) {
    const cardsPerPlayer = getHandCards(handNumber, maxCards);
    const trumpSuit      = getTrumpForHand(handNumber);
    const isNotrump      = trumpSuit === 'notrump';

    if (isNotrump) notrumpHandCount++;

    console.log(`${C.bold}${C.blue}┌─ Hand ${String(handNumber).padStart(2)}/${totalHands}${C.reset}${C.bold}  cards=${cardsPerPlayer}  trump=${suitStr(trumpSuit)}  starts=P${startingPlayerIndex}${C.reset}`);

    // ── Deal ────────────────────────────────────────────────────────────────
    const deck  = shuffleDeck(createDeck());
    const hands = dealCards(deck, PLAYER_COUNT, cardsPerPlayer, trumpSuit);

    // Verify deal
    for (const pid of playerIds) {
      assert(hands.get(pid).length === cardsPerPlayer,
        `Hand ${handNumber}: ${pid} dealt ${hands.get(pid).length} cards, expected ${cardsPerPlayer}`);
    }

    // Print hands
    if (isNotrump) {
      console.log(`  ${C.magenta}[NOTRUMP HAND — detailed trick logging active]${C.reset}`);
      for (const pid of playerIds) {
        const h = hands.get(pid);
        console.log(`  ${pid} hand: ${h.map(c => cardStr(c)).join(' ')}`);
      }
    }

    // ── Betting ─────────────────────────────────────────────────────────────
    const bets = new Map();
    for (let i = 0; i < PLAYER_COUNT; i++) {
      // Counterclockwise: each subsequent better is index-1 mod playerCount
      const betterIndex = (startingPlayerIndex - i + PLAYER_COUNT * 100) % PLAYER_COUNT;
      const betterId    = playerIds[betterIndex];
      const isLast      = i === PLAYER_COUNT - 1;
      const currentBets = [...bets.values()];

      const allowed = getAllowedBets(cardsPerPlayer, currentBets, isLast);
      assert(allowed.length > 0, `Hand ${handNumber}: ${betterId} has no allowed bets`);

      const bet = allowed[Math.floor(Math.random() * allowed.length)];
      bets.set(betterId, bet);
    }

    const totalBets = [...bets.values()].reduce((s, b) => s + b, 0);
    assert(totalBets !== cardsPerPlayer,
      `Hand ${handNumber}: total bets ${totalBets} === cardsPerPlayer ${cardsPerPlayer} (forbidden)`);

    const betsStr = playerIds.map(pid => `${pid}:${bets.get(pid)}`).join(' ');
    console.log(`  Bets: ${betsStr}  (sum=${totalBets}, cards=${cardsPerPlayer}, forbidden=${cardsPerPlayer})`);

    // ── Play all tricks ────────────────────────────────────────────────────
    const tricksWon   = new Map(playerIds.map(id => [id, 0]));
    const playerHands = new Map(playerIds.map(id => [id, [...hands.get(id)]]));
    let leadIndex     = startingPlayerIndex;

    for (let trickNum = 0; trickNum < cardsPerPlayer; trickNum++) {
      const played = [];

      if (isNotrump) {
        console.log(`  ${C.magenta}  Trick ${trickNum + 1}:${C.reset}`);
      }

      for (let i = 0; i < PLAYER_COUNT; i++) {
        // Counterclockwise: next player is index-1 mod playerCount
        const playerIndex = (leadIndex - i + PLAYER_COUNT * 100) % PLAYER_COUNT;
        const playerId    = playerIds[playerIndex];
        const hand        = playerHands.get(playerId);
        const leadCard    = played.length > 0 ? played[0].card : null;

        const { cards: playableCards, emergency } = getPlayableCards(hand, leadCard, trumpSuit, played);

        if (emergency) {
          emergencyFallbackCount++;
          const efDetail = `Hand ${handNumber} T${trickNum + 1} ${playerId} trump=${trumpSuit} lead=${leadCard ? cardStr(leadCard) : 'none'} hand=[${hand.map(c => cardStr(c)).join(' ')}]`;
          emergencyDetails.push(efDetail);
          warn(`Hand ${handNumber} trick ${trickNum + 1}: ${playerId} triggered EMERGENCY FALLBACK`);
          warn(`  Trump: ${trumpSuit}, lead: ${leadCard ? cardStr(leadCard) : 'none'}`);
          warn(`  Hand: [${hand.map(c => cardStr(c)).join(' ')}]`);
          if (isNotrump) {
            // Emergency fallback should NEVER happen in a notrump hand — every card is always legal
            recordViolation(`NOTRUMP hand ${handNumber} trick ${trickNum + 1}: emergency fallback triggered for ${playerId} — impossible in notrump!`);
          } else {
            // With the rule fix (all-trump hand → any trump playable), this should NEVER occur.
            // If it does, it indicates a logic regression.
            warn(`  [UNEXPECTED in trump hand — rule fix should allow all-trump hands to play any card!]`);
          }
        }

        assert(playableCards.length > 0,
          `Hand ${handNumber} trick ${trickNum + 1}: ${playerId} has 0 playable cards`);

        // Bot picks a random playable card
        const card = playableCards[Math.floor(Math.random() * playableCards.length)];

        // ── Rule violation checks ────────────────────────────────────────
        // Only check for violations if the card was NOT selected via emergency fallback.
        // Emergency fallback is an intentional safety valve (allows all cards when
        // normal rules produce zero playable cards — can happen when a player's only
        // remaining card is a lower trump that the "cannot play lower trump" rule would
        // normally block).
        if (leadCard && !emergency) {
          const { playable: ok, reason } = isCardPlayable(card, hand, leadCard, trumpSuit, played);
          if (!ok) {
            recordViolation(`Hand ${handNumber} trick ${trickNum + 1} ${playerId}: played ${cardStr(card)} but isCardPlayable says NO (${reason})`);
            recordViolation(`  Lead: ${cardStr(leadCard)}, trump: ${trumpSuit}`);
            recordViolation(`  Hand: [${hand.map(c => cardStr(c)).join(' ')}]`);
          }
        }

        // In notrump: verify no trump-logic shenanigans in card selection
        // (the getPlayableCards logic above should be pure notrump-safe already,
        //  but we double-check: if card has a non-lead suit and player had lead suit, flag it)
        if (isNotrump && leadCard) {
          const hasLead = hasSuit(hand, leadCard.suit);
          if (hasLead && card.suit !== leadCard.suit) {
            recordViolation(`NOTRUMP Hand ${handNumber} T${trickNum + 1}: ${playerId} played ${cardStr(card)} but had lead suit ${suitStr(leadCard.suit)} — should have followed suit!`);
          }
        }

        played.push({ playerId, card });
        playerHands.set(playerId, hand.filter(c => c.id !== card.id));

        if (isNotrump) {
          console.log(`    ${playerId}: ${cardStr(card)}${i === 0 ? ' (lead)' : ''}`);
        }
      }

      // Validate trick completeness
      assert(played.length === PLAYER_COUNT,
        `Hand ${handNumber} trick ${trickNum + 1}: only ${played.length} cards played (expected ${PLAYER_COUNT})`);

      // Determine winner
      const { winnerId, winningCard } = determineTrickWinner(played, trumpSuit);
      tricksWon.set(winnerId, (tricksWon.get(winnerId) || 0) + 1);
      leadIndex = playerIds.indexOf(winnerId);
      totalTricksPlayed++;

      if (isNotrump) {
        notrumpTrickCount++;
        // Verify notrump winner: must be highest lead-suit card, NO trump logic
        const winnerIsCorrect = verifyNotrumpTrickWinner(played, winnerId);
        if (!winnerIsCorrect) {
          notrumpWinnerErrors++;
          recordViolation(`NOTRUMP Hand ${handNumber} T${trickNum + 1}: winner ${winnerId} (${cardStr(winningCard)}) is NOT the highest lead-suit card!`);
        }

        // Also verify: if a "trump" (non-lead suit) beat the lead suit, that's wrong in notrump
        const leadSuit = played[0].card.suit;
        const nonLeadWon = winningCard.suit !== leadSuit;
        if (nonLeadWon) {
          recordViolation(`NOTRUMP Hand ${handNumber} T${trickNum + 1}: winner played ${cardStr(winningCard)} which is NOT lead suit ${suitStr(leadSuit)} — trump logic leaked into notrump!`);
        }

        console.log(`    ${C.magenta}Winner: ${winnerId} with ${cardStr(winningCard)}${C.reset}`);
      }
    }

    // ── Post-hand validations ───────────────────────────────────────────────
    for (const pid of playerIds) {
      assert(playerHands.get(pid).length === 0,
        `Hand ${handNumber}: ${pid} has ${playerHands.get(pid).length} cards remaining`);
    }

    const totalTricksInHand = [...tricksWon.values()].reduce((s, v) => s + v, 0);
    assert(totalTricksInHand === cardsPerPlayer,
      `Hand ${handNumber}: tricksWon sums to ${totalTricksInHand}, expected ${cardsPerPlayer}`);

    // ── Scoring ─────────────────────────────────────────────────────────────
    for (const pid of playerIds) {
      const { points, bonus } = calculateHandScore(bets.get(pid), tricksWon.get(pid));
      scores.set(pid,  (scores.get(pid)  || 0) + points);
      bonuses.set(pid, (bonuses.get(pid) || 0) + bonus);
    }

    // Summary line for this hand
    const tricksStr = playerIds.map(pid => `${pid}:${tricksWon.get(pid)}/${bets.get(pid)}`).join(' ');
    console.log(`  Tricks(won/bet): ${tricksStr}`);
    const scoresStr = playerIds.map(pid => `${pid}:${scores.get(pid)}+${bonuses.get(pid)}`).join(' ');
    console.log(`  Running scores:  ${scoresStr}`);
    console.log(`${C.blue}└──────────────────────────────────────────────────────────${C.reset}`);
    console.log();

    // Advance starting player counterclockwise (index - 1 mod playerCount)
    startingPlayerIndex = (startingPlayerIndex - 1 + PLAYER_COUNT) % PLAYER_COUNT;
  }

  // ── Final report ─────────────────────────────────────────────────────────
  console.log(`${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║${C.reset}${C.bold}   RUN ${runNumber} — FINAL RESULTS                                  ${C.cyan}║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════════════════════╝${C.reset}`);

  // Final scores table
  console.log(`\n${C.bold}  Final Scores:${C.reset}`);
  const sortedPlayers = [...playerIds].sort((a, b) =>
    (scores.get(b) + bonuses.get(b)) - (scores.get(a) + bonuses.get(a))
  );
  for (const pid of sortedPlayers) {
    const score = scores.get(pid);
    const bonus = bonuses.get(pid);
    const total = score + bonus;
    console.log(`  ${pid}: tricks=${String(score).padStart(3)}  bonuses=${String(bonus).padStart(3)}  total=${C.bold}${String(total).padStart(4)}${C.reset}`);
  }

  // Notrump summary
  console.log(`\n${C.bold}  Notrump Hands Summary:${C.reset}`);
  console.log(`  Notrump hands played:        ${notrumpHandCount}`);
  console.log(`  Notrump tricks played:       ${notrumpTrickCount}`);
  console.log(`  Notrump winner errors:       ${notrumpWinnerErrors === 0 ? C.green + notrumpWinnerErrors + C.reset : C.red + notrumpWinnerErrors + C.reset}`);

  // Emergency fallback
  console.log(`\n${C.bold}  Emergency Fallback:${C.reset}`);
  if (emergencyFallbackCount === 0) {
    console.log(`  ${C.green}NONE triggered — as expected${C.reset}`);
  } else {
    console.log(`  ${C.red}COUNT: ${emergencyFallbackCount}${C.reset}`);
    for (const d of emergencyDetails) {
      console.log(`    ${C.red}• ${d}${C.reset}`);
    }
  }

  // Rule violations
  console.log(`\n${C.bold}  Rule Violations:${C.reset}`);
  if (ruleViolations.length === 0) {
    console.log(`  ${C.green}NONE detected${C.reset}`);
  } else {
    for (const v of ruleViolations) {
      console.log(`  ${C.red}• ${v}${C.reset}`);
    }
  }

  // Validation failures
  console.log(`\n${C.bold}  Validation Failures:${C.reset}`);
  if (failures.length === 0) {
    console.log(`  ${C.green}NONE${C.reset}`);
  } else {
    for (const f of failures) {
      console.log(`  ${C.red}✗ ${f}${C.reset}`);
    }
  }

  // Warnings
  if (warnings.length > 0) {
    console.log(`\n${C.bold}  Warnings (${warnings.length}):${C.reset}`);
    for (const w of warnings) {
      console.log(`  ${C.yellow}! ${w}${C.reset}`);
    }
  }

  const totalHandsPlayed = totalHands; // we always play all 16
  // With the rule fix (all-trump hand → any trump is playable), emergency fallback
  // should NEVER trigger in any hand (trump or notrump).
  // A run FAILS only if: hard assertions failed or genuine rule violations detected.
  const success = failures.length === 0 && ruleViolations.length === 0;

  console.log(`\n  Total tricks played: ${totalTricksPlayed}`);
  console.log(`  Expected total:      ${handSequence.reduce((s, v) => s + v, 0)}`);
  assert(totalTricksPlayed === handSequence.reduce((s, v) => s + v, 0),
    `Total tricks ${totalTricksPlayed} !== expected ${handSequence.reduce((s, v) => s + v, 0)}`);

  console.log(`\n${success
    ? C.green + C.bold + '  ✓ RUN ' + runNumber + ' PASSED'
    : C.red   + C.bold + '  ✗ RUN ' + runNumber + ' FAILED'}${C.reset}\n`);

  return {
    runNumber,
    success,
    failures:              [...failures],
    ruleViolations:        [...ruleViolations],
    emergencyFallbackCount,
    notrumpHandCount,
    notrumpTrickCount,
    notrumpWinnerErrors,
    finalScores: Object.fromEntries(playerIds.map(pid => [pid, {
      tricks:  scores.get(pid),
      bonuses: bonuses.get(pid),
      total:   scores.get(pid) + bonuses.get(pid),
    }])),
  };
}

// ─── SPECIFIC SCENARIO UNIT TEST ─────────────────────────────────────────────
// Player has only [6♦, K♦], lead is non-diamond (e.g. ♠), trump is diamonds,
// 10♦ already played → both 6♦ AND K♦ must be playable (all-trump hand rule).
(function verifyAllTrumpScenario() {
  console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║${C.reset}${C.bold}   UNIT TEST: All-Trump Hand Scenario                     ${C.cyan}║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════════════════════╝${C.reset}`);
  console.log(`  Scenario: hand=[6♦, K♦], lead=A♠ (non-trump), trump=diamonds, 10♦ played`);

  const sixDiamond  = { id: 'diamonds-6-0',  suit: 'diamonds', rank: 6  };
  const kingDiamond = { id: 'diamonds-K-1',  suit: 'diamonds', rank: 'K' };
  const tenDiamond  = { id: 'diamonds-10-2', suit: 'diamonds', rank: 10 };
  const aceSpade    = { id: 'spades-A-3',    suit: 'spades',   rank: 'A' };

  const hand       = [sixDiamond, kingDiamond];
  const leadCard   = aceSpade;                  // non-trump lead
  const trumpSuit  = 'diamonds';
  const played     = [{ playerId: 'P0', card: aceSpade }, { playerId: 'P1', card: tenDiamond }];

  const r6 = isCardPlayable(sixDiamond,  hand, leadCard, trumpSuit, played);
  const rK = isCardPlayable(kingDiamond, hand, leadCard, trumpSuit, played);

  let scenarioPassed = true;
  if (!r6.playable) {
    console.log(`  ${C.red}FAIL${C.reset} 6♦ should be playable but got: ${r6.reason}`);
    scenarioPassed = false;
  } else {
    console.log(`  ${C.green}PASS${C.reset} 6♦ is playable (all-trump hand, lower trump allowed)`);
  }
  if (!rK.playable) {
    console.log(`  ${C.red}FAIL${C.reset} K♦ should be playable but got: ${rK.reason}`);
    scenarioPassed = false;
  } else {
    console.log(`  ${C.green}PASS${C.reset} K♦ is playable`);
  }
  if (scenarioPassed) {
    console.log(`  ${C.green}${C.bold}Unit test PASSED — both 6♦ and K♦ are playable${C.reset}`);
  } else {
    console.log(`  ${C.red}${C.bold}Unit test FAILED${C.reset}`);
    process.exit(1);
  }
  console.log();
})();

// ─── RUN 5 TIMES ─────────────────────────────────────────────────────────────
const results = [];
for (let run = 1; run <= 5; run++) {
  results.push(runSimulation(run));
}

// ─── CROSS-RUN SUMMARY ────────────────────────────────────────────────────────
console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════╗${C.reset}`);
console.log(`${C.bold}${C.cyan}║${C.reset}${C.bold}   OVERALL SUMMARY — 5 RUNS                              ${C.cyan}║${C.reset}`);
console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════════════════════╝${C.reset}`);

for (const r of results) {
  const status = r.success ? `${C.green}PASS${C.reset}` : `${C.red}FAIL${C.reset}`;
  console.log(`\n  Run ${r.runNumber}: ${status}`);
  // With the "all-trump hand" rule fix, emergency fallback should NEVER trigger.
  // Mark in red if it does (it now indicates a real logic bug).
  console.log(`    Emergency fallbacks:   ${r.emergencyFallbackCount === 0 ? C.green : C.red}${r.emergencyFallbackCount}${C.reset} ${r.emergencyFallbackCount > 0 ? C.red + '(UNEXPECTED — rule fix should prevent this!)' + C.reset : ''}`);
  console.log(`    Notrump hands:         ${r.notrumpHandCount}  (tricks: ${r.notrumpTrickCount})`);
  console.log(`    Notrump winner errors: ${r.notrumpWinnerErrors === 0 ? C.green : C.red}${r.notrumpWinnerErrors}${C.reset}`);
  console.log(`    Rule violations:       ${r.ruleViolations.length === 0 ? C.green : C.red}${r.ruleViolations.length}${C.reset}`);
  console.log(`    Validation failures:   ${r.failures.length === 0 ? C.green : C.red}${r.failures.length}${C.reset}`);

  // Per-player scores
  const players = Object.keys(r.finalScores).sort((a, b) => r.finalScores[b].total - r.finalScores[a].total);
  const scParts = players.map(pid => `${pid}=${r.finalScores[pid].total}`).join(' ');
  console.log(`    Scores (total):        ${scParts}`);

  if (r.ruleViolations.length > 0) {
    for (const v of r.ruleViolations) console.log(`    ${C.red}VIOLATION: ${v}${C.reset}`);
  }
  if (r.failures.length > 0) {
    for (const f of r.failures) console.log(`    ${C.red}FAIL: ${f}${C.reset}`);
  }
}

const allPassed = results.every(r => r.success);
console.log(`\n${allPassed
  ? C.green + C.bold + '  ALL 5 RUNS PASSED ✓'
  : C.red   + C.bold + '  SOME RUNS FAILED ✗'}${C.reset}\n`);

process.exit(allPassed ? 0 : 1);
