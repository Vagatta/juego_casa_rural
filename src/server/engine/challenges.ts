import { CODE_HUNT_ATTEMPTS, SABOTEUR_CHANCE } from '../../shared/constants.ts';
import { content, gameContent, type ChallengeDef } from '../content.ts';
import { affectsCandles, teamSize } from './plan.ts';
import { assignSaboteurMission, resolveSaboteur } from './missions.ts';
import { chance, pick, rand, shuffle } from './rng.ts';
import {
  type ChallengeState,
  type Game,
  GameError,
  type Outbox,
  type PlayerState,
  activePlayers,
  earn,
  gameNow,
  getPlayer,
  toast,
} from './state.ts';

const IMPOSTOR_VOTE_SEC = 60;

export const defOf = (g: Game, c: ChallengeState): ChallengeDef => {
  const def = gameContent(g).challengeById.get(c.defId);
  if (!def) throw new Error(`Prueba desconocida ${c.defId}`);
  return def;
};

/** Elige a los que menos han jugado (con desempate aleatorio): todo el mundo acaba saliendo. */
function leastPlayed(players: PlayerState[], n: number, key: 'challengesPlayed' | 'duels' | 'speakerTurns'): PlayerState[] {
  return shuffle(players)
    .sort((a, b) => a.stats[key] - b.stats[key])
    .slice(0, n);
}

export function setupChallenge(g: Game, challengeId: string, out: Outbox): ChallengeState {
  const def = gameContent(g).challengeById.get(challengeId);
  if (!def) throw new Error(`Prueba desconocida ${challengeId}`);
  const active = activePlayers(g);
  const c: ChallengeState = { defId: def.id, kind: def.kind, status: 'briefing', participants: [], passed: null, winners: [] };

  if (def.participants === 'team') c.participants = leastPlayed(active, teamSize(active.length), 'challengesPlayed').map((p) => p.id);
  else if (def.participants === 'duel') {
    const duelists = leastPlayed(active, 2, 'duels');
    duelists.forEach((p) => p.stats.duels++);
    c.participants = duelists.map((p) => p.id);
  } else c.participants = active.map((p) => p.id);

  switch (def.kind) {
    case 'quiz': {
      const tag = def.params.quizTag;
      const pool = gameContent(g).quiz.filter((q) => (!tag || q.tag === tag) && !g.used.quiz.includes(q.id));
      // Si el tag se ha agotado o el anfitrión lo vació, reutilizamos o caemos al quiz general
      const fallback = gameContent(g).quiz.filter((q) => !tag || q.tag === tag);
      const wide = pool.length >= (def.params.count ?? 3) ? pool : fallback.length ? fallback : gameContent(g).quiz;
      const chosen = shuffle(wide).slice(0, def.params.count ?? 3);
      g.used.quiz.push(...chosen.map((q) => q.id));
      c.quiz = { questionIds: chosen.map((q) => q.id), answers: {} };
      break;
    }
    case 'code_hunt': {
      const hider = pick(active);
      c.participants = c.participants.filter((id) => id !== hider.id);
      const code = String(rand(9000) + 1000);
      c.code = { hiderId: hider.id, code, attempts: {}, foundBy: null, huntStartsAt: null };
      toast(out, hider.id, { text: 'Te toca esconder el código. Mira tu pantalla sin que te vean.', tone: 'special', private: true, sound: 'mission' });
      break;
    }
    case 'word_impostor': {
      const free = content.words.impostor.map((_, i) => i).filter((i) => !g.used.words.includes(i));
      const index = free.length ? pick(free) : rand(content.words.impostor.length);
      g.used.words.push(index);
      const [a, b] = shuffle(content.words.impostor[index]);
      c.impostor = { word: a, fakeWord: b, infiltradoId: pick(c.participants), votes: {} };
      break;
    }
    case 'truth_lie': {
      const speaker = leastPlayed(active, 1, 'speakerTurns')[0];
      speaker.stats.speakerTurns++;
      c.truthLie = { speakerId: speaker.id, lieIndex: null, guesses: {} };
      toast(out, speaker.id, { text: 'Te toca: dos verdades y una mentira.', tone: 'special', private: true, sound: 'mission' });
      break;
    }
    case 'social_vote': {
      const free = gameContent(g).social.filter((q) => !g.used.social.includes(q));
      const question = pick(free.length ? free : gameContent(g).social);
      g.used.social.push(question);
      c.social = { question, votes: {} };
      break;
    }
    case 'interrogatorio': {
      c.interro = { questions: shuffle(gameContent(g).interro).slice(0, 3) };
      break;
    }
    case 'physical':
      break;
  }
  for (const id of c.participants) getPlayer(g, id).stats.challengesPlayed++;

  // El saboteador infiltrado: en pruebas de equipo (no en la primera ronda, que rompe el hielo)
  if (def.participants === 'team' && def.scoring === 'passfail' && g.roundIndex > 0 && c.participants.length >= 3 && chance(SABOTEUR_CHANCE)) {
    assignSaboteurMission(g, getPlayer(g, pick(c.participants)), def.title, out);
  }
  return c;
}

