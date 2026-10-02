// Estado INTERNO de una partida. Nunca se envía tal cual al cliente: ver views.ts.
import type {
  ChallengeKind,
  ChallengeStatus,
  FinaleView,
  GameSettings,
  MissionDifficulty,
  Phase,
  ShopItemId,
  Toast,
} from '../../shared/types.ts';
import { getRole } from '../content.ts';

export class GameError extends Error {}

export interface PlayerStats {
  missionsCompleted: number;
  missionsBurned: number;
  pilladoHits: number;
  pilladoMisses: number;
  votesReceived: number;
  correctVotes: number;
  cluesReceived: number;
  coinsEarned: number;
  coinsSpent: number;
  steals: number;
  stolenFrom: number;
  apagones: number;
  bluffApagar: number;
  forges: number;
  abilityUses: number;
  challengesPlayed: number;
  challengesPassed: number;
  challengeWins: number;
  suspectRounds: number;
  itemsBought: number;
  coinsGifted: number;
  quizCorrect: number;
  duels: number;
  speakerTurns: number;
  betsWon: number;
  betProfit: number;
  /** Votos emitidos en juicios (el Ermitaño pierde su voto de silencio si vota) */
  votesCast: number;
}

export const emptyStats = (): PlayerStats => ({
  missionsCompleted: 0, missionsBurned: 0, pilladoHits: 0, pilladoMisses: 0, votesReceived: 0,
  correctVotes: 0, cluesReceived: 0, coinsEarned: 0, coinsSpent: 0, steals: 0, stolenFrom: 0,
  apagones: 0, bluffApagar: 0, forges: 0, abilityUses: 0, challengesPlayed: 0, challengesPassed: 0,
  challengeWins: 0, suspectRounds: 0, itemsBought: 0, coinsGifted: 0, quizCorrect: 0, duels: 0,
  speakerTurns: 0, betsWon: 0, betProfit: 0, votesCast: 0,
});

export interface PlayerState {
  id: string;
  token: string;
  name: string;
  avatar: string;
  color: string;
  joinedAt: number;
  roleId: string | null;
  coins: number;
  cerillas: number;
  connected: boolean;
  lastSeen: number;
  left: boolean;
  kicked: boolean;
  ready: boolean;
  /** «Estamos listos»: clave de la espera actual que este jugador quiere saltar (fase:ronda:subestado) */
  readyFor: string | null;
  inventory: { candado: number; voto_doble: number; coartada: number };
  ability: { total: number; roundIndex: number; inRound: number };
  pilladoRound: number;
  /** Doble o nada: una jugada por ronda */
  coinflipRound: number;
  /** Misiones encadenadas sin que nadie te pille (se corta si te queman una) */
  streak: number;
  /** Última ronda en la que ganaste monedas; la casa compadece rachas de sequía */
  lastEarnRound: number;
  notes: string;
  /** Antispam de reacciones a la TV */
  lastReactAt: number;
  /** El Padrino: a quién apadrinó en secreto (una vez por partida) */
  ahijadoId?: string;
  stats: PlayerStats;
}

export interface MissionState {
  id: string;
  missionId: string;
  playerId: string;
  text: string;
  difficulty: MissionDifficulty;
  category: string;
  reward: number;
  targets: string[];
  tags: string[];
  status: 'active' | 'completed' | 'burned' | 'discarded';
  assignedRound: number;
  resolvedAt: number | null;
  /** Misión en pareja: id del cómplice que la comparte */
  partnerId?: string;
  /** Misión de corro: ids de los otros cómplices (dos) */
  partners?: string[];
  /** Misión relámpago: caduca a esta hora (ms epoch) */
  expiresAt?: number;
}

export type ClueSource = 'despensa' | 'investigar' | 'receta' | 'revelado' | 'mirilla' | 'nota' | 'chisme' | 'espejo';

export interface ClueState {
  id: string;
  recipientId: string;
  source: ClueSource;
  text: string;
  truth: 'true' | 'false' | 'ambiguous';
  forgedBy: string | null;
  /** El Notario la ha certificado (la respuesta va en una pista nueva) */
  certified?: boolean;
  round: number;
  createdAt: number;
}

export interface ChallengeState {
  defId: string;
  kind: ChallengeKind;
  status: ChallengeStatus;
  participants: string[];
  passed: boolean | null;
  winners: string[];
  quiz?: { questionIds: string[]; answers: Record<string, number[]> };
  code?: { hiderId: string; code: string; attempts: Record<string, number>; foundBy: string | null; huntStartsAt: number | null };
  impostor?: { word: string; fakeWord: string; infiltradoId: string; votes: Record<string, string> };
  truthLie?: { speakerId: string; lieIndex: number | null; guesses: Record<string, number> };
  social?: { question: string; votes: Record<string, string> };
  interro?: { questions: string[] };
}

export interface RitualState {
  participants: string[];
  choices: Record<string, 'encender' | 'apagar'>;
  status: 'open' | 'revealed';
  apagones: number;
  outcome: 'vela' | 'grieta' | null;
}

export interface VoteState {
  kind: 'juicio' | 'final';
  status: 'open' | 'revealed';
  picks: number;
  isPublic: boolean;
  voters: string[];
  ballots: Record<string, string[]>;
  weights: Record<string, number>;
  tally: { id: string; votes: number }[] | null;
  suspects: string[];
  /** Gran Acusación: apuesta de monedas de cada jugador a quién es Cuco */
  bets: Record<string, { targetId: string; amount: number }>;
}

export interface RoundPlan {
  title: string;
  challengeId: string;
  hasJudgment: boolean;
}

export interface RoundRecord {
  index: number;
  challengeId: string;
  eventIds: string[];
  outcome: 'vela' | 'grieta' | 'none';
  apagones: number;
  ritualParticipants: string[];
  saboteurs: string[];
  suspects: string[];
}

