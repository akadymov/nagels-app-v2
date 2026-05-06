import type { PushEvent } from './transitions.ts';

export type Lang = 'en' | 'ru' | 'es';

/** Optional context the wire layer can pass to bodies that need names. */
export interface FormatContext {
  /** session_id of the recipient — used by hand_end to look up their score. */
  recipient_session_id?: string;
  /** Resolved display name of the winner — used by game_end body. */
  winner_name?: string;
}

interface Out { title: string; body: string }

const STRINGS: Record<Lang, {
  game_start:    () => Out;
  your_bid:      () => Out;
  your_turn:     () => Out;
  hand_end:      (p: { score: number }) => Out;
  player_joined: (p: { name: string }) => Out;
  game_end:      (p: { you_won: boolean; winner: string }) => Out;
}> = {
  en: {
    game_start:    () => ({ title: '🎮 Game starting',  body: 'The hand is being dealt.' }),
    your_bid:      () => ({ title: '🎯 Your bid',       body: 'Time to call your tricks.' }),
    your_turn:     () => ({ title: '♠ Your turn',       body: 'Play a card.' }),
    hand_end:      (p) => ({ title: '📊 Hand finished', body: `${p.score >= 0 ? '+' : ''}${p.score} this hand.` }),
    player_joined: (p) => ({ title: '👋 New player',    body: `${p.name} joined your room.` }),
    game_end:      (p) => ({ title: '🏁 Game over',     body: p.you_won ? 'You won!' : `${p.winner} won.` }),
  },
  ru: {
    game_start:    () => ({ title: '🎮 Игра началась',  body: 'Раздача в процессе.' }),
    your_bid:      () => ({ title: '🎯 Твоя ставка',    body: 'Время называть взятки.' }),
    your_turn:     () => ({ title: '♠ Твой ход',        body: 'Сходи картой.' }),
    hand_end:      (p) => ({ title: '📊 Раздача сыграна', body: `${p.score >= 0 ? '+' : ''}${p.score} в раздаче.` }),
    player_joined: (p) => ({ title: '👋 Новый игрок',   body: `${p.name} зашёл в твою комнату.` }),
    game_end:      (p) => ({ title: '🏁 Игра окончена', body: p.you_won ? 'Ты победил!' : `Победил ${p.winner}.` }),
  },
  es: {
    game_start:    () => ({ title: '🎮 Empieza la partida', body: 'Repartiendo cartas.' }),
    your_bid:      () => ({ title: '🎯 Tu apuesta',         body: 'Hora de cantar tus bazas.' }),
    your_turn:     () => ({ title: '♠ Tu turno',            body: 'Juega una carta.' }),
    hand_end:      (p) => ({ title: '📊 Mano terminada',    body: `${p.score >= 0 ? '+' : ''}${p.score} esta mano.` }),
    player_joined: (p) => ({ title: '👋 Nuevo jugador',     body: `${p.name} entró a tu sala.` }),
    game_end:      (p) => ({ title: '🏁 Fin del juego',     body: p.you_won ? '¡Ganaste!' : `Ganó ${p.winner}.` }),
  },
};

export function formatPushBody(
  event: PushEvent,
  lang: Lang,
  ctx: FormatContext = {},
): { title: string; body: string } {
  const dict = STRINGS[lang] ?? STRINGS.en;
  switch (event.type) {
    case 'game_start':    return dict.game_start();
    case 'your_bid':      return dict.your_bid();
    case 'your_turn':     return dict.your_turn();
    case 'hand_end': {
      const score = event.scores.find((s) => s.session_id === ctx.recipient_session_id)?.hand_score ?? 0;
      return dict.hand_end({ score });
    }
    case 'player_joined': return dict.player_joined({ name: event.joiner_name });
    case 'game_end': {
      const you_won = event.winner_session_id === ctx.recipient_session_id;
      return dict.game_end({ you_won, winner: ctx.winner_name ?? 'Anon' });
    }
  }
}
