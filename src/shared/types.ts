// Tipos compartidos cliente/servidor. Solo describen CONTENIDO público y VISTAS
// (proyecciones). El estado interno de la partida vive en src/server/engine/state.ts.

export type Faction = 'huesped' | 'cuco' | 'turista';
export type Difficulty = 'facil' | 'normal' | 'dificil';
export type Mode = 'clasico' | 'caos' | 'sofa';
export type MissionDifficulty = 'facil' | 'media' | 'dificil' | 'epica';
export type ChallengeKind = 'physical' | 'quiz' | 'code_hunt' | 'word_impostor' | 'truth_lie' | 'social_vote' | 'interrogatorio';
export type ChallengeCategory = 'mental' | 'social' | 'fisica' | 'movil' | 'mentira';
export type AbilityId = 'investigar' | 'receta' | 'reparar' | 'revelado' | 'falsificar' | 'mano_larga' | 'notario' | 'apadrinar';
export type ShopItemId = 'pista' | 'candado' | 'voto_doble' | 'ganzua' | 'mirilla' | 'sobre' | 'coartada' | 'altavoz' | 'espejo' | 'nota';

export type Phase =
  | 'LOBBY'
  | 'ROLE_REVEAL'
  | 'ROUND_INTRO'
  | 'CHALLENGE'
  | 'RITUAL'
  | 'INVESTIGATION'
  | 'VOTING'
  | 'ROUND_RESULT'
  | 'FINAL_ACCUSATION'
  | 'FINALE';

export type ChallengeStatus = 'briefing' | 'running' | 'judging' | 'voting' | 'done';

// ---------------------------------------------------------------- contenido

export interface RoleDef {
  id: string;
  name: string;
  emoji: string;
  faction: Faction;
  summary: string;
  objective: string;
  ability?: {
    id: AbilityId;
    name: string;
    text: string;
    targets: 0 | 1 | 2;
    targetLabels?: string[];
    perRound?: number;
    perGame?: number;
  };
  passive?: { name: string; text: string };
}

/** Retoques de contenido que el anfitrión hace al crear su casa. Solo viven en esta partida. */
export interface ContentMod {
  /** Ids que esta casa no quiere ver: m001, c03, e02, q05, suspect:x, couple:y, interro:N, social:N */
  disabled?: string[];
  /** Reescrituras: id -> nuevo texto. `${id}:title` cambia el título de pruebas y eventos. */
  edits?: Record<string, string>;
  /** Preguntas propias para el interrogatorio */
  extraInterro?: string[];
  /** Preguntas propias para el "¿quién es más probable?" */
  extraSocial?: string[];
}

export interface GameSettings {
  durationMin: 30 | 60 | 90 | 120;
  difficulty: Difficulty;
  mode: Mode;
  expectedPlayers: number;
  hostPlays: boolean;
  /** La casa avanza sola entre fases narrativas; el director solo arbitra */
  autopilot?: boolean;
  /** Misiones escritas por el anfitrión: chistes internos del grupo. Se mezclan con el pool. */
  customMissions?: string[];
  /** Contenido editado/desactivado/añadido por el anfitrión para esta casa */
  contentMod?: ContentMod;
}

// ---------------------------------------------------------------- vistas

export interface PublicPlayer {
  id: string;
  name: string;
  avatar: string;
  color: string;
  coins: number;
  connected: boolean;
  left: boolean;
  isHost: boolean;
  ready: boolean;
  suspect: boolean;
  /** Ha enviado su acción en la fase actual (votar, ritual, prueba). Nunca QUÉ ha enviado. */
  acted: boolean;
}

export interface RoundView {
  index: number;
  total: number;
  title: string;
  hasJudgment: boolean;
}

export interface EventView {
  id: string;
  emoji: string;
  title: string;
  text: string;
  endsAt: number | null;
  /** El apagón: la pantalla de la casa se va a negro mientras endsAt siga vivo */
  blackout?: boolean;
}

export interface TallyEntry {
  id: string;
  votes: number;
}

