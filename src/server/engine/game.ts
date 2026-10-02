// Máquina de estados y acciones. Todas las funciones mutan `g` y dejan efectos en `out`.
// Las transiciones solo ocurren aquí: el cliente nunca decide la fase.
import {
  AUCTION_MIN_BID,
  AUTO_DELAY_SEC,
  AVATARS,
  DROUGHT_BONUS,
  DROUGHT_ROUNDS,
  GANZUA_STEAL,
  LETTER_MAX_LEN,
  MANO_LARGA_STEAL,
  REACTION_EMOJIS,
  REACT_COOLDOWN_MS,
  MARKET_DISCOUNT,
  MARKET_SIZE,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PLAYER_COLORS,
  SHOP_ITEMS,
  SHOP_PRICES,
  START_COINS,
  TAKEOVER_GRACE_MS,
} from '../../shared/constants.ts';
import type { GameSettings, ShopItemId } from '../../shared/types.ts';
import {
  defOf,
  finalizeChallenge,
  judgeChallenge,
  pendingResponders,
  setupChallenge,
  startRunning,
  stopRunning,
  submitChallenge,
  type ChallengeInput,
} from './challenges.ts';
import { deliverClue, forgedNote, investigate, randomClue, recipe, shopClueTruth, voteReveal } from './clues.ts';
import { applyEvent, resolveAuction, rollRoundEvent } from './events.ts';
import { FINALE_STEPS, computeFinale } from './finale.ts';
import { claimMission, dealMissions, discardMission, futureJudgment, pillar } from './missions.ts';
import { buildPlan, needsRitual } from './plan.ts';
import { gameContent } from '../content.ts';
import { chance, secretToken, shortId, shuffle } from './rng.ts';
import { assignRoles } from './roles.ts';
import {
  type Game,
  GameError,
  type Outbox,
  type PlayerState,
  activePlayers,
  announce,
  assertPhase,
  currentPlan,
  earn,
  emptyStats,
  gameNow,
  getPlayer,
  isCuco,
  isLastRound,
  roleOf,
  seenAsCuco,
  spend,
  toast,
} from './state.ts';

export const TIMERS = { investigation: 240, ritual: 45, vote: 90, finalVote: 120 };
export const HOST_CLAIM_AFTER_MS = 60_000;

// ================================================================ creación

export function createGame(code: string, settings: GameSettings): Game {
  const now = Date.now();
  return {
    code, version: 0, createdAt: now, updatedAt: now, startedAt: null, finishedAt: null,
    hostToken: secretToken(), hostPlayerId: null, hostLastSeen: now, settings,
    phase: 'LOBBY', phaseEndsAt: null, pausedRemainingMs: null, pausedAt: null,
    players: [], roundIndex: -1, plan: [], rounds: [], velas: 0, grietas: 0, cucoCount: 0,
    challenge: null, ritual: null, vote: null, event: null,
    flags: { multiplier: 1, shopSale: false, noShop: false, publicVote: false, ladenVote: false },
    missions: [], clues: [], announcements: [], announceSeq: 0, suspects: [], suspectRound: -1, letters: [], lastJudgment: null, market: [],
    condemned: [], truceUntil: 0,
    predictions: {},
    used: { challenges: [], events: [], missions: [], quiz: [], social: [], words: [] },
    auction: null, finale: null, finaleStep: 0, sealOpened: 0, rematchTo: null,
  };
}

export function addPlayer(g: Game, rawName: string, avatar: string): PlayerState {
  if (g.phase !== 'LOBBY') throw new GameError('La partida ya ha empezado');
  const name = rawName.trim().replace(/\s+/g, ' ').slice(0, 16);
  if (!name) throw new GameError('Escribe tu nombre');
  const active = activePlayers(g);
  if (active.length >= MAX_PLAYERS) throw new GameError('La casa está llena');
  if (active.some((p) => p.name.toLocaleLowerCase('es') === name.toLocaleLowerCase('es'))) throw new GameError('Ya hay alguien con ese nombre');
  const usedColors = new Set(active.map((p) => p.color));
  const player: PlayerState = {
    id: shortId(), token: secretToken(), name,
    avatar: (AVATARS as readonly string[]).includes(avatar) ? avatar : AVATARS[g.players.length % AVATARS.length],
    color: PLAYER_COLORS.find((c) => !usedColors.has(c)) ?? PLAYER_COLORS[0],
    joinedAt: Date.now(), roleId: null, coins: START_COINS, cerillas: 0,
    connected: false, lastSeen: Date.now(), left: false, kicked: false, ready: false, readyFor: null,
    inventory: { candado: 0, voto_doble: 0, coartada: 0 }, ability: { total: 0, roundIndex: -1, inRound: 0 },
    pilladoRound: -1, coinflipRound: -1, streak: 0, lastEarnRound: -1, notes: '', lastReactAt: 0, stats: emptyStats(),
  };
  g.players.push(player);
  return player;
}

/** Otro móvil toma el relevo de un jugador ausente (batería muerta, móvil roto).
 *  La identidad (nombre, rol, misiones, monedas) se conserva: para la casa sigue siendo la misma persona. */
export function takeOverPlayer(g: Game, playerId: string, out: Outbox): PlayerState {
  if (g.phase === 'FINALE') throw new GameError('La noche ya ha terminado');
  const p = getPlayer(g, playerId);
  if (p.kicked) throw new GameError('Esa persona no puede volver a esta casa');
  if (!p.left && p.connected) throw new GameError(`${p.name} sigue conectado`);
  if (!p.left && Date.now() - p.lastSeen < TAKEOVER_GRACE_MS) throw new GameError(`${p.name} acaba de caerse; dale un momento a ver si vuelve`);
  const wasOut = p.left;
  p.token = secretToken(); // la llave vieja deja de funcionar
  p.left = false;
  p.ready = false;
  p.readyFor = null; // quien llega con otro móvil no hereda confirmaciones que no pulsó
  p.lastSeen = Date.now();
  out.kicked.push(p.id); // desconecta el socket del móvil anterior, si seguía abierto
  announce(g, wasOut ? `🔁 ${p.name} vuelve a la casa con otro móvil.` : `🔁 Un relevo toma el papel de ${p.name}.`, 'special');
  toast(out, 'all', { text: `🔁 ${p.name} tiene otro móvil`, tone: 'special' });
  return p;
}

/** Crea una casa nueva conservando la gente de la que terminó (misma llave por móvil). */
export function rematchGame(g: Game, newCode: string): Game {
  assertPhase(g, 'FINALE');
  if (g.finaleStep < FINALE_STEPS - 1) throw new GameError('Termina la ceremonia antes de abrir otra noche');
  if (g.rematchTo) throw new GameError('Ya hay otra casa abierta');
  const roster = g.players.filter((p) => !p.left && !p.kicked);
  const ng = createGame(newCode, { ...g.settings, expectedPlayers: roster.length });
  for (const p of roster) {
    const np = addPlayer(ng, p.name, p.avatar);
    np.id = p.id;
    np.token = p.token;
    np.color = p.color;
  }
  ng.hostPlayerId = g.hostPlayerId && roster.some((p) => p.id === g.hostPlayerId) ? g.hostPlayerId : null;
  ng.settings.hostPlays = ng.hostPlayerId !== null;
  g.rematchTo = ng.code;
  return ng;
}

