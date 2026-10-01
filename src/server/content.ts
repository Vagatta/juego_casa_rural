// Contenido modular: se lee de content/*.json y se valida al arrancar.
// Añadir misiones, pruebas o eventos no requiere tocar el motor. Un futuro panel de
// administración solo tendría que escribir en estas mismas estructuras (o en las tablas de db/schema.sql).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { ContentMod, GameSettings, RoleDef } from '../shared/types.ts';

const contentDir = resolve(import.meta.dirname, '../../content');
const read = (file: string): unknown => JSON.parse(readFileSync(resolve(contentDir, file), 'utf8'));

const roleSchema = z.object({
  id: z.string(),
  name: z.string(),
  emoji: z.string(),
  faction: z.enum(['huesped', 'cuco', 'turista']),
  summary: z.string(),
  objective: z.string(),
  ability: z
    .object({
      id: z.enum(['investigar', 'receta', 'reparar', 'revelado', 'falsificar', 'mano_larga', 'notario', 'apadrinar']),
      name: z.string(),
      text: z.string(),
      targets: z.union([z.literal(0), z.literal(1), z.literal(2)]),
      targetLabels: z.array(z.string()).optional(),
      perRound: z.number().int().positive().optional(),
      perGame: z.number().int().positive().optional(),
    })
    .optional(),
  passive: z.object({ name: z.string(), text: z.string() }).optional(),
});

const missionSchema = z.object({
  id: z.string(),
  text: z.string(),
  difficulty: z.enum(['facil', 'media', 'dificil', 'epica']),
  category: z.string(),
  faction: z.enum(['any', 'huesped', 'cuco', 'turista']),
  targets: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  tags: z.array(z.string()),
  reward: z.number().int().positive().optional(),
});

const challengeSchema = z.object({
  id: z.string(),
  kind: z.enum(['physical', 'quiz', 'code_hunt', 'word_impostor', 'truth_lie', 'social_vote', 'interrogatorio']),
  category: z.enum(['mental', 'social', 'fisica', 'movil', 'mentira']),
  title: z.string(),
  instructions: z.string(),
  participants: z.enum(['all', 'team', 'duel', 'one']),
  scoring: z.enum(['passfail', 'winner']),
  durationSec: z.number().int().positive(),
  reward: z.number().int().nonnegative(),
  params: z.object({
    quizTag: z.string().optional(),
    count: z.number().int().positive().optional(),
    hideSec: z.number().int().positive().optional(),
  }),
});

const eventEffectSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('rule'), durationSec: z.number().int().positive() }),
  z.object({ type: z.literal('coins_multiplier'), factor: z.number().positive() }),
  z.object({ type: z.literal('coin_gift'), amount: z.number().int() }),
  z.object({ type: z.literal('tax'), percent: z.number().positive().max(100) }),
  z.object({ type: z.literal('robin_hood'), amount: z.number().int().positive(), fromHouse: z.boolean().optional() }),
  z.object({ type: z.literal('shop_sale') }),
  z.object({ type: z.literal('no_shop') }),
  z.object({ type: z.literal('mission_wave') }),
  z.object({ type: z.literal('lightning'), durationSec: z.number().int().positive() }),
  z.object({ type: z.literal('auction'), durationSec: z.number().int().positive() }),
  z.object({ type: z.literal('secret_intel'), count: z.number().int().positive().optional() }),
  z.object({ type: z.literal('snitch') }),
  z.object({ type: z.literal('inheritance'), percent: z.number().positive().max(100) }),
  z.object({ type: z.literal('laden_vote') }),
  z.object({ type: z.literal('truce'), durationSec: z.number().int().positive() }),
  z.object({ type: z.literal('cuco_mission') }),
  z.object({ type: z.literal('extra_cerilla') }),
  z.object({ type: z.literal('public_vote') }),
]);

const suspectSchema = z.object({
  id: z.string(),
  text: z.string(),
  /** Misiones de corro: 3 cómplices en lugar de 2 (solo en couple.json) */
  trio: z.boolean().optional(),
});

const eventSchema = z.object({
  id: z.string(),
  emoji: z.string(),
  title: z.string(),
  text: z.string(),
  effect: eventEffectSchema,
  minRound: z.number().int().optional(),
  modes: z.array(z.enum(['clasico', 'caos', 'sofa'])).optional(),
  requiresJudgment: z.boolean().optional(),
});

const quizSchema = z.object({
  id: z.string(),
  tag: z.string(),
  q: z.string(),
  options: z.array(z.string()).length(4),
  answer: z.number().int().min(0).max(3),
});

const wordsSchema = z.object({
  palabras: z.array(z.string()).min(4),
  objetos: z.array(z.string()).min(4),
  expresiones: z.array(z.string()).min(2),
  impostor: z.array(z.tuple([z.string(), z.string()])).min(4),
});

export type MissionDef = z.infer<typeof missionSchema>;
export type SuspectTaskDef = z.infer<typeof suspectSchema>;
export type ChallengeDef = z.infer<typeof challengeSchema>;
export type EventDef = z.infer<typeof eventSchema>;
export type EventEffect = z.infer<typeof eventEffectSchema>;
export type QuizDef = z.infer<typeof quizSchema>;

function unique<T extends { id: string }>(items: T[], label: string): T[] {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) throw new Error(`Contenido duplicado en ${label}: ${item.id}`);
    seen.add(item.id);
  }
  return items;
}