export interface ChallengeView {
  id: string;
  kind: ChallengeKind;
  category: ChallengeCategory;
  title: string;
  instructions: string;
  status: ChallengeStatus;
  scoring: 'passfail' | 'winner';
  participants: string[];
  isParticipant: boolean;
  reward: number;
  durationSec: number;
  endsAt: number | null;
  passed: boolean | null;
  winners: string[];
  affectsCandles: boolean;
  /** Parte privada del destinatario */
  mine: {
    quiz?: { questions: { q: string; options: string[] }[]; answers: number[] | null };
    code?: { isHider: boolean; code: string | null; attemptsLeft: number };
    impostor?: { word: string; vote: string | null };
    truthLie?: { isSpeaker: boolean; lieIndex: number | null; guess: number | null };
    social?: { vote: string | null };
  };
  /** Datos públicos del desarrollo */
  pub: {
    hiderId?: string;
    speakerId?: string;
    question?: string;
    questions?: string[];
    foundBy?: string | null;
    huntStartsAt?: number | null;
  };
  /** Solo cuando status === 'done' */
  result?: {
    quiz?: { correctRate: number; questions: { q: string; options: string[]; answer: number }[] };
    code?: { code: string; foundBy: string | null };
    impostor?: { infiltradoId: string; word: string; fakeWord: string; tally: TallyEntry[]; caught: boolean };
    truthLie?: { lieIndex: number | null; tally: { option: number; votes: number }[]; fooled: boolean };
    social?: { tally: TallyEntry[]; top: string[] };
  };
}

export interface RitualView {
  status: 'open' | 'revealed';
  participants: string[];
  isParticipant: boolean;
  myChoice: 'encender' | 'apagar' | null;
  submittedCount: number;
  result?: { apagones: number; outcome: 'vela' | 'grieta' };
}

export interface VoteView {
  kind: 'juicio' | 'final';
  status: 'open' | 'revealed';
  picks: number;
  isPublic: boolean;
  votedCount: number;
  total: number;
  myVote: string[] | null;
  myWeight: number;
  /** Casino de la Gran Acusación: público, para el cachondeo */
  bets: { playerId: string; targetId: string; amount: number }[];
  myBet: { targetId: string; amount: number } | null;
  result?: { tally: TallyEntry[]; suspects: string[]; ballots?: { voterId: string; targets: string[] }[] };
}

export interface RoundSummary {
  index: number;
  outcome: 'vela' | 'grieta' | 'none';
  challengeTitle: string;
  apagones: number;
  suspects: string[];
}

export interface MissionView {
  id: string;
  text: string;
  difficulty: MissionDifficulty;
  category: string;
  reward: number;
  status: 'active' | 'completed' | 'burned' | 'discarded';
  suspect?: boolean;
  /** Misión en pareja: nombre del cómplice */
  partner?: string;
  /** Misión de corro: `partner` trae los dos cómplices */
  corro?: boolean;
  /** Orden secreta de sabotaje en la prueba de equipo */
  saboteur?: boolean;
  /** Escrita por el anfitrión para este grupo concreto */
  custom?: boolean;
  /** Misión relámpago: caduca a esta hora (ms epoch) */
  expiresAt?: number;
}

export interface ClueView {
  id: string;
  source: 'despensa' | 'investigar' | 'receta' | 'revelado' | 'mirilla' | 'nota' | 'chisme' | 'espejo';
  text: string;
  round: number;
  createdAt: number;
  /** El Notario ya certificó esta nota */
  certified?: boolean;
}

export interface MeView {
  id: string;
  name: string;
  avatar: string;
  color: string;
  coins: number;
  isHost: boolean;
  ready: boolean;
  left: boolean;
  role: RoleDef | null;
  teammates: string[];
  cerillas: number;
  inventory: { candado: number; voto_doble: number; coartada: number };
  ability: { usesLeft: number | null; canUse: boolean; reason: string | null } | null;
  pilladoAvailable: boolean;
  notes: string;
  /** Predicción a ciegas de la ronda 1: a quién huele a Cuco (solo la ve él) */
  prediction: string | null;
  /** Bajo sospecha: puede dejar una carta anónima que la casa leerá la próxima ronda */
  canLetter?: boolean;
  /** El Padrino: nombre de su ahijado (solo lo ve él) */
  ahijado?: string;
}

