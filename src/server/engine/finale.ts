import { BET_PAYOUT, FINAL_BONUS, PREDICTION_REWARD } from '../../shared/constants.ts';
import type { Award, FinaleView } from '../../shared/types.ts';
import { gameContent, getRole } from '../content.ts';
import { SABOTEUR_TAG } from './missions.ts';
import { type Game, type PlayerState, factionOf, isCuco, nameOf } from './state.ts';

export const FINALE_STEPS = 10;

const byMax = (players: PlayerState[], score: (p: PlayerState) => number, min = 1): PlayerState | null => {
  let best: PlayerState | null = null;
  for (const p of players) if (score(p) >= min && (!best || score(p) > score(best))) best = p;
  return best;
};

export function computeFinale(g: Game): Omit<FinaleView, 'step' | 'roles'> {
  const everyone = g.players.filter((p) => p.roleId);
  const cucos = everyone.filter(isCuco);
  const vote = g.vote?.kind === 'final' ? g.vote : null;
  const ballots = vote?.ballots ?? {};
  // «Más de la mitad de la casa»: cuenta quien podía acusar y sigue dentro, haya votado o no.
  // Contar solo las papeletas emitidas dejaba que dos votos desenmascarasen en una casa de diez.
  const houseSize = vote ? vote.voters.filter((id) => !g.players.find((p) => p.id === id)?.left).length : 0;

  const counts = new Map<string, number>();
  for (const targets of Object.values(ballots)) for (const t of targets) counts.set(t, (counts.get(t) ?? 0) + 1);
  const accusation = [...counts.entries()].map(([id, votes]) => ({ id, votes })).sort((a, b) => b.votes - a.votes);
  const unmasked = cucos.filter((c) => (counts.get(c.id) ?? 0) > houseSize / 2).map((c) => c.id);
  // Un Cuco que se fue no puede ser acusado (castVote solo admite activos): contarlo
  // como «impune» premiaría a su bando por abandonar. Ni suma ni resta.
  const hidden = cucos.filter((c) => !c.left && !unmasked.includes(c.id));

  const huespedes = g.velas + 2 * unmasked.length;
  const cucoScore = g.grietas + 2 * hidden.length;
  const winner: 'huespedes' | 'cucos' = huespedes > cucoScore ? 'huespedes' : 'cucos';

  const topAccused = accusation.length && accusation.filter((a) => a.votes === accusation[0].votes).length === 1 ? accusation[0].id : null;
  const turista = everyone.find((p) => p.roleId === 'turista');
  const turistaWon = turista && topAccused === turista.id ? turista.id : null;

  // ---- bonus finales (se suman a las monedas: las monedas son los puntos)
  const bonus = new Map<string, number>();
  const add = (id: string, n: number) => bonus.set(id, (bonus.get(id) ?? 0) + n);
  for (const p of everyone) {
    const f = factionOf(p);
    if ((winner === 'huespedes' && f === 'huesped') || (winner === 'cucos' && f === 'cuco')) add(p.id, FINAL_BONUS.winningFaction);
    if (hidden.includes(p)) add(p.id, FINAL_BONUS.hiddenCuco);
    const named = (ballots[p.id] ?? []).filter((t) => cucos.some((c) => c.id === t)).length;
    if (named) {
      add(p.id, named * FINAL_BONUS.correctAccusation);
      p.stats.correctVotes += named;
    }
  }
  if (turistaWon) add(turistaWon, FINAL_BONUS.turista);

  // El Buscavidas no es Cuco ni le debe nada a la casa: gana si acaba entre
  // los 3 más ricos, contando solo la pasta ganada a pulso (antes de los premios)
  const busca = everyone.find((p) => p.roleId === 'buscavidas');
  // Solo compite con quien sigue en la casa: un ausente rico no le quita el podio
  const buscavidasWon =
    busca && !busca.left && everyone.filter((p) => !p.left).sort((a, b) => b.coins - a.coins).slice(0, 3).some((p) => p.id === busca.id) ? busca.id : null;
  if (buscavidasWon) add(buscavidasWon, FINAL_BONUS.buscavidas);

  // El Padrino apadrinó a alguien en secreto: si su ahijado era un Cuco que salió
  // impune, la familia cobra — él gana aunque la casa se haya salvado.
  const padrino = everyone.find((p) => p.roleId === 'padrino');
  const padrinoWon =
    padrino?.ahijadoId &&
    !padrino.left &&
    cucos.some((c) => c.id === padrino.ahijadoId && !c.left && !unmasked.includes(c.id))
      ? padrino.id
      : null;
  if (padrinoWon) add(padrinoWon, FINAL_BONUS.padrino);

  // El Ermitaño cumplió su voto de silencio si no votó en ningún juicio
  const ermitano = everyone.find((p) => p.roleId === 'ermitano');
  const ermitanoWon = ermitano && !ermitano.left && (ermitano.stats.votesCast ?? 0) === 0 ? ermitano.id : null;
  if (ermitanoWon) add(ermitanoWon, FINAL_BONUS.ermitano);

  // ---- apuestas de la Gran Acusación: acertar paga el doble de lo apostado
  const bets = Object.entries(vote?.bets ?? {}).map(([playerId, bet]) => {
    const p = everyone.find((x) => x.id === playerId);
    const target = everyone.find((x) => x.id === bet.targetId);
    const won = !!target && isCuco(target);
    if (p && won) {
      p.coins += bet.amount * BET_PAYOUT;
      p.stats.betsWon++;
      p.stats.betProfit += bet.amount;
    } else if (p) {
      p.stats.betProfit -= bet.amount;
    }
    return { playerId, targetId: bet.targetId, amount: bet.amount, won };
  });

  // ---- predicciones a ciegas de la ronda 1: oler a un Cuco sin datos paga
  const predictions = Object.entries(g.predictions).map(([playerId, targetId]) => {
    const hit = everyone.some((x) => x.id === targetId && isCuco(x));
    if (hit) {
      add(playerId, PREDICTION_REWARD);
      const p = everyone.find((x) => x.id === playerId);
      if (p) p.stats.correctVotes++;
    }
    return { playerId, targetId, hit };
  });

  for (const [id, n] of bonus) {
    const p = everyone.find((x) => x.id === id)!;
    p.coins += n;
  }
  for (const [id, n] of counts) {
    const p = everyone.find((x) => x.id === id);
    if (p) p.stats.votesReceived += n;
  }

  const ranking = everyone
    .map((p) => ({ playerId: p.id, coins: p.coins - (bonus.get(p.id) ?? 0), bonus: bonus.get(p.id) ?? 0, total: p.coins }))
    .sort((a, b) => b.total - a.total);

  // ---- premios
  const awards: Award[] = [];
  const give = (id: string, emoji: string, title: string, p: PlayerState | null, reason: (p: PlayerState) => string) => {
    if (p) awards.push({ id, emoji, title, playerId: p.id, reason: reason(p) });
  };
  const s = (p: PlayerState) => p.stats;
  give('detective', '🕵️', 'Mejor detective', byMax(everyone.filter((p) => !isCuco(p)), (p) => s(p).correctVotes), (p) => `Señaló a un Cuco ${s(p).correctVotes} ${s(p).correctVotes === 1 ? 'vez' : 'veces'}.`);
  give('traidor', '😈', 'Mayor traidor', byMax(cucos, (p) => s(p).apagones * 2 + s(p).forges + s(p).steals, 0), (p) => `${s(p).apagones} velas apagadas, ${s(p).forges} notas falsas y ${s(p).steals} robos.`);
  give('sospechoso', '😂', 'Más sospechoso', byMax(everyone, (p) => s(p).votesReceived), (p) => `Recibió ${s(p).votesReceived} votos en total. Algo habrá hecho.`);
  give('mentiroso', '🎭', 'Mejor mentiroso', cucos.length ? [...cucos].sort((a, b) => s(a).votesReceived - s(b).votesReceived)[0] : null, (p) => `Era un Cuco y solo recibió ${s(p).votesReceived} votos.`);
  give('misionero', '🎯', 'Agente secreto', byMax(everyone, (p) => s(p).missionsCompleted), (p) => `Completó ${s(p).missionsCompleted} misiones secretas.`);
  give('manos', '🧤', 'Manos largas', byMax(everyone, (p) => s(p).steals), (p) => `Metió la mano en ${s(p).steals} bolsillos ajenos.`);
  give('campeon', '🏆', 'Campeón de la casa', everyone.find((p) => p.id === ranking[0]?.playerId) ?? null, (p) => `${p.coins} monedas al final de la noche.`);
  give('ludopata', '🎰', 'Ludópata de la casa', byMax(everyone, (p) => s(p).betProfit), (p) => `Ganó ${s(p).betProfit} monedas apostando en la Gran Acusación.`);

  // ---- momentos
  const missionHighlights = g.missions
    .filter((m) => m.status === 'completed')
    .sort((a, b) => ['facil', 'media', 'dificil', 'epica'].indexOf(b.difficulty) - ['facil', 'media', 'dificil', 'epica'].indexOf(a.difficulty))
    .slice(0, 8)
    .map((m) => ({ playerId: m.playerId, text: m.text, difficulty: m.difficulty }));

  const falseClues = g.clues.filter((c) => c.truth === 'false').map((c) => ({ recipientId: c.recipientId, text: c.text, forgedBy: c.forgedBy }));

  const traiciones = cucos.reduce((n, p) => n + s(p).apagones + s(p).forges + s(p).steals, 0);
  const completed = g.missions.filter((m) => m.status === 'completed').length;

  return {
    totalSteps: FINALE_STEPS,
    headline: { players: everyone.length, missions: completed, clues: g.clues.length, traiciones, velas: g.velas, grietas: g.grietas },
    reveal: everyone.map((p) => ({ playerId: p.id, roleId: p.roleId!, faction: getRole(p.roleId!).faction })),
    unmasked,
    accusation,
    balance: { huespedes, cucos: cucoScore, winner },
    turistaWon,
    buscavidasWon,
    padrinoWon,
    ermitanoWon,
    missionHighlights,
    falseClues,
    awards,
    ranking,
    bets,
    predictions,
    chronicle: chronicle(g, winner, { huespedes, cucos: cucoScore }, ranking, predictions, buscavidasWon, padrinoWon, ermitanoWon),
    funStats: funStats(g, everyone),
    sealOpenedTimes: g.sealOpened,
  };
}

