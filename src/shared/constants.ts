import type { MissionDifficulty, ShopItemId } from './types.ts';

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 12;
export const CODE_LENGTH = 5;
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const AVATARS = ['🐓', '🦉', '🐐', '🍄', '🕯️', '🗝️', '🍷', '🧀', '🪓', '🦊', '🐗', '🌰'] as const;

// Colores identificativos: saturación contenida para que convivan con la paleta madera/papel
export const PLAYER_COLORS = [
  '#c8553d', '#4f8a5b', '#d9a441', '#5b8fb9', '#9a5fa8', '#c77d4a',
  '#3f9c96', '#b85c7a', '#8a9a3b', '#6d7fd1', '#b0894f', '#d06c5b',
] as const;

export const START_COINS = 50;

export const MISSION_REWARD: Record<MissionDifficulty, number> = {
  facil: 40,
  media: 70,
  dificil: 110,
  epica: 180,
};

export const SHOP_PRICES: Record<ShopItemId, number> = {
  pista: 40,
  candado: 30,
  voto_doble: 40,
  ganzua: 30,
  mirilla: 50,
  sobre: 0,
  coartada: 40,
  altavoz: 25,
  espejo: 80,
  nota: 10,
};

export const SHOP_ITEMS: { id: ShopItemId; emoji: string; name: string; text: string; target: boolean; textInput?: boolean }[] = [
  { id: 'pista', emoji: '🔎', name: 'Pista', text: 'Una pista sobre la partida. Normalmente cierta. No siempre.', target: false },
  { id: 'candado', emoji: '🔒', name: 'Candado', text: 'Te protege del próximo robo.', target: false },
  { id: 'voto_doble', emoji: '🗳️', name: 'Voto doble', text: 'Tu próximo voto en un juicio cuenta doble.', target: false },
  { id: 'ganzua', emoji: '🧤', name: 'Ganzúa', text: 'Robas hasta 50 monedas a alguien. El Candado lo bloquea.', target: true },
  { id: 'mirilla', emoji: '👁️', name: 'Mirilla', text: 'Descubres a quién votó alguien en el último juicio.', target: true },
  { id: 'sobre', emoji: '✉️', name: 'Sobre', text: 'Regalas monedas a alguien. Pactos, sobornos, deudas.', target: true },
  { id: 'coartada', emoji: '🛡️', name: 'Coartada', text: 'El próximo ¡PILLADO! contra ti falla seguro. El acusador paga la multa igualmente.', target: false },
  { id: 'altavoz', emoji: '📢', name: 'Altavoz', text: 'La casa grita tu mensaje a todos, sin decir quién lo escribió. Sé creativo.', target: false, textInput: true },
  { id: 'espejo', emoji: '🪞', name: 'Espejo', text: 'Miras a alguien a los ojos y la casa te dice su facción. Al Cuco Doble le engaña.', target: true },
  { id: 'nota', emoji: '📜', name: 'Nota bajo la puerta', text: 'Un mensaje anónimo que alguien encontrará bajo su puerta. Idéntico a las del Falsificador.', target: true, textInput: true },
];

/** Mercado negro: cada ronda algunos objetos salen a precio de ganga */
export const MARKET_SIZE = 3;
export const MARKET_DISCOUNT = 0.6;

/** Misión en pareja: probabilidad por ronda y recompensa para cada cómplice */
export const COUPLE_CHANCE = 0.5;
export const COUPLE_REWARD = 60;

/** El saboteador infiltrado: probabilidad en pruebas de equipo y paga si la prueba falla */
export const SABOTEUR_CHANCE = 0.35;
export const SABOTEUR_REWARD = 80;

/** La Gran Acusación: acertar a quién es Cuco paga el doble de lo apostado */
export const BET_PAYOUT = 2;

/** Predicción a ciegas de la ronda 1: acertar que alguien es Cuco antes de saber nada */
export const PREDICTION_REWARD = 60;

/** Reacciones que flotan en la TV: whitelist cerrada, nada de texto libre */
export const REACTION_EMOJIS = ['😂', '😱', '🤨', '👀', '🔪', '🤫', '👏', '💀'] as const;
export const REACT_COOLDOWN_MS = 1200;

/** Misiones del grupo que el anfitrión escribe al crear la casa */
export const MAX_CUSTOM_MISSIONS = 4;
export const CUSTOM_MISSION_MAX_LEN = 140;

/** Editor de contenido de la casa: límites del contentMod */
export const MAX_CONTENT_EDITS = 400;
export const MAX_CONTENT_DISABLED = 400;
export const MAX_EXTRA_QUESTIONS = 8;
export const CONTENT_EDIT_MAX_LEN = 500;

/** Piloto automático: cuentas atrás que la casa arma sola en las fases de narración */
export const AUTO_DELAY_SEC = {
  roleReveal: 150, // red de seguridad si alguien no pulsa "listo"
  roundIntro: 14,
  briefing: 40, // leer la prueba en voz alta y colocarse
  challengeDone: 12,
  ritualRevealed: 10,
  voteRevealed: 16,
  roundResult: 18,
  finaleStep: 26,
};

export const GANZUA_STEAL = 50;
export const MANO_LARGA_STEAL = 40;
export const PILLADO_REWARD = 50;
export const PILLADO_PENALTY = 20;
export const CODE_HUNT_ATTEMPTS = 5;

// Un corte de Wi-Fi dura segundos; solo se puede relevar a quien lleva ausente un rato
export const TAKEOVER_GRACE_MS = 20_000;

export const MISSION_SLOTS = 2;
export const MISSION_SLOTS_VECINO = 3;
export const CERILLAS_PER_CUCO = 2;

export const FINAL_BONUS = {
  winningFaction: 100,
  correctAccusation: 30,
  hiddenCuco: 80,
  turista: 250,
  buscavidas: 150,
  padrino: 180,
  ermitano: 120,
};

/** Misión relámpago: segundos para cumplirla antes de que se apague */
export const LIGHTNING_MISSION_SEC = 90;
export const LIGHTNING_TAG = 'relampago';

/** Carta del condenado: máximo de caracteres de la nota anónima del sospechoso */
export const LETTER_MAX_LEN = 200;

/** Rachas: cada STREAK_TARGET misiones encadenadas sin que te pillen → bonus */
export const STREAK_TARGET = 3;
export const STREAK_BONUS = 30;
/** Sequías: tras DROUGHT_ROUNDS rondas sin ganar monedas, la casa te compadece */
export const DROUGHT_ROUNDS = 2;
export const DROUGHT_BONUS = 15;

/** Subasta ciega: puja mínima en el sobre del casero */
export const AUCTION_MIN_BID = 10;

/** Misión de corro (tres cómplices): probabilidad por ronda y recompensa por cabeza */
export const CORRO_CHANCE = 0.3;
export const CORRO_REWARD = 50;