/** Jugadores de los que se espera una respuesta ahora mismo (activos). */
export function pendingResponders(g: Game, c: ChallengeState): string[] {
  const alive = (ids: string[]) => ids.filter((id) => !getPlayer(g, id).left);
  if (c.kind === 'quiz' && c.status === 'running') return alive(c.participants).filter((id) => !c.quiz!.answers[id]);
  if (c.kind === 'word_impostor' && c.status === 'voting') return alive(c.participants).filter((id) => !c.impostor!.votes[id]);
  if (c.kind === 'social_vote' && c.status === 'running') return alive(c.participants).filter((id) => !c.social!.votes[id]);
  if (c.kind === 'truth_lie') {
    const t = c.truthLie!;
    if (t.lieIndex === null) return alive([t.speakerId]);
    if (c.status === 'running') return alive(c.participants).filter((id) => id !== t.speakerId && t.guesses[id] === undefined);
  }
  return [];
}

export function hasActed(g: Game, c: ChallengeState, playerId: string): boolean {
  if (c.kind === 'quiz') return !!c.quiz!.answers[playerId];
  if (c.kind === 'word_impostor') return !!c.impostor!.votes[playerId];
  if (c.kind === 'social_vote') return !!c.social!.votes[playerId];
  if (c.kind === 'truth_lie') return playerId === c.truthLie!.speakerId ? c.truthLie!.lieIndex !== null : c.truthLie!.guesses[playerId] !== undefined;
  if (c.kind === 'code_hunt') return c.code!.foundBy === playerId;
  return false;
}

export interface ChallengeInput {
  answers?: number[];
  code?: string;
  vote?: string;
  lieIndex?: number;
  guess?: number;
}