// ================================================================ transiciones

function setPhase(g: Game, phase: Game['phase'], timerSec: number | null = null): void {
  g.phase = phase;
  g.phaseEndsAt = timerSec ? Date.now() + timerSec * 1000 : null;
  g.pausedRemainingMs = null;
  g.pausedAt = null;
}

export function startGame(g: Game, out: Outbox): void {
  assertPhase(g, 'LOBBY');
  const active = activePlayers(g);
  if (active.length < MIN_PLAYERS) throw new GameError(`Hacen falta al menos ${MIN_PLAYERS} jugadores`);
  // Quien salió en la sala antes de empezar no cuenta para nada
  g.players = g.players.filter((p) => !p.left);
  // El plan va antes que los roles: sin juicios (turbo) hay oficios que no tienen sentido
  g.plan = buildPlan(g.settings, active.length, gameContent(g));
  assignRoles(g);
  g.startedAt = Date.now();
  g.players.forEach((p) => { p.ready = false; p.readyFor = null; });
  setPhase(g, 'ROLE_REVEAL');
  toast(out, 'all', { text: 'Tu identidad está lista. Que nadie mire.', tone: 'special', sound: 'reveal' });
}

// Las cartas de los condenados se leen en voz alta al empezar la ronda
// siguiente — anónimas, sin remite. Si la noche acaba antes, caen en la ceremonia.
function flushLetters(g: Game, out: Outbox): void {
  if (!g.letters.length) return;
  for (const l of g.letters) {
    announce(g, `📜 Una carta anónima ha aparecido bajo la puerta: «${l.text}»`, 'special');
    toast(out, 'all', { text: `📜 Carta anónima: «${l.text}»`, tone: 'special', sound: 'reveal' });
  }
  g.letters = [];
}

function startRound(g: Game, index: number, out: Outbox): void {
  g.roundIndex = index;
  const plan = currentPlan(g)!;
  const ladenPending = g.flags.ladenVote; // el voto lastrado sobrevive hasta el próximo juicio
  g.flags = { multiplier: 1, shopSale: false, noShop: false, publicVote: false, ladenVote: ladenPending };
  g.truceUntil = 0; // la sobremesa no cruza de ronda
  g.event = null;
  g.challenge = null;
  g.ritual = null;
  g.vote = null;
  // suspects nace vacío: el juicio de ESTA ronda lo rellena; heredar los de la
  // anterior haría que la crónica dijera «el juicio señaló a…» sin juicio
  g.rounds.push({ index, challengeId: plan.challengeId, eventIds: [], outcome: 'none', apagones: 0, ritualParticipants: [], saboteurs: [], suspects: [] });
  g.auction = null; // una subasta abierta no cruza de ronda
  setPhase(g, 'ROUND_INTRO');
  flushLetters(g, out);
  // La casa compadece: quien lleva dos rondas en blanco recibe unas monedas de limosna
  for (const p of activePlayers(g)) {
    if (index - 1 - p.lastEarnRound >= DROUGHT_ROUNDS) {
      const gained = earn(g, p, DROUGHT_BONUS, false);
      toast(out, p.id, { text: `🥺 La casa se compadece de tu sequía · +${gained} 🪙`, tone: 'coins', private: true, sound: 'coins' });
      announce(g, `🥺 ${p.name} lleva ${DROUGHT_ROUNDS} rondas sin ver una moneda. La casa se apiada (+${gained} 🪙).`, 'info');
    }
  }
  rollMarket(g);
  dealMissions(g, out);
  const event = rollRoundEvent(g);
  if (event) applyEvent(g, event.id, out);
}

// El mercado negro: cada ronda unos objetos salen a precio de ganga. Se anuncia —
// la gracia es ver a todos correr a la Despensa por el Espejo rebajado.
const MARKET_POOL: ShopItemId[] = ['pista', 'candado', 'voto_doble', 'ganzua', 'mirilla', 'coartada', 'altavoz', 'espejo', 'nota'];

function rollMarket(g: Game): void {
  g.market = shuffle(MARKET_POOL).slice(0, MARKET_SIZE);
  if (g.roundIndex > 0) {
    const names = g.market.map((id) => SHOP_ITEMS.find((i) => i.id === id)!.name).join(', ');
    announce(g, `🕶️ El mercado negro ha llegado a la casa: ${names} a precio de ganga durante esta ronda.`, 'special');
  }
}

function enterChallenge(g: Game, out: Outbox): void {
  // Sin jugadores activos no hay prueba que montar (pick() sobre lista vacía
  // lanzaría un Error genérico — mejor un mensaje que diga lo que pasa)
  if (!activePlayers(g).length) throw new GameError('No queda nadie en la casa');
  g.challenge = setupChallenge(g, currentPlan(g)!.challengeId, out);
  g.used.challenges.push(g.challenge.defId);
  setPhase(g, 'CHALLENGE');
}

function recordOutcome(g: Game, outcome: 'vela' | 'grieta'): void {
  if (outcome === 'vela') g.velas++;
  else g.grietas++;
  const round = g.rounds[g.roundIndex];
  if (round) round.outcome = outcome;
}

function leaveChallenge(g: Game, out: Outbox): void {
  const c = g.challenge!;
  const def = defOf(g, c);
  if (c.passed === true && needsRitual(def)) {
    const participants = c.participants.filter((id) => !getPlayer(g, id).left && !g.suspects.includes(id));
    g.suspects = []; // la exclusión solo vale para este Ritual
    if (participants.length) {
      g.ritual = { participants, choices: {}, status: 'open', apagones: 0, outcome: null };
      g.rounds[g.roundIndex].ritualParticipants = participants;
      setPhase(g, 'RITUAL', TIMERS.ritual);
      participants.forEach((id) => toast(out, id, { text: 'Ritual de la Vela: decide en secreto.', tone: 'special', private: true, sound: 'reveal' }));
      return;
    }
    recordOutcome(g, 'vela');
  } else if (c.passed === true) recordOutcome(g, 'vela');
  else if (c.passed === false) recordOutcome(g, 'grieta');
  enterInvestigation(g);
}

function revealRitual(g: Game, out: Outbox): void {
  const r = g.ritual!;
  const saboteurs: string[] = [];
  for (const id of r.participants) {
    const p = getPlayer(g, id);
    if (r.choices[id] !== 'apagar') continue;
    if (isCuco(p) && p.cerillas > 0) {
      p.cerillas--;
      p.stats.apagones++;
      saboteurs.push(id);
    } else if (!isCuco(p)) p.stats.bluffApagar++;
  }
  r.apagones = saboteurs.length;
  r.outcome = saboteurs.length ? 'grieta' : 'vela';
  r.status = 'revealed';
  g.phaseEndsAt = null;
  g.pausedRemainingMs = null; // el timer guardado era del ritual abierto, ya cerrado
  const round = g.rounds[g.roundIndex];
  round.apagones = saboteurs.length;
  round.saboteurs = saboteurs;
  recordOutcome(g, r.outcome);
  if (saboteurs.length) {
    announce(g, `La vela se ha apagado. ${saboteurs.length === 1 ? 'Hubo un apagón' : `Hubo ${saboteurs.length} apagones`} en el Ritual.`, 'danger');
    toast(out, 'all', { text: '🕳️ Se abre una grieta', tone: 'danger', sound: 'danger' });
  } else {
    announce(g, 'La vela sigue encendida. La casa respira.', 'safe');
    toast(out, 'all', { text: '🕯️ Se enciende una vela', tone: 'safe', sound: 'victory' });
  }
}

