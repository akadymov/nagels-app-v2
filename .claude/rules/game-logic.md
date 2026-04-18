---
description: Immutable Nagels card game rules — must never be changed without explicit approval
paths: ["src/game/**"]
---

# Nagels Game Logic — Immutable Rules

The game engine in `src/game/rules.ts` implements the official Nagels rules. These are **immutable** — do not modify core game mechanics without explicit user approval.

## Canonical Reference
[Legacy rules page](https://github.com/akadymov/nagels-app/blob/main/api/info_en.html)

## Core Mechanics (Do Not Change)
- **Deck**: 36 cards (6-A in 4 suits)
- **Players**: 2-6
- **Hands**: 20 hands per game, card count varies per hand
- **Trump**: determined by last dealt card (or no trump in specific hands)
- **Betting**: each player bets how many tricks they'll take; total bets cannot equal total tricks available
- **Scoring**: exact bet = 10 + bet amount; over/under = negative difference
- **Turn order**: rotates each hand; within a trick, must follow suit if possible

## What CAN Be Changed (with approval)
- Bot AI strategy (`src/lib/bot/botAI.ts`)
- UI presentation of game state
- Animation and timing of card plays
- Custom game mode parameters (future feature)
