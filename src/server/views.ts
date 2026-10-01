// PROYECCIONES. Lo único que sale del servidor hacia un navegador.
// Regla: se construye un objeto NUEVO campo a campo. Nunca se hace spread del estado interno.
import { CODE_HUNT_ATTEMPTS, SHOP_PRICES } from '../shared/constants.ts';
import type {
  ChallengeView,
  ClueView,
  FinaleView,
  GameView,
  HostView,
  MeView,
  MissionView,
  PublicPlayer,
  RoleDef,
  ShopItemId,
} from '../shared/types.ts';
import { content, gameContent, getRole } from './content.ts';
import { challengeTallies, defOf, hasActed } from './engine/challenges.ts';
import { abilityBlocker, abilityUsesLeft, priceOf } from './engine/game.ts';
import { SABOTEUR_TAG, SUSPECT_TAG } from './engine/missions.ts';
import { eligibleEvents } from './engine/events.ts';
import { affectsCandles } from './engine/plan.ts';
import { type Game, type PlayerState, activePlayers, isCuco, roleOf } from './engine/state.ts';

export interface Viewer {
  audience: 'player' | 'director';
  playerId: string | null;
  isHost: boolean;
  hostOnline: boolean;
}

function actedInPhase(g: Game, p: PlayerState): boolean {
  switch (g.phase) {
    case 'ROLE_REVEAL':
      return p.ready;
    case 'CHALLENGE':
      return g.challenge ? hasActed(g, g.challenge, p.id) : false;
    case 'RITUAL':
      return !!g.ritual?.choices[p.id];
    case 'VOTING':
    case 'FINAL_ACCUSATION':
      return !!g.vote?.ballots[p.id];
    default:
      return false;
  }
}

function publicPlayers(g: Game): PublicPlayer[] {
  return g.players.map((p) => ({
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    color: p.color,
    coins: p.coins,
    connected: p.connected,
    left: p.left,
    isHost: p.id === g.hostPlayerId,
    ready: p.ready,
    suspect: g.suspects.includes(p.id),
    acted: actedInPhase(g, p),
  }));
}

function challengeView(g: Game, me: PlayerState | null): ChallengeView | null {
  const c = g.challenge;
  if (!c) return null;
  const def = defOf(g, c);
  const done = c.status === 'done';
  const view: ChallengeView = {
    id: def.id,
    kind: def.kind,
    category: def.category,
    title: def.title,
    instructions: def.instructions,
    status: c.status,
    scoring: def.scoring,
    participants: [...c.participants],
    isParticipant: !!me && c.participants.includes(me.id),
    reward: def.reward,
    durationSec: def.durationSec,
    endsAt: g.phaseEndsAt,
    passed: c.passed,
    winners: [...c.winners],
    affectsCandles: affectsCandles(def),
    mine: {},
    pub: {},
  };

  if (c.quiz) {
    const questions = c.quiz.questionIds.map((id) => gameContent(g).quizById.get(id)!);
    // Las preguntas solo se envían cuando la prueba está en marcha, y solo a participantes (o a todos al final)
    if (me && view.isParticipant && c.status !== 'briefing') {
      view.mine.quiz = { questions: questions.map((q) => ({ q: q.q, options: [...q.options] })), answers: c.quiz.answers[me.id] ? [...c.quiz.answers[me.id]] : null };
    }
    if (done) {
      const total = Math.max(1, c.participants.length * questions.length);
      const correct = c.participants.reduce((n, id) => n + questions.filter((q, i) => c.quiz!.answers[id]?.[i] === q.answer).length, 0);
      view.result = { quiz: { correctRate: correct / total, questions: questions.map((q) => ({ q: q.q, options: [...q.options], answer: q.answer })) } };
    }
  }

  if (c.code) {
    view.pub.hiderId = c.code.hiderId;
    view.pub.foundBy = c.code.foundBy;
    if (me) {
      const isHider = me.id === c.code.hiderId;
      view.mine.code = { isHider, code: isHider && !done ? c.code.code : null, attemptsLeft: CODE_HUNT_ATTEMPTS - (c.code.attempts[me.id] ?? 0) };
    }
    view.pub.huntStartsAt = c.code.huntStartsAt;
    if (done) view.result = { code: { code: c.code.code, foundBy: c.code.foundBy } };
  }

  if (c.impostor) {
    const imp = c.impostor;
    if (me && view.isParticipant) {
      view.mine.impostor = { word: me.id === imp.infiltradoId ? imp.fakeWord : imp.word, vote: imp.votes[me.id] ?? null };
    }
    if (done) {
      const tally = challengeTallies(c).impostor;
      view.result = { impostor: { infiltradoId: imp.infiltradoId, word: imp.word, fakeWord: imp.fakeWord, tally, caught: c.passed === true } };
    }
  }

  if (c.truthLie) {
    const t = c.truthLie;
    view.pub.speakerId = t.speakerId;
    if (me) {
      const isSpeaker = me.id === t.speakerId;
      view.mine.truthLie = { isSpeaker, lieIndex: isSpeaker || done ? t.lieIndex : null, guess: t.guesses[me.id] ?? null };
    }
    if (done) {
      const counts = [0, 1, 2].map((option) => ({ option, votes: Object.values(t.guesses).filter((x) => x === option).length }));
      const right = counts.find((x) => x.option === t.lieIndex)?.votes ?? 0;
      const total = Object.keys(t.guesses).length;
      view.result = { truthLie: { lieIndex: t.lieIndex, tally: counts, fooled: t.lieIndex !== null && total > 0 && right < total / 2 } };
    }
  }

  if (c.social) {
    view.pub.question = c.social.question;
    if (me) view.mine.social = { vote: c.social.votes[me.id] ?? null };
    if (done) {
      const tally = challengeTallies(c).social;
      view.result = { social: { tally, top: tally.length ? tally.filter((x) => x.votes === tally[0].votes).map((x) => x.id) : [] } };
    }
  }

  // El interrogatorio se juega en voz alta: las preguntas son públicas para la sala
  if (c.interro) view.pub.questions = [...c.interro.questions];
  return view;
}