function enterInvestigation(g: Game): void {
  setPhase(g, 'INVESTIGATION', TIMERS.investigation);
}

function enterVoting(g: Game, kind: 'juicio' | 'final'): void {
  const voters = activePlayers(g).map((p) => p.id);
  g.vote = {
    kind, status: 'open', picks: kind === 'final' ? Math.max(1, g.cucoCount) : 1,
    isPublic: kind === 'juicio' && g.flags.publicVote, voters, ballots: {}, weights: {}, tally: null, suspects: [], bets: {},
  };
  setPhase(g, kind === 'final' ? 'FINAL_ACCUSATION' : 'VOTING', kind === 'final' ? TIMERS.finalVote : TIMERS.vote);
}

function revealJudgment(g: Game): void {
  const v = g.vote!;
  // El voto lastrado pesa en el recuento, no al emitirse — así vale aunque el
  // evento se lance con la votación abierta o el condenado haya votado ya
  if (g.flags.ladenVote) for (const id of g.condemned) if (v.ballots[id]) v.weights[id] = (v.weights[id] ?? 1) + 1;
  const counts = new Map<string, number>();
  for (const [voter, targets] of Object.entries(v.ballots)) {
    for (const t of targets) counts.set(t, (counts.get(t) ?? 0) + (v.weights[voter] ?? 1));
    const voterP = getPlayer(g, voter);
    if (targets.some((t) => isCuco(getPlayer(g, t)))) voterP.stats.correctVotes++;
  }
  const tally = [...counts.entries()].map(([id, votes]) => ({ id, votes })).sort((a, b) => b.votes - a.votes);
  tally.forEach((t) => (getPlayer(g, t.id).stats.votesReceived += t.votes));
  const max = tally[0]?.votes ?? 0;
  const top = tally.filter((t) => t.votes === max).map((t) => t.id);
  // Más votado (o empate de dos) queda bajo sospecha. Con votos dispersos, nadie.
  v.suspects = max >= 2 && top.length <= 2 ? top : [];
  v.tally = tally;
  v.status = 'revealed';
  g.phaseEndsAt = null;
  g.pausedRemainingMs = null; // el timer guardado era de la votación abierta, ya cerrada
  g.suspects = v.suspects;
  g.flags.ladenVote = false; // consumido por este juicio
  g.condemned = [...v.suspects]; // el Voto Lastrado los recuerda en el próximo juicio
  g.suspectRound = g.roundIndex;
  v.suspects.forEach((id) => getPlayer(g, id).stats.suspectRounds++);
  g.lastJudgment = { ...v.ballots };
  const round = g.rounds[g.roundIndex];
  if (round) round.suspects = v.suspects;
  if (v.suspects.length) announce(g, `Bajo sospecha: ${v.suspects.map((id) => getPlayer(g, id).name).join(' y ')}. Se perderán el próximo Ritual y la casa les pondrá una tarea sospechosa.`, 'danger');
  else announce(g, 'Los votos están muy repartidos. Nadie queda bajo sospecha.', 'info');
}

function enterFinale(g: Game, out: Outbox): void {
  flushLetters(g, out); // cartas del último juicio: se leen antes de la ceremonia
  g.finale = computeFinale(g);
  g.finaleStep = 0;
  g.finishedAt = Date.now();
  setPhase(g, 'FINALE');
  toast(out, 'all', { text: 'La noche termina...', tone: 'special', sound: 'reveal' });
}

/** «Estamos listos»: clave de la espera actual. Solo existe en los momentos en
 *  que la casa espera al director o a un temporizador sin que nadie deba actuar —
 *  nunca durante inputs reales (votos, rituales, respuestas) ni arbitrajes. */
export function readyKey(g: Game): string | null {
  switch (g.phase) {
    case 'ROUND_INTRO':
      return `ri:${g.roundIndex}`;
    case 'CHALLENGE': {
      const s = g.challenge?.status;
      return s === 'briefing' || s === 'done' ? `ch:${g.roundIndex}:${s}` : null;
    }
    case 'RITUAL':
      return g.ritual?.status === 'revealed' ? `rit:${g.roundIndex}` : null;
    case 'INVESTIGATION':
      return `inv:${g.roundIndex}`;
    case 'VOTING':
      return g.vote?.status === 'revealed' ? `vote:${g.roundIndex}` : null;
    case 'ROUND_RESULT':
      return `res:${g.roundIndex}`;
    // La Gran Acusación es input real (acusar y apostar): no hay nada que confirmar
    case 'FINAL_ACCUSATION':
      return null;
    default:
      return null;
  }
}

export function readyUp(g: Game): { count: number; total: number } | null {
  const key = readyKey(g);
  if (!key) return null;
  const connected = activePlayers(g).filter((x) => x.connected);
  return { count: connected.filter((x) => x.readyFor === key).length, total: connected.length };
}

/** Si todo el que puede pulsar lo ha pulsado, la espera se acaba aquí. Un móvil
 *  caído no cuenta: no puede consentir ni bloquear (misma regla que ROLE_REVEAL). */
function maybeAdvanceAllReady(g: Game, out: Outbox): void {
  // En pausa el tiempo está parado: ninguna espera salta mientras el director respira
  if (g.pausedAt !== null) return;
  const key = readyKey(g);
  if (!key) return;
  const active = activePlayers(g);
  // every() sobre lista vacía es true: una casa sin jugadores activos no se auto-aventa
  if (active.length && active.every((x) => x.readyFor === key || !x.connected)) advance(g, out);
}

/** Botón principal del director. Avanza según la fase y sub-estado actuales. */
export function advance(g: Game, out: Outbox): void {
  const now = Date.now();
  switch (g.phase) {
    case 'LOBBY':
      return startGame(g, out);
    case 'ROLE_REVEAL':
      return startRound(g, 0, out);
    case 'ROUND_INTRO':
      return enterChallenge(g, out);
    case 'CHALLENGE': {
      const c = g.challenge!;
      if (c.status === 'briefing') return startRunning(g, now);
      if (c.status === 'running') return stopRunning(g, out);
      if (c.status === 'voting') return finalizeChallenge(g, out);
      if (c.status === 'judging') throw new GameError('Marca si la prueba se ha superado');
      return leaveChallenge(g, out);
    }
    case 'RITUAL':
      if (g.ritual!.status === 'open') return revealRitual(g, out);
      return enterInvestigation(g);
    case 'INVESTIGATION':
      if (currentPlan(g)!.hasJudgment) return enterVoting(g, 'juicio');
      return setPhase(g, 'ROUND_RESULT');
    case 'VOTING':
      if (g.vote!.status === 'open') return revealJudgment(g);
      return setPhase(g, 'ROUND_RESULT');
    case 'ROUND_RESULT':
      if (isLastRound(g)) return enterVoting(g, 'final');
      return startRound(g, g.roundIndex + 1, out);
    case 'FINAL_ACCUSATION':
      return enterFinale(g, out);
    case 'FINALE':
      if (g.finaleStep < FINALE_STEPS - 1) {
        g.finaleStep++;
        // Con piloto cada paso de la ceremonia respira su propia cuenta atrás
        if (g.settings.autopilot && g.phaseEndsAt !== null) g.phaseEndsAt = Date.now() + AUTO_DELAY_SEC.finaleStep * 1000;
      } else g.phaseEndsAt = null;
      return;
  }
}