export const content = {
  roles: unique(z.array(roleSchema).parse(read('roles.json')) as RoleDef[], 'roles'),
  missions: unique(z.array(missionSchema).parse(read('missions.json')), 'missions'),
  challenges: unique(z.array(challengeSchema).parse(read('challenges.json')), 'challenges'),
  events: unique(z.array(eventSchema).parse(read('events.json')), 'events'),
  quiz: unique(z.array(quizSchema).parse(read('quiz.json')), 'quiz'),
  social: z.array(z.string()).min(5).parse(read('social.json')),
  suspect: unique(z.array(suspectSchema).parse(read('suspect.json')), 'suspect'),
  couple: unique(z.array(suspectSchema).parse(read('couple.json')), 'couple'),
  interro: z.array(z.string()).min(8).parse(read('interro.json')),
  words: wordsSchema.parse(read('words.json')),
};

export const roleById = new Map(content.roles.map((r) => [r.id, r]));
export const challengeById = new Map(content.challenges.map((c) => [c.id, c]));
export const eventById = new Map(content.events.map((e) => [e.id, e]));
export const missionById = new Map(content.missions.map((m) => [m.id, m]));
export const quizById = new Map(content.quiz.map((q) => [q.id, q]));

export function getRole(id: string): RoleDef {
  const role = roleById.get(id);
  if (!role) throw new Error(`Rol desconocido: ${id}`);
  return role;
}

// ---------------------------------------------------------------- contenido por casa
// El anfitrión puede reescribir, quitar y añadir piezas al crear su casa (settings.contentMod).
// Los pools parcheados se resuelven una vez por partida y se cachean en un WeakMap:
// el estado serializable solo guarda el contentMod (JSON puro), nunca los pools.

export interface GameContent {
  missions: MissionDef[];
  challenges: ChallengeDef[];
  events: EventDef[];
  quiz: QuizDef[];
  social: string[];
  suspect: SuspectTaskDef[];
  couple: SuspectTaskDef[];
  interro: string[];
  challengeById: Map<string, ChallengeDef>;
  eventById: Map<string, EventDef>;
  quizById: Map<string, QuizDef>;
  missionById: Map<string, MissionDef>;
}

const DEFAULT_CONTENT: GameContent = {
  missions: content.missions,
  challenges: content.challenges,
  events: content.events,
  quiz: content.quiz,
  social: content.social,
  suspect: content.suspect,
  couple: content.couple,
  interro: content.interro,
  challengeById,
  eventById,
  quizById,
  missionById,
};

export function buildContent(mod?: ContentMod): GameContent {
  if (!mod || (!mod.disabled?.length && !mod.edits && !mod.extraInterro?.length && !mod.extraSocial?.length)) return DEFAULT_CONTENT;
  const off = new Set(mod.disabled ?? []);
  const edit = mod.edits ?? {};
  // Editar un texto nunca resucita una pieza desactivada: primero se filtra, luego se reescribe
  const patch = <T extends { id: string }>(items: T[], field: keyof T & string): T[] =>
    items.filter((i) => !off.has(i.id)).map((i) => (edit[i.id] ? { ...i, [field]: edit[i.id] } : i));
  const patchTitle = <T extends { id: string; title: string }>(items: T[]): T[] =>
    items.map((i) => (edit[`${i.id}:title`] ? { ...i, title: edit[`${i.id}:title`] } : i));
  // Las preguntas planas llevan id por índice (interro:3, social:5): el índice es el del JSON original
  const patchStrings = (items: string[], prefix: string, extra: string[] = []): string[] =>
    items
      .map((s, i) => (off.has(`${prefix}:${i}`) ? null : (edit[`${prefix}:${i}`] ?? s)))
      .filter((s): s is string => s !== null)
      .concat(extra);

  const missions = patch(content.missions, 'text');
  const challenges = patchTitle(patch(content.challenges, 'instructions'));
  const events = patchTitle(patch(content.events, 'text'));
  const quiz = patch(content.quiz, 'q');
  return {
    missions,
    challenges,
    events,
    quiz,
    social: patchStrings(content.social, 'social', mod.extraSocial),
    suspect: patch(content.suspect, 'text'),
    couple: patch(content.couple, 'text'),
    interro: patchStrings(content.interro, 'interro', mod.extraInterro),
    challengeById: new Map(challenges.map((c) => [c.id, c])),
    eventById: new Map(events.map((e) => [e.id, e])),
    quizById: new Map(quiz.map((q) => [q.id, q])),
    missionById: new Map(missions.map((m) => [m.id, m])),
  };
}

const contentCache = new WeakMap<object, GameContent>();

/** Pools de contenido tal y como los ve esta partida (con los retoques del anfitrión). */
export function gameContent(g: { settings: GameSettings }): GameContent {
  let c = contentCache.get(g);
  if (!c) {
    c = buildContent(g.settings.contentMod);
    contentCache.set(g, c);
  }
  return c;
}

/** Catálogo editable que ve el anfitrión en la pantalla de crear (GET /api/content). */
export function editableContent() {
  return {
    missions: content.missions.map((m) => ({ id: m.id, text: m.text })),
    challenges: content.challenges.map((c) => ({ id: c.id, title: c.title, instructions: c.instructions })),
    events: content.events.map((e) => ({ id: e.id, title: e.title, text: e.text })),
    quiz: content.quiz.map((q) => ({ id: q.id, text: q.q })),
    suspect: content.suspect.map((s) => ({ id: s.id, text: s.text })),
    couple: content.couple.map((s) => ({ id: s.id, text: s.text })),
    interro: content.interro.map((text, i) => ({ id: `interro:${i}`, text })),
    social: content.social.map((text, i) => ({ id: `social:${i}`, text })),
  };
}
