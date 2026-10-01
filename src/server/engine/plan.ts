import type { ChallengeCategory, GameSettings } from '../../shared/types.ts';
import { buildContent, type ChallengeDef, type GameContent } from '../content.ts';
import { GameError, type RoundPlan } from './state.ts';
import { pick, shuffle } from './rng.ts';

const ROUNDS_BY_DURATION = { 30: 2, 60: 4, 90: 6, 120: 8 } as const;

const ROUND_TITLES = [
  'Ruidos en el desván', 'La despensa', 'Tormenta de verano', 'El granero', 'Medianoche',
  'La chimenea', 'El pozo', 'Luna llena', 'La bodega', 'El cuarto cerrado', 'Perros ladrando',
];

export function affectsCandles(def: ChallengeDef): boolean {
  if (def.scoring === 'winner') return false;
  return def.kind === 'physical' || def.kind === 'quiz' || def.kind === 'code_hunt' || def.kind === 'word_impostor' || def.kind === 'interrogatorio';
}

export const needsRitual = (def: ChallengeDef): boolean =>
  affectsCandles(def) && (def.kind === 'physical' || def.kind === 'quiz' || def.kind === 'code_hunt' || def.kind === 'interrogatorio');

export function judgmentRounds(total: number): number[] {
  // Índices 0-based: nunca en la ronda 1 (no hay información) y dejando la última para la Gran Acusación
  const out: number[] = [];
  for (let i = 2; i < total; i += 2) out.push(i);
  return out;
}

/**
 * Genera el plan de rondas. Restricciones de equilibrio:
 * - Ronda 1: siempre rompehielos sin velas (social / dos verdades).
 * - Resto: pruebas que afectan a las velas, rotando categorías, sin dos iguales seguidas.
 * - Máximo un escondite de código cada 4 rondas y dos infiltrados por partida.
 * - Partidas de 8 rondas: un duelo/torneo en mitad para cambiar el ritmo.
 * - Modo sofá: nada de categoría física.
 */
export function buildPlan(settings: GameSettings, playerCount: number, gc: GameContent = buildContent()): RoundPlan[] {
  const defs = gc.challenges;
  const total = ROUNDS_BY_DURATION[settings.durationMin];
  const judgments = new Set(judgmentRounds(total));
  // Una prueba no solo tiene que estar activa: sus datos también (sin quiz no hay quiz, sin preguntas no hay interrogatorio)
  const hasData = (d: ChallengeDef) =>
    d.kind === 'quiz' ? gc.quiz.some((q) => !d.params?.quizTag || q.tag === d.params.quizTag)
    : d.kind === 'social_vote' ? gc.social.length > 0
    : d.kind === 'interrogatorio' ? gc.interro.length >= 3
    : true;
  const allowed = (d: ChallengeDef) =>
    hasData(d) && !(settings.mode === 'sofa' && d.category === 'fisica') && (d.participants !== 'team' || playerCount >= 4);
  // Si el anfitrión recortó demasiado el catálogo no hay plan posible
  if (defs.filter(allowed).length < total) throw new GameError('Esta casa ha desactivado demasiadas pruebas para esa duración');
  const duels = defs.filter((d) => d.scoring === 'winner' && allowed(d));
  const candleNeed = total - 1 - (total >= 8 && duels.length ? 1 : 0);
  if (defs.filter((d) => allowed(d) && affectsCandles(d)).length < candleNeed) {
    throw new GameError('Esta casa ha desactivado demasiadas pruebas con vela para esa duración');
  }

  const used = new Set<string>();
  const kindCount = new Map<string, number>();
  const take = (def: ChallengeDef) => {
    used.add(def.id);
    kindCount.set(def.kind, (kindCount.get(def.kind) ?? 0) + 1);
    return def;
  };
  const kindCap = (kind: string) => (kind === 'code_hunt' ? Math.max(1, Math.floor(total / 4)) : kind === 'word_impostor' ? 2 : kind === 'interrogatorio' ? 1 : 99);
  const available = (d: ChallengeDef) => allowed(d) && !used.has(d.id) && (kindCount.get(d.kind) ?? 0) < kindCap(d.kind);

  const icebreakers = defs.filter((d) => (d.kind === 'social_vote' || d.kind === 'truth_lie') && available(d));
  const plan: ChallengeDef[] = [take(pick(icebreakers.length ? icebreakers : defs.filter(available)))];

  const baseCycle: ChallengeCategory[] =
    settings.mode === 'sofa' ? ['mental', 'movil', 'mentira', 'social'] : ['fisica', 'mental', 'movil', 'mentira', 'fisica', 'social'];
  let categories: ChallengeCategory[] = [];
  while (categories.length < total - 1) categories.push(...shuffle(baseCycle));
  categories = categories.slice(0, total - 1);
  for (let i = 1; i < categories.length; i++) {
    if (categories[i] === categories[i - 1]) {
      const swap = categories.findIndex((c, j) => j > i && c !== categories[i]);
      if (swap > 0) [categories[i], categories[swap]] = [categories[swap], categories[i]];
    }
  }

  const duelSlot = total >= 8 ? Math.floor(total / 2) : -1;
  categories.forEach((category, i) => {
    const roundIndex = i + 1;
    if (roundIndex === duelSlot) {
      const usable = duels.filter((d) => available(d));
      if (usable.length) return void plan.push(take(pick(usable)));
    }
    const candidates = defs.filter((d) => d.category === category && affectsCandles(d) && available(d));
    const fallback = defs.filter((d) => affectsCandles(d) && available(d));
    const pool = candidates.length ? candidates : fallback;
    if (!pool.length) throw new GameError('Esta casa ha desactivado demasiadas pruebas para esa duración');
    plan.push(take(pick(pool)));
  });

  const titles = shuffle(ROUND_TITLES);
  return plan.map((def, i) => ({
    challengeId: def.id,
    hasJudgment: judgments.has(i),
    title: i === 0 ? 'La llegada' : i === total - 1 ? 'La última vela' : titles[i],
  }));
}

export function teamSize(activeCount: number): number {
  return Math.min(6, Math.max(3, Math.round(activeCount * 0.5)));
}