/** Piloto automático: segundos que la casa espera sola en fases de narración.
 *  Devuelve null en fases que necesitan a un humano (arbitraje, arranque). */
export function autoAdvanceDelay(g: Game): number | null {
  switch (g.phase) {
    case 'ROLE_REVEAL':
      return AUTO_DELAY_SEC.roleReveal;
    case 'ROUND_INTRO':
      return AUTO_DELAY_SEC.roundIntro;
    case 'CHALLENGE': {
      const s = g.challenge?.status;
      if (s === 'briefing') return AUTO_DELAY_SEC.briefing;
      if (s === 'done') return AUTO_DELAY_SEC.challengeDone;
      return null; // running/voting llevan su propio timer; judging es del director
    }
    case 'RITUAL':
      return g.ritual?.status === 'revealed' ? AUTO_DELAY_SEC.ritualRevealed : null;
    case 'VOTING':
      return g.vote?.status === 'revealed' ? AUTO_DELAY_SEC.voteRevealed : null;
    case 'ROUND_RESULT':
      return AUTO_DELAY_SEC.roundResult;
    case 'FINALE':
      return g.finaleStep < FINALE_STEPS - 1 ? AUTO_DELAY_SEC.finaleStep : null;
    default:
      return null;
  }
}

/** Temporizadores. Devuelve true si ha cambiado algo. */
export function tick(g: Game, out: Outbox, now = Date.now()): boolean {
  // En pausa el mundo se congela: misiones relámpago, subasta y eventos también esperan
  if (g.pausedAt !== null) return false;
  // Las misiones relámpago caducan cuando cae su cuenta atrás
  const expired = g.missions.filter((m) => m.status === 'active' && m.expiresAt && now >= m.expiresAt);
  if (expired.length) {
    for (const m of expired) {
      m.status = 'discarded';
      m.resolvedAt = now;
      toast(out, m.playerId, { text: '⚡ Tu misión relámpago se ha apagado', tone: 'danger', private: true, sound: 'danger' });
    }
    announce(g, '⚡ La misión relámpago se ha apagado. Quien no llegó, se quedó sin ella.', 'danger');
    return true;
  }
  if (g.auction && now >= g.auction.endsAt) {
    resolveAuction(g, out);
    return true;
  }
  if (g.event?.endsAt && now >= g.event.endsAt) {
    g.event = { ...g.event, endsAt: null };
    announce(g, 'El evento ha terminado.', 'info');
    return true;
  }
  // El piloto arma cuentas atrás en las fases que antes esperaban al director
  if (g.settings.autopilot && g.phaseEndsAt === null && g.pausedAt === null) {
    const delay = autoAdvanceDelay(g);
    if (delay !== null) {
      g.phaseEndsAt = now + delay * 1000;
      return true;
    }
  }
  if (!g.phaseEndsAt || g.pausedAt !== null || now < g.phaseEndsAt) return false;
  const fired = g.phase;
  g.phaseEndsAt = null;
  switch (fired) {
    case 'CHALLENGE':
    case 'RITUAL':
    case 'INVESTIGATION':
    case 'VOTING':
      advance(g, out);
      return true;
    case 'FINAL_ACCUSATION':
      // Sin piloto el director decide cuándo revelar; con piloto la casa continúa sola
      if (g.settings.autopilot) advance(g, out);
      return true;
    default:
      if (g.settings.autopilot && g.phase !== 'LOBBY') advance(g, out);
      return true;
  }
}

// ================================================================ director

export type HostAction =
  | { type: 'start' | 'advance' | 'pause' | 'resume' | 'end' | 'openSeal' }
  | { type: 'judge'; passed?: boolean; winners?: string[] }
  | { type: 'extend'; seconds: number }
  | { type: 'event'; eventId: string }
  | { type: 'autopilot'; on: boolean }
  | { type: 'adjustCoins'; playerId: string; delta: number }
  | { type: 'kick'; playerId: string };