/** La crónica de la noche: relato legible en voz alta de lo que pasó de verdad.
 *  Se escribe al cerrar la casa — ya no hay secretos que proteger. */
function chronicle(
  g: Game,
  winner: 'huespedes' | 'cucos',
  balance: { huespedes: number; cucos: number },
  ranking: { playerId: string; total: number }[],
  predictions: { playerId: string; targetId: string; hit: boolean }[],
  buscavidasWon: string | null,
  padrinoWon: string | null,
  ermitanoWon: string | null,
): string[] {
  const lines: string[] = [];
  const names = (ids: string[]) => ids.map((id) => nameOf(g, id)).join(' y ');
  const mins = g.startedAt && g.finishedAt ? Math.max(1, Math.round((g.finishedAt - g.startedAt) / 60000)) : null;
  lines.push(`La casa ${g.code} abrió sus puertas a ${g.players.filter((p) => p.roleId).length} huéspedes${mins ? `, durante ${mins} minutos` : ''}.`);

  for (const r of g.rounds) {
    const title = gameContent(g).challengeById.get(r.challengeId)?.title ?? 'la prueba';
    const events = r.eventIds.map((id) => gameContent(g).eventById.get(id)?.title).filter(Boolean).join(' · ');
    let line = `Ronda ${r.index + 1}, «${title}»${events ? ` — con ${events}` : ''}`;
    line += r.outcome === 'grieta' ? ': se abrió una grieta.' : r.outcome === 'vela' ? ': la vela aguantó.' : ': pasó sin consecuencias.';
    lines.push(line);
    if (r.saboteurs.length) lines.push(`En la oscuridad del Ritual, ${names(r.saboteurs)} apagaron la vela.`);
    if (r.suspects.length) lines.push(`El juicio señaló a ${names(r.suspects)}.`);
  }

  for (const m of g.missions.filter((x) => x.tags.includes(SABOTEUR_TAG))) {
    lines.push(
      m.status === 'completed'
        ? `${nameOf(g, m.playerId)} saboteó una prueba por orden de la casa y salió impune.`
        : `A ${nameOf(g, m.playerId)} le ordenaron sabotear, pero el equipo pudo más.`,
    );
  }

  const burned = g.missions.filter((m) => m.status === 'burned').length;
  if (burned) lines.push(`${burned === 1 ? 'Una misión quedó' : `${burned} misiones quedaron`} en cenizas a golpe de ¡PILLADO!.`);
  const couples = new Set(g.missions.filter((m) => m.partnerId).map((m) => m.missionId)).size;
  if (couples) lines.push(`Hubo ${couples === 1 ? 'una misión' : `${couples} misiones`} en pareja: miradas cómplices por toda la casa.`);
  const notes = g.clues.filter((c) => c.source === 'nota').length;
  if (notes) lines.push(`${notes === 1 ? 'Una nota se deslizó' : `${notes} notas se deslizaron`} bajo las puertas. Algunas mentían.`);
  const bets = g.vote?.kind === 'final' ? Object.keys(g.vote.bets).length : 0;
  if (bets) lines.push(`La Gran Acusación fue un casino: ${bets} ${bets === 1 ? 'apuesta' : 'apuestas'} sobre la mesa.`);
  const hunches = predictions.filter((x) => x.hit);
  if (hunches.length === 1) lines.push(`${nameOf(g, hunches[0].playerId)} lo olió desde el primer minuto: señaló a ${nameOf(g, hunches[0].targetId)} sin prueba alguna.`);
  if (hunches.length > 1) lines.push(`${names(hunches.map((x) => x.playerId))} lo olieron desde el primer minuto.`);

  lines.push(`La balanza quedó ${balance.huespedes} a ${balance.cucos}: ${winner === 'huespedes' ? 'la casa se salvó' : 'la casa quedó en manos de los Cucos'}.`);
  if (buscavidasWon) lines.push(`Y ${nameOf(g, buscavidasWon)}, el Buscavidas, se marchó entre los tres más ricos. Ganó sin deberle nada a nadie.`);
  if (padrinoWon) lines.push(`${nameOf(g, padrinoWon)}, el Padrino, apadrinó al Cuco correcto. La familia siempre cobra.`);
  if (ermitanoWon) lines.push(`${nameOf(g, ermitanoWon)}, el Ermitaño, cumplió su voto de silencio hasta el final. La casa le paga la paz.`);
  if (ranking[0]) lines.push(`${nameOf(g, ranking[0].playerId)} se marchó con ${ranking[0].total} monedas y la frente muy alta.`);
  return lines;
}