function meView(g: Game, p: PlayerState, isHost: boolean): MeView {
  const role = roleOf(p);
  const revealed = g.phase !== 'LOBBY';
  return {
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    color: p.color,
    coins: p.coins,
    isHost,
    ready: p.ready,
    left: p.left,
    role: revealed && role ? role : null,
    // Solo un Cuco sabe quiénes son los demás Cucos
    teammates: revealed && isCuco(p) ? g.players.filter((o) => o.id !== p.id && isCuco(o)).map((o) => o.id) : [],
    cerillas: isCuco(p) ? p.cerillas : 0,
    inventory: { candado: p.inventory.candado, voto_doble: p.inventory.voto_doble, coartada: p.inventory.coartada },
    ability: role?.ability ? { usesLeft: abilityUsesLeft(p), canUse: !abilityBlocker(g, p), reason: abilityBlocker(g, p) } : null,
    pilladoAvailable: g.roundIndex >= 0 && p.pilladoRound !== g.roundIndex,
    notes: p.notes,
    prediction: g.predictions[p.id] ?? null,
    canLetter: g.suspects.includes(p.id) && g.suspectRound === g.roundIndex && !g.letters.some((l) => l.playerId === p.id),
  };
}

function missionsOf(g: Game, p: PlayerState): MissionView[] {
  return g.missions
    .filter((m) => m.playerId === p.id)
    .map((m) => ({
      id: m.id,
      text: m.text,
      difficulty: m.difficulty,
      category: m.category,
      reward: m.reward,
      status: m.status,
      suspect: m.tags.includes(SUSPECT_TAG) || undefined,
      partner: m.partnerId
        ? (g.players.find((x) => x.id === m.partnerId)?.name ?? '???')
        : m.partners?.length
          ? m.partners.map((id) => g.players.find((x) => x.id === id)?.name ?? '???').join(' y ')
          : undefined,
      saboteur: m.tags.includes(SABOTEUR_TAG) || undefined,
      custom: m.tags.includes('custom') || undefined,
      expiresAt: m.expiresAt,
    }));
}

function cluesOf(g: Game, p: PlayerState): ClueView[] {
  return g.clues
    .filter((c) => c.recipientId === p.id)
    .map((c) => ({ id: c.id, source: c.source, text: c.text, round: c.round, createdAt: c.createdAt, certified: c.certified || undefined }));
}