export function hostAction(g: Game, a: HostAction, out: Outbox, isDirectorDevice: boolean): void {
  switch (a.type) {
    case 'start':
      return startGame(g, out);
    case 'advance':
    case 'judge':
    case 'end': {
      // Mientras la casa respira no cambia de fase: setPhase pondría un timer nuevo
      // que resume pisaría con el pausedRemainingMs de la fase vieja
      if (g.pausedAt !== null) throw new GameError('Está en pausa');
      if (a.type === 'advance') return advance(g, out);
      if (a.type === 'judge') {
        assertPhase(g, 'CHALLENGE');
        return judgeChallenge(g, a, out);
      }
      if (g.phase === 'LOBBY') throw new GameError('La partida no ha empezado');
      if (g.phase === 'FINALE') return;
      if (!g.vote || g.vote.kind !== 'final') g.vote = null;
      return enterFinale(g, out);
    }
    case 'extend':
      // Con pausa sin temporizador de fase no hay nada que alargar: silencio
      if (g.pausedAt !== null) g.pausedRemainingMs = g.pausedRemainingMs === null ? null : g.pausedRemainingMs + a.seconds * 1000;
      else if (g.phaseEndsAt) g.phaseEndsAt += a.seconds * 1000;
      else throw new GameError('No hay temporizador en marcha');
      return;
    case 'pause': {
      // La pausa congela el mundo entero — también los plazos internos (evento,
      // subasta, relámpago, escondite). No hace falta un timer de fase en marcha.
      if (g.pausedAt !== null) throw new GameError('Ya está en pausa');
      if (g.phase === 'LOBBY') throw new GameError('La partida no ha empezado');
      const now = Date.now();
      g.pausedRemainingMs = g.phaseEndsAt ? Math.max(0, g.phaseEndsAt - now) : null;
      g.pausedAt = now;
      g.phaseEndsAt = null;
      announce(g, 'Tiempo muerto.', 'info');
      return;
    }
    case 'resume': {
      if (g.pausedAt === null) throw new GameError('No está en pausa');
      const now = Date.now();
      const pausedFor = g.pausedAt ? now - g.pausedAt : 0;
      // Los contadores internos también se mueven: la pausa no consume sus plazos
      const hunt = g.challenge?.code;
      if (hunt?.huntStartsAt) hunt.huntStartsAt += pausedFor;
      // La tregua se desplaza si seguía viva al congelarse — comparar con `now`
      // la mataría en silencio cuando la pausa dura más que lo que le quedaba
      if (g.pausedAt !== null && g.truceUntil > g.pausedAt) g.truceUntil += pausedFor;
      if (g.event?.endsAt) g.event.endsAt += pausedFor;
      if (g.auction) g.auction.endsAt += pausedFor;
      for (const m of g.missions) if (m.status === 'active' && m.expiresAt) m.expiresAt += pausedFor;
      // Si algo cambió de fase durante la pausa, su temporizador nuevo manda —
      // el remanente viejo pertenece a la fase que se congeló (null = pausa sin timer)
      if (g.pausedRemainingMs !== null) g.phaseEndsAt ??= now + g.pausedRemainingMs;
      g.pausedRemainingMs = null;
      g.pausedAt = null;
      // Si durante la pausa alguien se fue y la unanimidad quedó completa
      // (un ausente no bloquea), la espera se cierra al descongelar el tiempo
      if (g.phase === 'ROLE_REVEAL') maybeStartFirstRound(g, out);
      else maybeAdvanceAllReady(g, out);
      return;
    }
    case 'event':
      if (g.phase === 'LOBBY' || g.phase === 'FINALE' || g.phase === 'ROLE_REVEAL') throw new GameError('Ahora no se pueden lanzar eventos');
      return applyEvent(g, a.eventId, out);
    case 'autopilot': {
      g.settings.autopilot = a.on;
      // Al apagarlo se suelta el volante: la cuenta atrás narrativa desaparece
      if (!a.on && autoAdvanceDelay(g) !== null) g.phaseEndsAt = null;
      announce(g, a.on ? '🤖 La casa ahora marca el ritmo sola.' : 'La casa vuelve a esperar al director.', 'info');
      return;
    }
    case 'adjustCoins': {
      const p = getPlayer(g, a.playerId);
      const delta = Math.trunc(a.delta);
      p.coins = Math.max(0, p.coins + delta);
      toast(out, p.id, { text: delta >= 0 ? `El director te da ${delta} 🪙` : `Multa del director: ${-delta} 🪙`, tone: delta >= 0 ? 'coins' : 'danger', sound: delta >= 0 ? 'coins' : 'danger' });
      return;
    }
    case 'kick': {
      const p = getPlayer(g, a.playerId);
      if (p.id === g.hostPlayerId) throw new GameError('No puedes expulsar al anfitrión');
      p.kicked = true;
      leavePlayer(g, p, out);
      out.kicked.push(p.id);
      return;
    }
    case 'openSeal':
      if (g.settings.hostPlays || !isDirectorDevice) throw new GameError('El sobre lacrado solo lo puede abrir un director que no juega');
      g.sealOpened++;
      return;
  }
}

// ================================================================ jugador

export type PlayerAction =
  | { type: 'ready' | 'leave' | 'claimHost' }
  | ({ type: 'challenge' } & ChallengeInput)
  | { type: 'ritual'; choice: 'encender' | 'apagar' }
  | { type: 'vote'; targets: string[] }
  | { type: 'buy'; item: ShopItemId; targetId?: string; amount?: number; text?: string }
  | { type: 'ability'; targets: string[] }
  | { type: 'claimMission' | 'discardMission'; missionId: string }
  | { type: 'pillar'; targetId: string }
  | { type: 'bet'; targetId: string; amount: number }
  | { type: 'note'; text: string }
  | { type: 'predict'; targetId: string }
  | { type: 'react'; emoji: string }
  | { type: 'certify'; clueId: string }
  | { type: 'letter'; text: string }
  | { type: 'coinflip'; amount: number }
  | { type: 'bid'; amount: number };

/** ¿Todo el mundo presente ha visto su rol? Lista vacía no: la casa no arranca sola. */
const allSawRoles = (g: Game): boolean => {
  const active = activePlayers(g);
  return active.length > 0 && active.every((x) => x.ready || !x.connected);
};

/** Arranca la ronda 1 si todos vieron su rol — nunca en pausa: setPhase
 *  borra el tiempo muerto y la casa se reanudaría sin que nadie lo pidiera. */
const maybeStartFirstRound = (g: Game, out: Outbox): void => {
  if (g.pausedAt === null && allSawRoles(g)) startRound(g, 0, out);
};