function funStats(g: Game, everyone: PlayerState[]): string[] {
  const lines: string[] = [];
  const s = (p: PlayerState) => p.stats;
  const top = (score: (p: PlayerState) => number, min = 1) => byMax(everyone, score, min);

  let p = top((x) => s(x).pilladoMisses);
  if (p) lines.push(`${p.name} acusó en falso con el ¡PILLADO! ${s(p).pilladoMisses} ${s(p).pilladoMisses === 1 ? 'vez' : 'veces'}. Paranoia de manual.`);
  p = top((x) => s(x).missionsBurned);
  if (p) lines.push(`A ${p.name} le quemaron ${s(p).missionsBurned} ${s(p).missionsBurned === 1 ? 'misión' : 'misiones'}. Sutileza: cero.`);
  p = top((x) => s(x).bluffApagar);
  if (p) lines.push(`${p.name} pulsó APAGAR siendo huésped ${s(p).bluffApagar} ${s(p).bluffApagar === 1 ? 'vez' : 'veces'}. Nadie sabe por qué.`);
  p = top((x) => s(x).suspectRounds);
  if (p) lines.push(`${p.name} estuvo bajo sospecha ${s(p).suspectRounds} ${s(p).suspectRounds === 1 ? 'ronda' : 'rondas'}.`);
  p = top((x) => s(x).coinsGifted);
  if (p) lines.push(`${p.name} regaló ${s(p).coinsGifted} monedas. Soborno o generosidad, nunca lo sabremos.`);
  const worstBet = [...everyone].sort((a, b) => s(a).betProfit - s(b).betProfit)[0];
  if (worstBet && s(worstBet).betProfit < 0) lines.push(`${worstBet.name} perdió ${-s(worstBet).betProfit} monedas apostando. La casa siempre gana.`);
  p = top((x) => s(x).coinsSpent);
  if (p) lines.push(`${p.name} se dejó ${s(p).coinsSpent} monedas en la Despensa.`);
  p = top((x) => s(x).stolenFrom);
  if (p) lines.push(`A ${p.name} le robaron ${s(p).stolenFrom} ${s(p).stolenFrom === 1 ? 'vez' : 'veces'}. Que alguien le compre un candado.`);
  p = top((x) => s(x).quizCorrect, 3);
  if (p) lines.push(`${p.name} acertó ${s(p).quizCorrect} preguntas. Cerebro de la casa.`);
  const clueless = [...everyone].sort(
    (a, b) => s(a).cluesReceived + s(a).abilityUses + s(a).itemsBought - (s(b).cluesReceived + s(b).abilityUses + s(b).itemsBought),
  )[0];
  if (clueless && s(clueless).cluesReceived === 0) lines.push(`${clueless.name} sobrevivió sin saber absolutamente nada.`);
  const falseCount = g.clues.filter((c) => c.truth === 'false').length;
  if (g.clues.length) lines.push(`${Math.round((falseCount / g.clues.length) * 100)}% de las pistas de esta noche eran falsas.`);
  const forged = g.clues.filter((c) => c.forgedBy);
  if (forged.length) lines.push(`${nameOf(g, forged[0].forgedBy!)} escribió ${forged.filter((c) => c.forgedBy === forged[0].forgedBy).length} notas falsas con muy buena letra.`);
  lines.push(`Se encendieron ${g.velas} velas y se abrieron ${g.grietas} grietas.`);
  if (g.sealOpened) lines.push(`El director abrió el sobre lacrado ${g.sealOpened} ${g.sealOpened === 1 ? 'vez' : 'veces'}. Lo sabemos.`);
  return lines;
}