function hostPrimary(g: Game): HostView['primary'] {
  const active = activePlayers(g);
  const readyCount = active.filter((p) => p.ready).length;
  switch (g.phase) {
    case 'LOBBY':
      return { label: 'Comenzar partida', enabled: active.length >= 4, hint: active.length < 4 ? `Faltan ${4 - active.length} jugadores` : `${active.length} en la casa` };
    case 'ROLE_REVEAL':
      return { label: 'Empezar ronda 1', enabled: true, hint: `${readyCount}/${active.length} han leído su identidad` };
    case 'ROUND_INTRO':
      return { label: 'Ir a la prueba', enabled: true, hint: null };
    case 'CHALLENGE': {
      const c = g.challenge!;
      const kind = c.kind;
      if (c.status === 'briefing') {
        if (kind === 'truth_lie' && c.truthLie!.lieIndex === null) return { label: 'Empezar votación', enabled: true, hint: 'Aún no ha marcado su mentira' };
        return { label: kind === 'code_hunt' ? '¡A esconder!' : 'Empezar prueba', enabled: true, hint: 'Leed las instrucciones en voz alta' };
      }
      if (c.status === 'running') {
        const label = { physical: 'Tiempo · arbitrar', quiz: 'Cerrar respuestas', code_hunt: 'Terminar búsqueda', word_impostor: 'A votar', truth_lie: 'Cerrar votos', social_vote: 'Cerrar votos', interrogatorio: 'Cerrar el interrogatorio' }[kind];
        return { label, enabled: true, hint: null };
      }
      if (c.status === 'voting') return { label: 'Revelar infiltrado', enabled: true, hint: null };
      if (c.status === 'judging') return { label: 'Arbitra la prueba', enabled: false, hint: defOf(g, c).scoring === 'winner' ? 'Elige al ganador' : '¿Superada o fallada?' };
      return { label: 'Continuar', enabled: true, hint: null };
    }
    case 'RITUAL':
      return g.ritual!.status === 'open'
        ? { label: 'Revelar el Ritual', enabled: true, hint: `${Object.keys(g.ritual!.choices).length}/${g.ritual!.participants.length} han decidido` }
        : { label: 'A investigar', enabled: true, hint: null };
    case 'INVESTIGATION':
      return { label: g.plan[g.roundIndex]?.hasJudgment ? 'Al juicio' : 'Terminar ronda', enabled: true, hint: null };
    case 'VOTING':
      return g.vote!.status === 'open'
        ? { label: 'Revelar votos', enabled: true, hint: `${Object.keys(g.vote!.ballots).length}/${g.vote!.voters.length} han votado` }
        : { label: 'Ver resumen', enabled: true, hint: null };
    case 'ROUND_RESULT':
      return { label: g.roundIndex >= g.plan.length - 1 ? 'Gran Acusación' : 'Siguiente ronda', enabled: true, hint: null };
    case 'FINAL_ACCUSATION':
      return { label: 'Revelar la verdad', enabled: true, hint: `${Object.keys(g.vote!.ballots).length}/${g.vote!.voters.length} han acusado` };
    case 'FINALE':
      return g.finaleStep < (g.finale?.totalSteps ?? 1) - 1 ? { label: 'Siguiente', enabled: true, hint: null } : { label: 'Fin de la noche', enabled: false, hint: null };
  }
}

function hostView(g: Game, viewer: Viewer): HostView {
  const isDirectorDevice = viewer.audience === 'director';
  const sealAvailable = isDirectorDevice && !g.settings.hostPlays && g.phase !== 'LOBBY';
  const c = g.challenge;
  return {
    primary: hostPrimary(g),
    canJudge: g.phase === 'CHALLENGE' && !!c && (c.kind === 'physical' || c.kind === 'interrogatorio') && (c.status === 'judging' || c.status === 'running') && defOf(g, c).scoring === 'passfail',
    canPickWinners: g.phase === 'CHALLENGE' && !!c && (c.kind === 'physical' || c.kind === 'interrogatorio') && (c.status === 'judging' || c.status === 'running') && defOf(g, c).scoring === 'winner',
    eventsAvailable: g.phase === 'LOBBY' || g.phase === 'FINALE' ? [] : eligibleEvents(g).map((e) => ({ id: e.id, emoji: e.emoji, title: e.title })),
    isDirectorDevice,
    sealAvailable,
    // Solo tras abrir el sobre lacrado explícitamente, y nunca si el director juega
    secrets:
      sealAvailable && g.sealOpened > 0
        ? g.players.filter((p) => p.roleId).map((p) => {
            const r = getRole(p.roleId!);
            return { playerId: p.id, roleName: r.name, emoji: r.emoji, faction: r.faction };
          })
        : null,
    joinUrlPath: `/unirse/${g.code}`,
  };
}

function finaleView(g: Game): FinaleView | null {
  if (g.phase !== 'FINALE' || !g.finale) return null;
  const roles: Record<string, RoleDef> = {};
  for (const r of content.roles) roles[r.id] = r;
  return { ...structuredClone(g.finale), step: g.finaleStep, roles };
}