export function playerAction(g: Game, p: PlayerState, a: PlayerAction, out: Outbox, hostOnline: boolean): void {
  if (p.left) throw new GameError('Has salido de la partida');
  switch (a.type) {
    case 'ready': {
      if (g.phase === 'ROLE_REVEAL') {
        p.ready = true;
        maybeStartFirstRound(g, out);
        return;
      }
      // «Estamos listos»: cada uno marca la espera actual; al completarse, salta sola
      if (g.pausedAt !== null) throw new GameError('Está en pausa');
      const key = readyKey(g);
      if (!key) throw new GameError('Ahora no hay nada que confirmar');
      p.readyFor = key;
      maybeAdvanceAllReady(g, out);
      return;
    }
    case 'leave':
      return leavePlayer(g, p, out);
    case 'claimHost':
      if (hostOnline) throw new GameError('El director sigue conectado');
      if (Date.now() - g.hostLastSeen < HOST_CLAIM_AFTER_MS) throw new GameError('Espera un minuto: puede que el director esté reconectando');
      g.hostPlayerId = p.id;
      announce(g, `${p.name} ha tomado el mando de la partida.`, 'special');
      return;
    case 'challenge': {
      assertPhase(g, 'CHALLENGE');
      if (submitChallenge(g, p, a, out)) finalizeChallenge(g, out);
      return;
    }
    case 'ritual': {
      assertPhase(g, 'RITUAL');
      const r = g.ritual!;
      if (r.status !== 'open' || !r.participants.includes(p.id)) throw new GameError('No participas en este Ritual');
      if (r.choices[p.id]) throw new GameError('Ya has decidido');
      r.choices[p.id] = a.choice;
      if (r.participants.every((id) => r.choices[id] || getPlayer(g, id).left)) revealRitual(g, out);
      return;
    }
    case 'vote':
      return castVote(g, p, a.targets);
    case 'buy':
      return buy(g, p, a, out);
    case 'ability':
      return useAbility(g, p, a.targets, out);
    case 'claimMission':
      if (g.phase === 'LOBBY' || g.phase === 'FINALE' || g.phase === 'FINAL_ACCUSATION') throw new GameError('Ahora no');
      return claimMission(g, p, a.missionId, out);
    case 'discardMission':
      return discardMission(g, p, a.missionId);
    case 'pillar':
      if (g.roundIndex < 0 || g.phase === 'FINALE' || g.phase === 'FINAL_ACCUSATION') throw new GameError('Ahora no');
      if (gameNow(g) < g.truceUntil) throw new GameError('La casa está de sobremesa: ni un ¡PILLADO! hasta que acabe');
      return pillar(g, p, getPlayer(g, a.targetId), out);
    case 'bet':
      return placeBet(g, p, a.targetId, a.amount, out);
    case 'note': {
      p.notes = a.text.slice(0, 500);
      return;
    }
    case 'predict': {
      // Primera impresión: solo durante la ronda 1, antes de que hable la investigación
      if (g.roundIndex !== 0 || (g.phase !== 'ROUND_INTRO' && g.phase !== 'CHALLENGE')) {
        throw new GameError('Las primeras impresiones solo valen al empezar la noche');
      }
      if (g.predictions[p.id]) throw new GameError('Ya dejaste tu primera impresión');
      const target = getPlayer(g, a.targetId);
      if (target.id === p.id || target.left) throw new GameError('Apunta a otra persona');
      g.predictions[p.id] = target.id;
      toast(out, p.id, { text: `🔮 Primera impresión guardada: sospechas de ${target.name}. Si aciertas, +60 🪙 al final.`, tone: 'special', private: true });
      return;
    }
    case 'react': {
      // Emojis que flotan en la TV. Nunca durante el Ritual o la revelación: esos momentos son sagrados
      if (!['CHALLENGE', 'INVESTIGATION', 'VOTING', 'ROUND_RESULT', 'FINAL_ACCUSATION'].includes(g.phase)) throw new GameError('Ahora no');
      if (!(REACTION_EMOJIS as readonly string[]).includes(a.emoji)) throw new GameError('Ese emoji no está en la bandeja');
      if (Date.now() - p.lastReactAt < REACT_COOLDOWN_MS) throw new GameError('Respira. Un emoji cada vez.');
      p.lastReactAt = Date.now();
      out.reactions.push({ playerId: p.id, emoji: a.emoji });
      return;
    }
    case 'certify': {
      assertPhase(g, 'INVESTIGATION');
      const ability = roleOf(p)?.ability;
      if (ability?.id !== 'notario') throw new GameError('No llevas el sello de la casa');
      if (p.ability.total >= (ability.perGame ?? 1)) throw new GameError('El sello solo sirve una vez por noche');
      const clue = g.clues.find((c) => c.id === a.clueId && c.recipientId === p.id && c.source === 'nota');
      if (!clue) throw new GameError('Esa nota no está entre tus pistas');
      if (clue.certified) throw new GameError('Esa nota ya pasó por el sello');
      clue.certified = true;
      p.ability.total++;
      p.stats.abilityUses++;
      const excerpt = clue.text.length > 90 ? `${clue.text.slice(0, 90)}…` : clue.text;
      deliverClue(g, out, p, 'revelado', {
        text: clue.forgedBy
          ? `📜 Sello del Notario sobre «${excerpt}»: FALSIFICACIÓN. La escribió un mentiroso con buena letra.`
          : `📜 Sello del Notario sobre «${excerpt}»: AUTÉNTICA. La escribió alguien de esta casa. Ojo: auténtica no significa sincera.`,
        truth: 'true',
      });
      return;
    }
    case 'letter': {
      // La carta del condenado: el sospechoso deja una nota anónima que la casa
      // leerá en voz alta al abrir la siguiente ronda. Solo mientras dure su juicio.
      if (!g.suspects.includes(p.id) || g.suspectRound !== g.roundIndex) throw new GameError('No tienes ninguna carta pendiente');
      const text = a.text.trim();
      if (!text) throw new GameError('La carta está en blanco');
      if (g.letters.some((l) => l.playerId === p.id)) throw new GameError('Ya dejaste tu carta');
      g.letters.push({ playerId: p.id, text: text.slice(0, LETTER_MAX_LEN) });
      toast(out, p.id, { text: '📜 Carta sellada. La casa la leerá en voz alta en la próxima ronda — anónima.', tone: 'special', private: true });
      return;
    }
    case 'coinflip': {
      // Doble o nada: una jugada por ronda, la moneda cae delante de toda la casa
      assertPhase(g, 'INVESTIGATION');
      if (gameNow(g) < g.truceUntil) throw new GameError('La casa está de sobremesa: el casino está cerrado');
      if (p.coinflipRound === g.roundIndex) throw new GameError('Ya te la has jugado esta ronda');
      const amount = Math.trunc(a.amount);
      if (amount < 10) throw new GameError('La apuesta mínima son 10 🪙');
      if (amount > p.coins) throw new GameError('No tienes tantas monedas');
      p.coinflipRound = g.roundIndex;
      if (chance(0.5)) {
        p.coins += amount;
        announce(g, `🎲 ${p.name} se la jugó a doble o nada con ${amount} 🪙… ¡CARA! Se lleva el doble.`, 'special');
        toast(out, 'all', { text: `🎲 ${p.name} gana a doble o nada · +${amount} 🪙`, tone: 'coins', sound: 'coins' });
      } else {
        p.coins -= amount;
        announce(g, `🎲 ${p.name} se la jugó a doble o nada con ${amount} 🪙… ¡CRUZ! La casa se lo queda todo.`, 'danger');
        toast(out, 'all', { text: `🎲 ${p.name} pierde a doble o nada · -${amount} 🪙`, tone: 'danger', sound: 'danger' });
      }
      return;
    }
    case 'bid': {
      // Puja sellada: solo se ve cuánta gente ha pujado, nunca cuánto ni quién
      const auction = g.auction;
      if (!auction || gameNow(g) >= auction.endsAt) throw new GameError('La subasta ya se cerró');
      const amount = Math.trunc(a.amount);
      if (amount < AUCTION_MIN_BID) throw new GameError(`La puja mínima son ${AUCTION_MIN_BID} 🪙`);
      if (amount > p.coins) throw new GameError('No tienes tantas monedas');
      const had = !!auction.bids[p.id];
      auction.bids[p.id] = { amount, at: Date.now() };
      toast(out, p.id, { text: had ? `Puja actualizada: ${amount} 🪙 (en secreto)` : `Puja sellada: ${amount} 🪙 (en secreto)`, tone: 'special', private: true });
      return;
    }
  }
}

function castVote(g: Game, p: PlayerState, targets: string[]): void {
  assertPhase(g, 'VOTING', 'FINAL_ACCUSATION');
  const v = g.vote!;
  if (v.status !== 'open' || !v.voters.includes(p.id)) throw new GameError('No puedes votar ahora');
  if (v.ballots[p.id]) throw new GameError('Ya has votado');
  const unique = [...new Set(targets)];
  if (unique.length < 1 || unique.length > v.picks) throw new GameError(v.picks === 1 ? 'Elige a una persona' : `Elige hasta ${v.picks} personas`);
  if (unique.some((id) => id === p.id || !activePlayers(g).some((x) => x.id === id))) throw new GameError('Voto no válido');
  v.ballots[p.id] = unique;
  if (v.kind === 'juicio') {
    p.stats.votesCast = (p.stats.votesCast ?? 0) + 1; // ?? por snapshots anteriores a la stat
    if (p.inventory.voto_doble > 0) {
      p.inventory.voto_doble--;
      v.weights[p.id] = (v.weights[p.id] ?? 1) + 1;
    }
    // El juicio también espera al Ermitaño: cerrar sin él delataría ante toda la
    // casa quién es (un huésped confirmado) y nadie podría fingir su silencio
    if (v.voters.every((id) => v.ballots[id] || getPlayer(g, id).left)) revealJudgment(g);
  }
}