export interface Announcement {
  id: number;
  text: string;
  tone: 'info' | 'danger' | 'safe' | 'special';
  at: number;
}

export interface Game {
  code: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  hostToken: string;
  hostPlayerId: string | null;
  hostLastSeen: number;
  settings: GameSettings;
  phase: Phase;
  phaseEndsAt: number | null;
  /** Timer de fase guardado al pausar (null = pausa sin timer en marcha) */
  pausedRemainingMs: number | null;
  /** Flag de pausa: !== null ⇔ el tiempo de juego está congelado en este instante */
  pausedAt: number | null;
  players: PlayerState[];
  roundIndex: number;
  plan: RoundPlan[];
  rounds: RoundRecord[];
  velas: number;
  grietas: number;
  cucoCount: number;
  challenge: ChallengeState | null;
  ritual: RitualState | null;
  vote: VoteState | null;
  event: { id: string; endsAt: number | null } | null;
  flags: { multiplier: number; shopSale: boolean; noShop: boolean; publicVote: boolean; ladenVote: boolean };
  missions: MissionState[];
  clues: ClueState[];
  announcements: Announcement[];
  announceSeq: number;
  suspects: string[];
  /** Ronda en la que cayeron los sospechosos actuales (la carta solo vale hasta que acabe) */
  suspectRound: number;
  /** Cartas anónimas que los condenados han escrito y que se leerán en la próxima ronda */
  letters: { playerId: string; text: string }[];
  lastJudgment: Record<string, string[]> | null;
  /** Predicción a ciegas de la ronda 1: quién creyó cada uno que sería Cuco */
  predictions: Record<string, string>;
  /** Mercado negro de la ronda: objetos con descuento */
  market: ShopItemId[];
  used: { challenges: string[]; events: string[]; missions: string[]; quiz: string[]; social: string[]; words: number[] };
  finale: Omit<FinaleView, 'step' | 'roles'> | null;
  finaleStep: number;
  sealOpened: number;
  /** El condenado del juicio más reciente: el Voto Lastrado le da peso doble */
  condemned: string[];
  /** Subasta ciega del evento: pujas selladas hasta endsAt; solo paga el ganador */
  auction: { endsAt: number; bids: Record<string, { amount: number; at: number }> } | null;
  /** La Sobremesa: hasta esta hora no hay ¡PILLADO! ni doble o nada (ms epoch) */
  truceUntil: number;
  /** Código de la casa nueva si el director abrió otra noche al terminar */
  rematchTo: string | null;
}

/** Salida de efectos de una acción: avisos a jugadores concretos o a todos. */
export interface Outbox {
  toasts: { to: string | 'all'; toast: Toast }[];
  kicked: string[];
  /** Emojis que flotan unos segundos en la TV */
  reactions: { playerId: string; emoji: string }[];
}

export const newOutbox = (): Outbox => ({ toasts: [], kicked: [], reactions: [] });

// ---------------------------------------------------------------- helpers

export const activePlayers = (g: Game): PlayerState[] => g.players.filter((p) => !p.left);

export function getPlayer(g: Game, id: string): PlayerState {
  const p = g.players.find((pl) => pl.id === id);
  if (!p) throw new GameError('Jugador no encontrado');
  return p;
}

export const roleOf = (p: PlayerState) => (p.roleId ? getRole(p.roleId) : null);
export const factionOf = (p: PlayerState) => roleOf(p)?.faction ?? null;
export const isCuco = (p: PlayerState): boolean => factionOf(p) === 'cuco';
/** Cómo "ven" al jugador las investigaciones: el Cuco Doble pasa por huésped. */
export const seenAsCuco = (p: PlayerState): boolean => isCuco(p) && p.roleId !== 'cuco_doble';

export const nameOf = (g: Game, id: string): string => g.players.find((p) => p.id === id)?.name ?? '???';

export function announce(g: Game, text: string, tone: Announcement['tone'] = 'info'): void {
  g.announcements.push({ id: ++g.announceSeq, text, tone, at: Date.now() });
  if (g.announcements.length > 30) g.announcements.splice(0, g.announcements.length - 30);
}

export function toast(out: Outbox, to: string | 'all', t: Toast): void {
  out.toasts.push({ to, toast: t });
}

/** Ganar monedas. Aplica el multiplicador de evento solo a ganancias. */
export function earn(g: Game, p: PlayerState, amount: number, applyMultiplier = true): number {
  if (amount <= 0) return 0;
  const final = Math.round(amount * (applyMultiplier ? g.flags.multiplier : 1));
  p.coins += final;
  p.stats.coinsEarned += final;
  p.lastEarnRound = g.roundIndex;
  return final;
}

export function spend(p: PlayerState, amount: number): void {
  if (amount > p.coins) throw new GameError('No tienes monedas suficientes');
  p.coins -= amount;
  p.stats.coinsSpent += amount;
}

export const currentPlan = (g: Game): RoundPlan | null => g.plan[g.roundIndex] ?? null;

/** Reloj de la casa: en pausa el tiempo queda clavado en pausedAt, así que los
 *  plazos internos (subasta, tregua, relámpago, escondite del código) no avanzan.
 *  Los que miden cosas del mundo real — gracia de reconexión, reclamo del director —
 *  deben seguir usando Date.now(). */
export const gameNow = (g: Game): number => g.pausedAt ?? Date.now();
export const isLastRound = (g: Game): boolean => g.roundIndex >= g.plan.length - 1;

export function assertPhase(g: Game, ...phases: Phase[]): void {
  if (!phases.includes(g.phase)) throw new GameError('Eso no se puede hacer ahora');
}