export function buildView(g: Game, viewer: Viewer): GameView {
  const me = viewer.playerId ? (g.players.find((p) => p.id === viewer.playerId) ?? null) : null;
  const plan = g.plan[g.roundIndex];
  const eventDef = g.event ? gameContent(g).eventById.get(g.event.id) : null;
  const lastRound = g.rounds[g.roundIndex];
  const shopPrices = {} as Record<ShopItemId, number>;
  for (const item of Object.keys(SHOP_PRICES) as ShopItemId[]) shopPrices[item] = priceOf(g, item, me);

  const view: GameView = {
    audience: viewer.audience,
    serverNow: Date.now(),
    version: g.version,
    code: g.code,
    phase: g.phase,
    // customMissions y contentMod se quedan fuera: los retoques del anfitrión solo salen cuando la casa los usa
    settings: { ...g.settings, customMissions: undefined, contentMod: undefined },
    round: plan ? { index: g.roundIndex, total: g.plan.length, title: plan.title, hasJudgment: plan.hasJudgment } : null,
    velas: g.velas,
    grietas: g.grietas,
    candleSlots: Math.max(g.plan.length - 1, 1),
    cucoCount: g.cucoCount,
    players: publicPlayers(g),
    phaseEndsAt: g.phaseEndsAt,
    pausedRemainingMs: g.pausedRemainingMs,
    event: eventDef ? { id: eventDef.id, emoji: eventDef.emoji, title: eventDef.title, text: eventDef.text, endsAt: g.event!.endsAt } : null,
    challenge: challengeView(g, me),
    market: [...g.market],
    ritual: g.ritual
      ? {
          status: g.ritual.status,
          participants: [...g.ritual.participants],
          isParticipant: !!me && g.ritual.participants.includes(me.id),
          myChoice: me ? (g.ritual.choices[me.id] ?? null) : null,
          submittedCount: Object.keys(g.ritual.choices).length,
          result: g.ritual.status === 'revealed' ? { apagones: g.ritual.apagones, outcome: g.ritual.outcome! } : undefined,
        }
      : null,
    vote: g.vote
      ? {
          kind: g.vote.kind,
          status: g.vote.status,
          picks: g.vote.picks,
          isPublic: g.vote.isPublic,
          votedCount: Object.keys(g.vote.ballots).length,
          total: g.vote.voters.length,
          myVote: me && g.vote.ballots[me.id] ? [...g.vote.ballots[me.id]] : null,
          myWeight: me ? (g.vote.weights[me.id] ?? (g.vote.kind === 'juicio' && me.inventory.voto_doble > 0 ? 2 : 1)) : 1,
          bets: Object.entries(g.vote.bets).map(([playerId, b]) => ({ playerId, targetId: b.targetId, amount: b.amount })),
          myBet: me && g.vote.bets[me.id] ? { ...g.vote.bets[me.id] } : null,
          result:
            g.vote.status === 'revealed' && g.vote.tally
              ? {
                  tally: g.vote.tally.map((t) => ({ ...t })),
                  suspects: [...g.vote.suspects],
                  ballots: g.vote.isPublic ? Object.entries(g.vote.ballots).map(([voterId, targets]) => ({ voterId, targets: [...targets] })) : undefined,
                }
              : undefined,
        }
      : null,
    lastRound:
      g.phase === 'ROUND_RESULT' && lastRound
        ? { index: lastRound.index, outcome: lastRound.outcome, challengeTitle: gameContent(g).challengeById.get(lastRound.challengeId)?.title ?? '', apagones: lastRound.apagones, suspects: [...g.suspects] }
        : null,
    // Las pujas ajenas no salen: solo el número. El ganador nunca se nombra.
    auction: g.auction ? { endsAt: g.auction.endsAt, bidsCount: Object.keys(g.auction.bids).length, myBid: me ? (g.auction.bids[me.id]?.amount ?? null) : null } : null,
    shopOpen: g.phase === 'INVESTIGATION' && !g.flags.noShop,
    shopPrices,
    announcements: g.announcements.slice(-8).map((a) => ({ ...a })),
    finale: finaleView(g),
    hostOnline: viewer.hostOnline,
  };

  if (me) {
    view.me = meView(g, me, viewer.isHost);
    view.missions = missionsOf(g, me);
    view.clues = cluesOf(g, me);
  }
  if (viewer.isHost) view.host = hostView(g, viewer);
  return view;
}