/** Devuelve true si la entrada cierra la prueba (todos han respondido o se encontró el código). */
export function submitChallenge(g: Game, p: PlayerState, input: ChallengeInput, out: Outbox): boolean {
  const c = g.challenge;
  if (!c) throw new GameError('No hay prueba en marcha');
  const isParticipant = c.participants.includes(p.id);

  switch (c.kind) {
    case 'quiz': {
      if (c.status !== 'running' || !isParticipant) throw new GameError('Ahora no puedes responder');
      if (c.quiz!.answers[p.id]) throw new GameError('Ya has respondido');
      const count = c.quiz!.questionIds.length;
      const answers = input.answers;
      if (!answers || answers.length !== count || answers.some((a) => !Number.isInteger(a) || a < -1 || a > 3)) throw new GameError('Respuestas no válidas');
      c.quiz!.answers[p.id] = answers;
      return pendingResponders(g, c).length === 0;
    }
    case 'code_hunt': {
      const hunt = c.code!;
      if (c.status !== 'running' || !isParticipant) throw new GameError('Ahora no puedes introducir códigos');
      if (!hunt.huntStartsAt || gameNow(g) < hunt.huntStartsAt) throw new GameError('Todavía se está escondiendo el código');
      if (hunt.foundBy) throw new GameError('El código ya ha sido encontrado');
      const used = hunt.attempts[p.id] ?? 0;
      if (used >= CODE_HUNT_ATTEMPTS) throw new GameError('No te quedan intentos');
      hunt.attempts[p.id] = used + 1;
      if ((input.code ?? '').trim() === hunt.code) {
        hunt.foundBy = p.id;
        return true;
      }
      toast(out, p.id, { text: `Código incorrecto. Te quedan ${CODE_HUNT_ATTEMPTS - used - 1} intentos.`, tone: 'danger', private: true, sound: 'danger' });
      return false;
    }
    case 'word_impostor': {
      if (c.status !== 'voting' || !isParticipant) throw new GameError('Ahora no se vota');
      if (c.impostor!.votes[p.id]) throw new GameError('Ya has votado');
      if (!input.vote || input.vote === p.id || !c.participants.includes(input.vote)) throw new GameError('Voto no válido');
      c.impostor!.votes[p.id] = input.vote;
      return pendingResponders(g, c).length === 0;
    }
    case 'truth_lie': {
      const t = c.truthLie!;
      if (p.id === t.speakerId) {
        if (t.lieIndex !== null) throw new GameError('Ya has marcado tu mentira');
        if (input.lieIndex === undefined || ![0, 1, 2].includes(input.lieIndex)) throw new GameError('Elige 1, 2 o 3');
        t.lieIndex = input.lieIndex;
        return false;
      }
      if (c.status !== 'running' || t.lieIndex === null) throw new GameError('Espera a que termine de contarlo');
      if (t.guesses[p.id] !== undefined) throw new GameError('Ya has votado');
      if (input.guess === undefined || ![0, 1, 2].includes(input.guess)) throw new GameError('Elige 1, 2 o 3');
      t.guesses[p.id] = input.guess;
      return pendingResponders(g, c).length === 0;
    }
    case 'social_vote': {
      if (c.status !== 'running') throw new GameError('Ahora no se vota');
      if (c.social!.votes[p.id]) throw new GameError('Ya has votado');
      if (!input.vote || !activePlayers(g).some((x) => x.id === input.vote)) throw new GameError('Voto no válido');
      c.social!.votes[p.id] = input.vote;
      return pendingResponders(g, c).length === 0;
    }
    case 'physical':
    case 'interrogatorio':
      throw new GameError('Esta prueba se juega en la habitación, no en el móvil');
  }
}

export function startRunning(g: Game, now: number): void {
  const c = g.challenge!;
  const def = defOf(g, c);
  c.status = 'running';
  if (c.kind === 'code_hunt') {
    const hide = (def.params.hideSec ?? 60) * 1000;
    c.code!.huntStartsAt = now + hide;
    g.phaseEndsAt = now + hide + def.durationSec * 1000;
  } else g.phaseEndsAt = now + def.durationSec * 1000;
}

/** Se agota el tiempo o el director corta. Pasa al siguiente sub-estado. */
export function stopRunning(g: Game, out: Outbox): void {
  const c = g.challenge!;
  if (c.kind === 'physical' || c.kind === 'interrogatorio') {
    c.status = 'judging';
    g.phaseEndsAt = null;
  } else if (c.kind === 'word_impostor') {
    c.status = 'voting';
    g.phaseEndsAt = Date.now() + IMPOSTOR_VOTE_SEC * 1000;
  } else finalizeChallenge(g, out);
}

export function judgeChallenge(g: Game, input: { passed?: boolean; winners?: string[] }, out: Outbox): void {
  const c = g.challenge;
  if (!c || (c.kind !== 'physical' && c.kind !== 'interrogatorio') || (c.status !== 'judging' && c.status !== 'running')) throw new GameError('No hay nada que arbitrar');
  const def = defOf(g, c);
  if (def.scoring === 'winner') {
    const winners = (input.winners ?? []).filter((id) => c.participants.includes(id));
    if (!winners.length) throw new GameError('Elige al menos un ganador');
    c.winners = winners;
  } else {
    if (typeof input.passed !== 'boolean') throw new GameError('¿Superada o fallada?');
    c.passed = input.passed;
  }
  finalizeChallenge(g, out);
}

function tallyOf(votes: Record<string, string>): { id: string; votes: number }[] {
  const counts = new Map<string, number>();
  for (const target of Object.values(votes)) counts.set(target, (counts.get(target) ?? 0) + 1);
  return [...counts.entries()].map(([id, n]) => ({ id, votes: n })).sort((a, b) => b.votes - a.votes);
}

export const topOf = (tally: { id: string; votes: number }[]): string[] =>
  tally.length ? tally.filter((t) => t.votes === tally[0].votes).map((t) => t.id) : [];