/** Casino de la Gran Acusación: monedas sobre quién es Cuco. Público — el cachondeo es la gracia. */
function placeBet(g: Game, p: PlayerState, targetId: string, amount: number, out: Outbox): void {
  assertPhase(g, 'FINAL_ACCUSATION');
  const v = g.vote!;
  if (v.status !== 'open' || !v.voters.includes(p.id)) throw new GameError('No puedes apostar ahora');
  if (v.bets[p.id]) throw new GameError('Ya has apostado esta noche');
  const target = getPlayer(g, targetId);
  if (target.id === p.id || target.left) throw new GameError('Apuesta por otra persona');
  const stake = Math.trunc(amount);
  if (stake < 1) throw new GameError('¿Cuántas monedas?');
  if (stake > p.coins) throw new GameError('No tienes tantas monedas');
  p.coins -= stake;
  v.bets[p.id] = { targetId: target.id, amount: stake };
  announce(g, `💰 ${p.name} apuesta ${stake} 🪙 a que ${target.name} es un Cuco.`, 'special');
  toast(out, 'all', { text: `💰 ${p.name}: ${stake} 🪙 a ${target.name}`, tone: 'coins' });
}

export function priceOf(g: Game, item: ShopItemId, buyer?: PlayerState | null): number {
  let price = g.flags.shopSale ? Math.floor(SHOP_PRICES[item] / 2) : SHOP_PRICES[item];
  if (g.market.includes(item)) price = Math.floor(price * MARKET_DISCOUNT);
  // El Contable regatea: la Despensa le sale un 25% más barata
  if (buyer?.roleId === 'contable') price = Math.max(1, Math.floor(price * 0.75));
  return price;
}

function steal(g: Game, thief: PlayerState, victim: PlayerState, amount: number, out: Outbox): void {
  if (victim.id === thief.id) throw new GameError('No puedes robarte a ti mismo');
  if (victim.inventory.candado > 0) {
    victim.inventory.candado--;
    toast(out, victim.id, { text: '🔒 Tu candado ha frenado un robo', tone: 'safe', private: true, sound: 'danger' });
    toast(out, thief.id, { text: `${victim.name} tenía un candado. No has robado nada.`, tone: 'danger', private: true, sound: 'danger' });
    return;
  }
  const taken = Math.min(amount, victim.coins);
  victim.coins -= taken;
  thief.coins += taken;
  thief.stats.steals++;
  victim.stats.stolenFrom++;
  toast(out, thief.id, { text: `Has robado ${taken} 🪙 a ${victim.name}`, tone: 'coins', private: true, sound: 'coins' });
  toast(out, victim.id, { text: `Alguien te ha robado ${taken} 🪙`, tone: 'danger', private: true, sound: 'danger' });
  rumor(g, out, `Rumor: a ${victim.name} le han vaciado el bolsillo.`);
}

function rumor(g: Game, out: Outbox, text: string): void {
  for (const c of activePlayers(g).filter((p) => p.roleId === 'chismoso')) {
    deliverClue(g, out, c, 'chisme', { text, truth: 'true' });
  }
}

function buy(g: Game, p: PlayerState, a: Extract<PlayerAction, { type: 'buy' }>, out: Outbox): void {
  assertPhase(g, 'INVESTIGATION');
  if (g.flags.noShop) throw new GameError('La despensa está cerrada esta ronda');
  const target = a.targetId ? getPlayer(g, a.targetId) : null;
  if (target?.left) throw new GameError('Ese jugador ya no está');
  const price = priceOf(g, a.item, p);

  switch (a.item) {
    case 'pista':
      spend(p, price);
      deliverClue(g, out, p, 'despensa', randomClue(g, p, shopClueTruth(g)));
      break;
    case 'candado':
      if (p.inventory.candado >= 2) throw new GameError('Ya tienes dos candados');
      spend(p, price);
      p.inventory.candado++;
      break;
    case 'voto_doble':
      if (p.inventory.voto_doble >= 1) throw new GameError('Ya tienes un voto doble');
      if (!futureJudgment(g)) throw new GameError('Ya no queda ningún juicio esta noche');
      spend(p, price);
      p.inventory.voto_doble++;
      break;
    case 'ganzua':
      if (!target) throw new GameError('¿A quién?');
      if (target.id === p.id) throw new GameError('No puedes robarte a ti mismo');
      spend(p, price);
      steal(g, p, target, GANZUA_STEAL, out);
      break;
    case 'mirilla':
      if (!target) throw new GameError('¿De quién?');
      if (!g.lastJudgment) throw new GameError('Todavía no ha habido ningún juicio');
      spend(p, price);
      deliverClue(g, out, p, 'mirilla', voteReveal(g, target));
      break;
    case 'sobre': {
      if (!target || target.id === p.id) throw new GameError('¿Para quién es el sobre?');
      const amount = Math.trunc(a.amount ?? 0);
      if (amount < 1) throw new GameError('¿Cuántas monedas?');
      if (amount > p.coins) throw new GameError('No tienes tantas monedas');
      p.coins -= amount;
      target.coins += amount;
      p.stats.coinsGifted += amount;
      toast(out, target.id, { text: `✉️ ${p.name} te ha dejado un sobre con ${amount} 🪙`, tone: 'coins', private: true, sound: 'coins' });
      toast(out, p.id, { text: `Sobre entregado a ${target.name}`, tone: 'info', private: true });
      return;
    }
    case 'coartada':
      if (p.inventory.coartada >= 1) throw new GameError('Ya tienes una coartada preparada');
      spend(p, price);
      p.inventory.coartada++;
      toast(out, p.id, { text: '🛡️ Coartada preparada. El próximo ¡PILLADO! contra ti fallará.', tone: 'special', private: true });
      break;
    case 'altavoz': {
      const msg = (a.text ?? '').trim().slice(0, 120);
      if (!msg) throw new GameError('Escribe algo para el altavoz');
      spend(p, price);
      announce(g, `📢 Altavoz de la casa: «${msg}»`, 'special');
      toast(out, 'all', { text: `📢 «${msg}»`, tone: 'special', sound: 'reveal' });
      break;
    }
    case 'espejo': {
      if (!target || target.id === p.id) throw new GameError('¿A quién miras por el espejo?');
      spend(p, price);
      const seen = seenAsCuco(target);
      deliverClue(g, out, p, 'espejo', {
        text: seen ? `El espejo no miente: ${target.name} es un Cuco.` : `El espejo no muestra plumas en ${target.name}. No parece un Cuco.`,
        truth: seen === isCuco(target) ? 'true' : 'false',
      });
      break;
    }
    case 'nota': {
      if (!target || target.id === p.id) throw new GameError('¿Bajo la puerta de quién?');
      const msg = (a.text ?? '').trim().slice(0, 140);
      if (!msg) throw new GameError('La nota está en blanco');
      spend(p, price);
      // Mismo formato que las del Falsificador: el destinatario no puede fiarse del todo
      deliverClue(g, out, target, 'nota', { text: `Encuentras una nota bajo tu puerta: «${msg}»`, truth: 'ambiguous' });
      toast(out, p.id, { text: `📜 Nota entregada bajo la puerta de ${target.name}`, tone: 'special', private: true });
      rumor(g, out, 'Dicen que esta noche alguien ha dejado una nota bajo una puerta.');
      break;
    }
  }
  p.stats.itemsBought++;
  // La Casera anota cada compra en su libro: quién fue y qué se llevó
  for (const c of activePlayers(g).filter((o) => o.roleId === 'casera' && o.id !== p.id)) {
    const itemName = SHOP_ITEMS.find((i) => i.id === a.item)?.name ?? a.item;
    deliverClue(g, out, c, 'chisme', { text: `Libro de cuentas: ${p.name} pagó ${price} 🪙 por «${itemName}».`, truth: 'true' });
  }
}