export interface Award {
  id: string;
  emoji: string;
  title: string;
  playerId: string;
  reason: string;
}

export interface FinaleView {
  step: number;
  totalSteps: number;
  headline: { players: number; missions: number; clues: number; traiciones: number; velas: number; grietas: number };
  reveal: { playerId: string; roleId: string; faction: Faction }[];
  roles: Record<string, RoleDef>;
  unmasked: string[];
  accusation: TallyEntry[];
  balance: { huespedes: number; cucos: number; winner: 'huespedes' | 'cucos' };
  turistaWon: string | null;
  /** El Buscavidas gana si acaba entre los 3 más ricos (conteo antes de bonos) */
  buscavidasWon: string | null;
  /** El Padrino gana si su ahijado resultó ser un Cuco que salió impune */
  padrinoWon: string | null;
  /** El Ermitaño cobra su voto de silencio si no votó en ningún juicio */
  ermitanoWon: string | null;
  missionHighlights: { playerId: string; text: string; difficulty: MissionDifficulty }[];
  falseClues: { recipientId: string; text: string; forgedBy: string | null }[];
  awards: Award[];
  ranking: { playerId: string; coins: number; bonus: number; total: number }[];
  /** Apuestas resueltas en la Gran Acusación */
  bets: { playerId: string; targetId: string; amount: number; won: boolean }[];
  /** Predicciones a ciegas de la ronda 1, resueltas: quién olió a un Cuco sin datos */
  predictions: { playerId: string; targetId: string; hit: boolean }[];
  /** Relato legible de lo que pasó, para leer en voz alta al final */
  chronicle: string[];
  funStats: string[];
  sealOpenedTimes: number;
}

export interface HostView {
  primary: { label: string; enabled: boolean; hint: string | null };
  canJudge: boolean;
  canPickWinners: boolean;
  eventsAvailable: { id: string; emoji: string; title: string }[];
  isDirectorDevice: boolean;
  sealAvailable: boolean;
  secrets: { playerId: string; roleName: string; emoji: string; faction: Faction }[] | null;
  joinUrlPath: string;
}

export interface GameView {
  audience: 'player' | 'director';
  serverNow: number;
  version: number;
  code: string;
  phase: Phase;
  settings: GameSettings;
  round: RoundView | null;
  velas: number;
  grietas: number;
  candleSlots: number;
  cucoCount: number;
  players: PublicPlayer[];
  phaseEndsAt: number | null;
  pausedRemainingMs: number | null;
  /** Momento en que empezó el tiempo muerto: los plazos internos se miden desde aquí */
  pausedAt: number | null;
  event: EventView | null;
  challenge: ChallengeView | null;
  ritual: RitualView | null;
  vote: VoteView | null;
  lastRound: RoundSummary | null;
  /** Subasta ciega abierta: solo se ve cuántas pujas hay y la tuya — jamás las ajenas */
  auction: { endsAt: number; bidsCount: number; myBid: number | null } | null;
  shopOpen: boolean;
  shopPrices: Record<ShopItemId, number>;
  /** Mercado negro de la ronda: objetos a precio reducido */
  market: ShopItemId[];
  announcements: { id: number; text: string; tone: 'info' | 'danger' | 'safe' | 'special'; at: number }[];
  finale: FinaleView | null;
  hostOnline: boolean;
  /** «Estamos listos»: en esperas de director/timer, quién ya ha confirmado. null fuera de esas esperas. */
  readyUp: { count: number; total: number; mine: boolean } | null;
  me?: MeView;
  missions?: MissionView[];
  clues?: ClueView[];
  host?: HostView;
}

export interface Toast {
  text: string;
  tone: 'info' | 'danger' | 'safe' | 'special' | 'coins';
  private?: boolean;
  sound?: 'mission' | 'danger' | 'coins' | 'reveal' | 'victory';
}

export interface Ack {
  ok: boolean;
  error?: string;
}