function reward(g: Game, out: Outbox, ids: string[], amount: number, reason: string) {
  for (const id of ids) {
    const p = getPlayer(g, id);
    if (p.left) continue;
    const gained = earn(g, p, amount);
    toast(out, id, { text: `${reason} · +${gained} 🪙`, tone: 'coins', private: true, sound: 'coins' });
  }
}

/** Calcula resultado, reparte monedas y deja la prueba en 'done'. */
export function finalizeChallenge(g: Game, out: Outbox): void {
  const c = g.challenge!;
  const def = defOf(g, c);
  c.status = 'done';
  g.phaseEndsAt = null;
  g.pausedRemainingMs = null; // el timer guardado era del sub-estado que acaba de cerrar

  switch (c.kind) {
    case 'physical':
    case 'interrogatorio':
      if (def.scoring === 'winner') {
        c.winners.forEach((id) => getPlayer(g, id).stats.challengeWins++);
        reward(g, out, c.winners, def.reward, '¡Has ganado la prueba!');
      } else if (c.passed) reward(g, out, c.participants, def.reward, 'Prueba superada');
      break;
    case 'quiz': {
      const { questionIds, answers } = c.quiz!;
      const questions = questionIds.map((id) => gameContent(g).quizById.get(id)!);
      let correct = 0;
      for (const id of c.participants) {
        const mine = answers[id] ?? [];
        const hits = questions.filter((q, i) => mine[i] === q.answer).length;
        correct += hits;
        if (hits) {
          getPlayer(g, id).stats.quizCorrect += hits;
          reward(g, out, [id], hits * 20, `${hits} respuesta${hits > 1 ? 's' : ''} correcta${hits > 1 ? 's' : ''}`);
        }
      }
      const total = Math.max(1, c.participants.length * questions.length);
      c.passed = correct / total >= 0.6;
      if (c.passed) reward(g, out, c.participants, def.reward, 'Prueba superada');
      break;
    }
    case 'code_hunt': {
      const hunt = c.code!;
      c.passed = !!hunt.foundBy;
      if (hunt.foundBy) {
        getPlayer(g, hunt.foundBy).stats.challengeWins++;
        reward(g, out, [hunt.foundBy], def.reward, '¡Has encontrado el código!');
      } else reward(g, out, [hunt.hiderId], 60, 'Escondite perfecto: nadie lo encontró');
      break;
    }
    case 'word_impostor': {
      const imp = c.impostor!;
      const tally = tallyOf(imp.votes);
      const top = topOf(tally);
      c.passed = top.length === 1 && top[0] === imp.infiltradoId;
      const rightVoters = Object.entries(imp.votes).filter(([, t]) => t === imp.infiltradoId).map(([v]) => v);
      reward(g, out, rightVoters, 20, 'Has señalado al Infiltrado');
      if (!c.passed) reward(g, out, [imp.infiltradoId], 80, 'Eras el Infiltrado y no te han pillado');
      break;
    }
    case 'truth_lie': {
      const t = c.truthLie!;
      const guesses = Object.entries(t.guesses);
      const right = guesses.filter(([, gss]) => gss === t.lieIndex).map(([id]) => id);
      reward(g, out, right, 20, 'Has cazado la mentira');
      if (t.lieIndex !== null && guesses.length > 0 && right.length < guesses.length / 2) reward(g, out, [t.speakerId], 60, 'Has engañado a la casa');
      break;
    }
    case 'social_vote': {
      const s = c.social!;
      const top = topOf(tallyOf(s.votes));
      const aligned = Object.entries(s.votes).filter(([, t]) => top.includes(t)).map(([v]) => v);
      reward(g, out, aligned, def.reward, 'Piensas como la casa');
      reward(g, out, top, 20, 'Premio de consolación por ser el más votado');
      break;
    }
  }
  if (c.passed) c.participants.forEach((id) => getPlayer(g, id).stats.challengesPassed++);
  resolveSaboteur(g, c.passed, out);
}

export function challengeTallies(c: ChallengeState) {
  return {
    impostor: c.impostor ? tallyOf(c.impostor.votes) : [],
    social: c.social ? tallyOf(c.social.votes) : [],
  };
}

export { affectsCandles };