function useAbility(g: Game, p: PlayerState, targetIds: string[], out: Outbox): void {
  assertPhase(g, 'INVESTIGATION');
  const ability = roleOf(p)?.ability;
  if (!ability) throw new GameError('Tu rol no tiene habilidad activa');
  const reason = abilityBlocker(g, p);
  if (reason) throw new GameError(reason);
  const targets = targetIds.map((id) => getPlayer(g, id));
  if (targets.length !== ability.targets || targets.some((t) => t.left)) throw new GameError('Elige bien a los objetivos');
  if (new Set(targetIds).size !== targetIds.length) throw new GameError('Elige personas distintas');

  switch (ability.id) {
    case 'investigar':
      if (targets.some((t) => t.id === p.id)) throw new GameError('No puedes investigarte a ti mismo');
      deliverClue(g, out, p, 'investigar', investigate(g, targets[0], targets[1]));
      break;
    case 'receta':
      deliverClue(g, out, p, 'receta', recipe(g, p));
      break;
    case 'reparar':
      if (g.grietas === 0) throw new GameError('No hay grietas que reparar');
      g.grietas--;
      g.velas++;
      announce(g, '🔧 Alguien ha reparado una grieta. Se enciende una vela.', 'safe');
      toast(out, 'all', { text: '🔧 Una grieta reparada', tone: 'safe', sound: 'victory' });
      break;
    case 'revelado':
      if (!g.lastJudgment) throw new GameError('Todavía no ha habido ningún juicio');
      deliverClue(g, out, p, 'revelado', voteReveal(g, targets[0]));
      break;
    case 'falsificar': {
      const [recipient, subject] = targets;
      if (recipient.id === p.id) throw new GameError('La nota tiene que ser para otra persona');
      if (recipient.id === subject.id) throw new GameError('La nota no puede señalar a quien la recibe');
      deliverClue(g, out, recipient, 'nota', forgedNote(g, recipient, subject), p.id);
      p.stats.forges++;
      toast(out, p.id, { text: `Nota falsa entregada a ${recipient.name}`, tone: 'special', private: true });
      rumor(g, out, `Rumor: la nota que ha recibido ${recipient.name} no es de fiar.`);
      break;
    }
    case 'mano_larga':
      steal(g, p, targets[0], MANO_LARGA_STEAL, out);
      break;
    case 'notario':
      throw new GameError('El sello se estampa sobre una nota concreta: búscala en tus Pistas');
    case 'apadrinar': {
      const godchild = targets[0];
      if (godchild.id === p.id) throw new GameError('No puedes apadrinarte a ti mismo');
      p.ahijadoId = godchild.id;
      toast(out, p.id, { text: `👑 Has apadrinado a ${godchild.name}. Si es Cuco y sale impune, ganas con él.`, tone: 'special', private: true });
      break;
    }
  }
  if (p.ability.roundIndex !== g.roundIndex) p.ability = { ...p.ability, roundIndex: g.roundIndex, inRound: 0 };
  p.ability.inRound++;
  p.ability.total++;
  p.stats.abilityUses++;
}

export function abilityBlocker(g: Game, p: PlayerState): string | null {
  const ability = roleOf(p)?.ability;
  if (!ability) return 'Sin habilidad activa';
  if (ability.perGame && p.ability.total >= ability.perGame) return 'Ya la has gastado';
  if (ability.perRound && p.ability.roundIndex === g.roundIndex && p.ability.inRound >= ability.perRound) return 'Ya la has usado esta ronda';
  if (g.phase !== 'INVESTIGATION') return 'Solo durante la investigación';
  if (ability.id === 'reparar' && g.grietas === 0) return 'No hay grietas que reparar';
  if (ability.id === 'revelado' && !g.lastJudgment) return 'Aún no ha habido juicio';
  // El Padrino apadrina al empezar la noche, no cuando ya sabe quién es el Cuco
  if (ability.id === 'apadrinar' && g.roundIndex > 1) return 'Solo puedes apadrinar en las primeras rondas';
  return null;
}

export function abilityUsesLeft(p: PlayerState): number | null {
  const ability = roleOf(p)?.ability;
  if (!ability?.perGame) return null;
  return Math.max(0, ability.perGame - p.ability.total);
}

export function leavePlayer(g: Game, p: PlayerState, out: Outbox): void {
  if (p.left) return;
  p.left = true;
  p.connected = false;
  if (g.phase === 'LOBBY') {
    g.players = g.players.filter((x) => x.id !== p.id);
    if (g.hostPlayerId === p.id) g.hostPlayerId = null;
    return;
  }
  announce(g, `${p.name} se ha ido a dormir.`, 'info');
  // Cerramos lo que estuviera esperando por este jugador
  if (g.phase === 'ROLE_REVEAL' && allSawRoles(g) && g.pausedAt === null) return startRound(g, 0, out);
  if (g.phase === 'CHALLENGE' && g.challenge) {
    const c = g.challenge;
    const waiting = c.status === 'running' || c.status === 'voting';
    if (c.kind === 'truth_lie' && c.truthLie!.speakerId === p.id && c.status !== 'done') return finalizeChallenge(g, out);
    if (waiting && c.kind !== 'physical' && c.kind !== 'code_hunt' && pendingResponders(g, c).length === 0) finalizeChallenge(g, out);
  }
  if (g.phase === 'RITUAL' && g.ritual?.status === 'open' && g.ritual.participants.every((id) => g.ritual!.choices[id] || getPlayer(g, id).left)) revealRitual(g, out);
  if (g.phase === 'VOTING' && g.vote?.status === 'open' && g.vote.voters.every((id) => g.vote!.ballots[id] || getPlayer(g, id).left)) revealJudgment(g);
  maybeAdvanceAllReady(g, out);
}

/** Un socket caído no marca al jugador como ausente (puede volver), pero sí
 *  desbloquea las esperas que ya no necesitan su input: sin esto, un móvil que
 *  se apaga justo tras el último "listo" dejaba la casa esperándole en vano. */
export function onPlayerOffline(g: Game, out: Outbox): void {
  if (g.phase === 'ROLE_REVEAL') maybeStartFirstRound(g, out);
  // Un móvil caído no puede confirmar, así que tampoco puede bloquear el «estamos listos»
  maybeAdvanceAllReady(g, out);
}

/** Un jugador que se fue puede volver con su token mientras la partida siga. */
export function rejoinPlayer(g: Game, p: PlayerState): void {
  if (p.kicked) throw new GameError('Has sido expulsado de esta partida');
  if (p.left && g.phase !== 'FINALE' && g.phase !== 'LOBBY') {
    p.left = false;
    announce(g, `${p.name} ha vuelto a la casa.`, 'info');
  }
}
