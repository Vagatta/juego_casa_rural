import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { content, roleById } from '../src/server/content.ts';
import { addPlayer, advance, createGame, hostAction, leavePlayer, onPlayerOffline, playerAction, readyUp, startGame, takeOverPlayer, tick } from '../src/server/engine/game.ts';
import { pillar } from '../src/server/engine/missions.ts';
import { dealCoupleMission, dealCorroMission, dealMissions, discardMission, assignSaboteurMission, resolveSaboteur, SUSPECT_TAG } from '../src/server/engine/missions.ts';
import { applyEvent } from '../src/server/engine/events.ts';
import { computeFinale } from '../src/server/engine/finale.ts';
import { buildPlan, affectsCandles } from '../src/server/engine/plan.ts';
import { roleDistribution } from '../src/server/engine/roles.ts';
import { challengeById, gameContent } from '../src/server/content.ts';
import { AUTO_DELAY_SEC, BET_PAYOUT, GANZUA_STEAL, MARKET_DISCOUNT, SHOP_PRICES, TAKEOVER_GRACE_MS } from '../src/shared/constants.ts';
import { finalizeChallenge, setupChallenge } from '../src/server/engine/challenges.ts';
import { priceOf } from '../src/server/engine/game.ts';
import { getPlayer, newOutbox, type Game, type PlayerState } from '../src/server/engine/state.ts';
import { GameStore } from '../src/server/store.ts';
import type { GameSettings, ShopItemId } from '../src/shared/types.ts';

test('contenido suficiente y bien formado', () => {
  assert.ok(content.missions.length >= 100, `${content.missions.length} misiones`);
  for (const d of ['facil', 'media', 'dificil', 'epica'] as const) assert.ok(content.missions.some((m) => m.difficulty === d), d);
  assert.ok(content.challenges.length >= 25);
  assert.ok(content.events.length >= 25);
  for (const m of content.missions) {
    const placeholders = (m.text.match(/\{[AB]\}/g) ?? []).length ? new Set(m.text.match(/\{[AB]\}/g)).size : 0;
    assert.equal(placeholders, m.targets, `${m.id}: los objetivos {A}/{B} cuadran con targets`);
  }
});

test('reparto de roles para 4-12 jugadores', () => {
  for (let n = 4; n <= 12; n++) {
    for (let i = 0; i < 30; i++) {
      const roles = roleDistribution(n);
      assert.equal(roles.length, n);
      roles.forEach((r) => assert.ok(roleById.has(r), r));
      const cucos = roles.filter((r) => roleById.get(r)!.faction === 'cuco').length;
      assert.equal(cucos, n <= 5 ? 1 : n <= 10 ? 2 : 3);
      assert.ok(roles.includes('curioso'), 'siempre hay un Curioso');
      if (cucos === 1) assert.ok(!roles.includes('cuco_doble'), 'un Cuco solitario nunca es el Doble');
    }
  }
  const nine = roleDistribution(9).filter((r) => !r.startsWith('cuco'));
  assert.equal(nine.filter((r) => r === 'curioso').length, 2);
  assert.ok(nine.includes('abuela'), 'la Abuela es fija en mesas de 9');
});

test('plan de rondas equilibrado y variado', () => {
  for (const durationMin of [60, 90, 120] as const) {
    for (const mode of ['clasico', 'caos', 'sofa'] as const) {
      for (let i = 0; i < 40; i++) {
        const plan = buildPlan({ durationMin, mode, difficulty: 'normal', expectedPlayers: 9, hostPlays: true }, 9);
        assert.equal(plan.length, { 60: 4, 90: 6, 120: 8 }[durationMin]);
        const defs = plan.map((r) => challengeById.get(r.challengeId)!);
        assert.ok(!affectsCandles(defs[0]), 'la ronda 1 rompe el hielo sin velas');
        assert.equal(new Set(plan.map((r) => r.challengeId)).size, plan.length, 'sin pruebas repetidas');
        assert.ok(!plan[0].hasJudgment && !plan[plan.length - 1].hasJudgment);
        assert.ok(plan.some((r) => r.hasJudgment));
        if (mode === 'sofa') assert.ok(defs.every((d) => d.category !== 'fisica'), 'modo sofá sin pruebas físicas');
        assert.ok(defs.filter(affectsCandles).length >= plan.length - 2, 'casi todas las rondas mueven velas');
      }
    }
  }
  // Modo turbo: 30 minutos, 2 rondas, sin juicio de por medio — la Gran Acusación lo es todo
  for (const mode of ['clasico', 'caos', 'sofa'] as const) {
    for (let i = 0; i < 20; i++) {
      const plan = buildPlan({ durationMin: 30, mode, difficulty: 'normal', expectedPlayers: 6, hostPlays: true }, 6);
      assert.equal(plan.length, 2);
      assert.ok(plan.every((r) => !r.hasJudgment), 'el sprint no lleva juicio de ronda');
      if (mode === 'sofa') {
        const defs = plan.map((r) => challengeById.get(r.challengeId)!);
        assert.ok(defs.every((d) => d.category !== 'fisica'));
      }
    }
  }
});

test('la despensa: cada objeto hace lo que promete', () => {
  const settings: GameSettings = { durationMin: 60, difficulty: 'normal', mode: 'clasico', expectedPlayers: 6, hostPlays: true };
  const g: Game = createGame('TEST1', settings);
  const ps = ['Ana', 'Carlos', 'Diego', 'Laura', 'Marcos', 'Marta'].map((n) => addPlayer(g, n, '🐓'));
  const [ana, carlos, diego, laura, marcos, marta] = ps;
  // Roles mínimos para que las pistas tengan de qué hablar
  diego.roleId = 'cuco_doble';
  laura.roleId = 'cuco_falsificador';
  for (const p of ps) p.roleId ??= 'curioso';
  const out = newOutbox();
  g.plan = buildPlan(settings, 6); // con juicios por delante: el voto doble tiene sentido
  g.phase = 'INVESTIGATION';
  const buy = (p: PlayerState, item: ShopItemId, targetId?: string, amount?: number) =>
    playerAction(g, p, { type: 'buy', item, targetId, amount }, out, true);

  // Ganzúa: paga 30 y roba hasta 50
  ana.coins = 100;
  carlos.coins = 80;
  buy(ana, 'ganzua', carlos.id);
  assert.equal(ana.coins, 100 - SHOP_PRICES.ganzua + GANZUA_STEAL);
  assert.equal(carlos.coins, 80 - GANZUA_STEAL);

  // Candado: frena el siguiente robo
  buy(carlos, 'candado');
  assert.equal(carlos.inventory.candado, 1);
  const antes = carlos.coins;
  buy(ana, 'ganzua', carlos.id);
  assert.equal(carlos.coins, antes, 'el candado frena el robo');
  assert.equal(carlos.inventory.candado, 0, 'el candado se gasta');

  // Sin saldo no hay compra
  marta.coins = 0;
  assert.throws(() => buy(marta, 'pista'), /monedas/i);

  // Pista: llega como pista privada
  const before = g.clues.filter((c) => c.recipientId === ana.id).length;
  buy(ana, 'pista');
  assert.equal(g.clues.filter((c) => c.recipientId === ana.id).length, before + 1);
  assert.ok(g.clues.every((c) => c.recipientId !== carlos.id || c.source === 'mirilla'), 'la pista solo la ve quien la compra');

  // Mirilla: dice a quién votó alguien en el último juicio
  assert.throws(() => buy(marcos, 'mirilla', carlos.id), /juicio/i);
  g.lastJudgment = { [carlos.id]: [ana.id] };
  marcos.coins = 60;
  buy(marcos, 'mirilla', carlos.id);
  const mirillaClue = g.clues.find((c) => c.recipientId === marcos.id && c.source === 'mirilla')!;
  assert.match(mirillaClue.text, /Carlos votó a Ana/);

  // Sobre: traspasa monedas sin pasar por la tienda
  laura.coins = 50;
  buy(laura, 'sobre', carlos.id, 15);
  assert.equal(laura.coins, 35);
  assert.equal(carlos.coins, antes + 15);
  assert.throws(() => buy(laura, 'sobre', laura.id, 5), /quién/i);

  // Voto doble: el siguiente voto en un juicio pesa el doble
  buy(ana, 'voto_doble');
  g.phase = 'VOTING';
  g.vote = { kind: 'juicio', status: 'open', picks: 1, isPublic: false, voters: ps.map((p) => p.id), ballots: {}, weights: {}, tally: null, suspects: [], bets: {} };
  playerAction(g, ana, { type: 'vote', targets: [carlos.id] }, out, true);
  assert.equal(g.vote!.weights[ana.id], 2);
  assert.equal(ana.inventory.voto_doble, 0, 'se consume al votar');

  // La despensa solo abre en investigación
  g.phase = 'CHALLENGE';
  assert.throws(() => buy(ana, 'pista'), /fase|momento|Ahora/i);
});

test('bajo sospecha: tarea forzada que no se descarta', () => {
  const settings: GameSettings = { durationMin: 60, difficulty: 'normal', mode: 'clasico', expectedPlayers: 6, hostPlays: true };
  const g: Game = createGame('TEST2', settings);
  const ps = ['Ana', 'Carlos', 'Diego', 'Laura', 'Marcos', 'Marta'].map((n) => addPlayer(g, n, '🐓'));
  const [ana, , , laura] = ps;
  for (const p of ps) p.roleId ??= 'curioso';
  const out = newOutbox();
  g.roundIndex = 1;
  g.suspects = [laura.id]; // Laura fue la más votada en el juicio anterior

  dealMissions(g, out);

  const task = g.missions.find((m) => m.playerId === laura.id && m.tags.includes(SUSPECT_TAG))!;
  assert.ok(task, 'Laura recibe una tarea de sospechosa');
  assert.equal(task.status, 'active');
  assert.ok(task.reward > 0);
  assert.ok(!g.missions.some((m) => m.playerId === ana.id && m.tags.includes(SUSPECT_TAG)), 'los demás no reciben tarea');
  assert.throws(() => discardMission(g, laura, task.id), /no se descarta|orden/i, 'la orden de la casa es forzada');

  // Un jugador normal sí puede descartar sus misiones
  const normal = g.missions.find((m) => m.playerId === ana.id && m.status === 'active')!;
  discardMission(g, ana, normal.id);
  assert.equal(normal.status, 'discarded');
});

test('apuestas, coartada, espejo, altavoz, cuaderno e insomne', () => {
  const settings: GameSettings = { durationMin: 60, difficulty: 'normal', mode: 'clasico', expectedPlayers: 6, hostPlays: true };
  const g: Game = createGame('TEST3', settings);
  const ps = ['Ana', 'Carlos', 'Diego', 'Laura', 'Marcos', 'Marta'].map((n) => addPlayer(g, n, '🐓'));
  const [ana, carlos, diego, laura, marcos, marta] = ps;
  laura.roleId = 'cuco_falsificador';
  marcos.roleId = 'insomne';
  marta.roleId = 'contable';
  for (const p of ps) p.roleId ??= 'curioso';
  const out = newOutbox();
  g.roundIndex = 0;

  // Cuaderno: notas privadas persistentes
  playerAction(g, ana, { type: 'note', text: 'Laura mintió en la ronda 1' }, out, true);
  assert.equal(ana.notes, 'Laura mintió en la ronda 1');
  playerAction(g, ana, { type: 'note', text: 'x'.repeat(600) }, out, true);
  assert.equal(ana.notes.length, 500, 'las notas se recortan a 500');

  // Insomne: oye cuando alguien recibe una misión
  dealMissions(g, out);
  assert.ok(g.clues.some((c) => c.recipientId === marcos.id && c.source === 'chisme' && c.text.includes('misión nueva')), 'el insomne recibe el rumor');

  // Contable: despensa más barata
  g.phase = 'INVESTIGATION';
  marta.coins = 100;
  playerAction(g, marta, { type: 'buy', item: 'pista' }, out, true);
  assert.equal(marta.coins, 100 - Math.floor(SHOP_PRICES.pista * 0.75), '25% de descuento');

  // Espejo: dice la facción real
  ana.coins = 200;
  playerAction(g, ana, { type: 'buy', item: 'espejo', targetId: laura.id }, out, true);
  const espejo = g.clues.find((c) => c.recipientId === ana.id && c.source === 'espejo')!;
  assert.match(espejo.text, /Laura es un Cuco/);
  assert.equal(espejo.truth, 'true');

  // Altavoz: mensaje anónimo a todos
  playerAction(g, ana, { type: 'buy', item: 'altavoz', text: 'Marcos huele a cerillas' }, out, true);
  assert.ok(g.announcements.some((a) => a.text.includes('Marcos huele a cerillas')), 'el altavoz grita el mensaje');
  assert.ok(!g.announcements.some((a) => a.text.includes('Ana') && a.text.includes('cerillas')), 'el altavoz no delata al autor');

  // Coartada: el ¡PILLADO! contra quien la tiene falla y el acusador paga
  diego.coins = 80;
  carlos.coins = 60;
  playerAction(g, carlos, { type: 'buy', item: 'coartada' }, out, true);
  assert.equal(carlos.inventory.coartada, 1);
  pillar(g, diego, carlos, out);
  assert.equal(carlos.inventory.coartada, 0, 'la coartada se consume');
  assert.equal(diego.coins, 60, 'el acusador paga la multa aunque hubiera misión');
  assert.equal(diego.stats.pilladoMisses, 1);

  // Apuestas: solo en la Gran Acusación, se cobran al instante, pagan x2 si aciertas
  g.phase = 'FINAL_ACCUSATION';
  g.vote = { kind: 'final', status: 'open', picks: 1, isPublic: false, voters: ps.map((p) => p.id), ballots: {}, weights: {}, tally: null, suspects: [], bets: {} };
  assert.throws(() => playerAction(g, ana, { type: 'bet', targetId: ana.id, amount: 10 }, out, true), /otra persona/);
  playerAction(g, ana, { type: 'bet', targetId: laura.id, amount: 40 }, out, true);
  assert.equal(ana.coins, 200 - SHOP_PRICES.espejo - SHOP_PRICES.altavoz - 40);
  assert.throws(() => playerAction(g, ana, { type: 'bet', targetId: carlos.id, amount: 10 }, out, true), /Ya has apostado/);
  playerAction(g, carlos, { type: 'bet', targetId: ana.id, amount: 20 }, out, true); // apuesta a una inocente → pierde
  const carlosCoins = carlos.coins;

  advance(g, out); // entra en FINALE y resuelve apuestas
  assert.equal(g.phase, 'FINALE');
  const myBet = g.finale!.bets.find((b) => b.playerId === ana.id)!;
  assert.equal(myBet.won, true, 'apostar por un Cuco gana');
  assert.equal(ana.coins, 200 - SHOP_PRICES.espejo - SHOP_PRICES.altavoz - 40 + 40 * BET_PAYOUT, 'cobra el doble de lo apostado');
  assert.equal(g.finale!.bets.find((b) => b.playerId === carlos.id)!.won, false);
  assert.equal(carlos.coins, carlosCoins, 'la apuesta perdida no devuelve nada');
});

test('notas, parejas, saboteador, mercado negro e interrogatorio', () => {
  const settings: GameSettings = { durationMin: 60, difficulty: 'normal', mode: 'clasico', expectedPlayers: 6, hostPlays: true };
  const g: Game = createGame('TEST4', settings);
  const ps = ['Ana', 'Carlos', 'Diego', 'Laura', 'Marcos', 'Marta'].map((n) => addPlayer(g, n, '🐓'));
  const [ana, carlos, diego] = ps;
  const out = newOutbox();
  g.roundIndex = 1;
  g.phase = 'INVESTIGATION';

  // Nota bajo la puerta: el destinatario la recibe con formato de nota, sin remitente
  ana.coins = 50;
  playerAction(g, ana, { type: 'buy', item: 'nota', targetId: carlos.id, text: 'Nos vemos en la cocina' }, out, true);
  const nota = g.clues.find((c) => c.recipientId === carlos.id && c.source === 'nota')!;
  assert.match(nota.text, /bajo tu puerta/);
  assert.match(nota.text, /Nos vemos en la cocina/);
  assert.ok(!nota.text.includes('Ana'), 'la nota no delata al autor');
  assert.equal(nota.truth, 'ambiguous');
  assert.throws(() => playerAction(g, ana, { type: 'buy', item: 'nota', targetId: ana.id, text: 'x' }, out, true), /puerta de quién/);
  assert.throws(() => playerAction(g, ana, { type: 'buy', item: 'nota', targetId: carlos.id, text: '   ' }, out, true), /en blanco/);

  // Misión en pareja: los dos la reciben y saben quién es el cómplice
  dealCoupleMission(g, out, true);
  const couple = g.missions.filter((m) => m.missionId.startsWith('couple:'));
  assert.equal(couple.length, 2, 'dos cómplices');
  assert.equal(couple[0].partnerId, couple[1].playerId);
  assert.equal(couple[1].partnerId, couple[0].playerId);
  assert.equal(couple[0].text, couple[1].text, 'misma misión para ambos');

  // Saboteador: orden secreta que paga solo si la prueba falla
  assignSaboteurMission(g, diego, 'La cuerda humana', out);
  const sab = g.missions.find((m) => m.tags.includes('saboteador'))!;
  assert.equal(sab.playerId, diego.id);
  resolveSaboteur(g, false, out); // la prueba fracasa → cobra
  assert.equal(sab.status, 'completed');
  assignSaboteurMission(g, ana, 'Otra prueba', out);
  const sab2 = g.missions.filter((m) => m.tags.includes('saboteador'))[1];
  resolveSaboteur(g, true, out); // la prueba se supera → no cobra
  assert.equal(sab2.status, 'discarded');

  // La orden oscura no se reclama ni se descarta: cobra sola si el equipo falla.
  // Reclamarla era dinero gratis sin sabotear nada.
  assignSaboteurMission(g, carlos, 'La tercera', out);
  const sab3 = g.missions.filter((m) => m.tags.includes('saboteador'))[2];
  assert.throws(() => playerAction(g, carlos, { type: 'claimMission', missionId: sab3.id }, out, true), /se resuelve/);
  assert.throws(() => playerAction(g, carlos, { type: 'discardMission', missionId: sab3.id }, out, true), /no se descarta/);
  assert.equal(sab3.status, 'active', 'sigue viva esperando el resultado de la prueba');

  // Mercado negro: los objetos de la lista salen con descuento
  g.market = ['espejo'];
  assert.equal(priceOf(g, 'espejo'), Math.floor(80 * MARKET_DISCOUNT));
  assert.equal(priceOf(g, 'pista'), 40, 'lo que no está en el mercado sigue a su precio');

  // Interrogatorio: 3 preguntas y se arbitra como prueba de sala
  const c = setupChallenge(g, 'c58', out);
  assert.equal(c.interro!.questions.length, 3);
  assert.equal(c.status, 'briefing');
});

test('piloto automático: la casa avanza sola y escribe su crónica', () => {
  const settings: GameSettings = { durationMin: 60, difficulty: 'normal', mode: 'clasico', expectedPlayers: 4, hostPlays: true, autopilot: true };
  const g: Game = createGame('TEST5', settings);
  const ps = ['Ana', 'Carlos', 'Diego', 'Laura'].map((n) => addPlayer(g, n, '🐓'));
  const out = newOutbox();
  let now = Date.now();

  startGame(g, out);
  assert.equal(g.phase, 'ROLE_REVEAL');
  assert.equal(g.phaseEndsAt, null, 'sin piloto armado aún');

  // El tick arma la cuenta atrás narrativa; caduca → avanza sola
  assert.ok(tick(g, out, now));
  assert.ok(g.phaseEndsAt! > now, 'el piloto arma ROLE_REVEAL');
  // Si todos están listos antes, arranca igual que siempre
  for (const p of ps) p.connected = true;
  for (const p of ps) playerAction(g, p, { type: 'ready' }, out, true);
  assert.equal(g.phase, 'ROUND_INTRO');

  now = Date.now();
  assert.ok(tick(g, out, now));
  assert.ok(g.phaseEndsAt, 'la intro tiene cuenta atrás');
  assert.equal(tick(g, out, now + 2_000), false, 'todavía no toca');
  assert.ok(tick(g, out, now + AUTO_DELAY_SEC.roundIntro * 1000 + 1));
  assert.equal(g.phase, 'CHALLENGE', 'la casa entra en la prueba sola');
  assert.equal(g.challenge!.status, 'briefing');

  now = Date.now();
  tick(g, out, now);
  tick(g, out, now + AUTO_DELAY_SEC.briefing * 1000 + 1);
  assert.equal(g.challenge!.status, 'running', 'la prueba arranca tras leer las instrucciones');

  // Apagar el piloto suelta el volante: se limpia el timer narrativo y nada se rearma
  g.phase = 'ROUND_RESULT';
  g.phaseEndsAt = null;
  assert.ok(tick(g, out, now), 'se arma el timer del resumen');
  assert.ok(g.phaseEndsAt);
  hostAction(g, { type: 'autopilot', on: false }, out, true);
  assert.equal(g.phaseEndsAt, null, 'al apagar el piloto se suelta la cuenta atrás');
  assert.equal(tick(g, out, now + AUTO_DELAY_SEC.roundResult * 1000 + 1), false, 'ya no avanza sola');

  // Al encenderlo vuelve a armarse en el siguiente tick
  hostAction(g, { type: 'autopilot', on: true }, out, true);
  assert.ok(tick(g, out, now));
  assert.ok(g.phaseEndsAt);

  // La Gran Acusación caduca → la ceremonia empieza sola
  g.roundIndex = g.plan.length - 1;
  advance(g, out); // ROUND_RESULT → FINAL_ACCUSATION
  assert.equal(g.phase, 'FINAL_ACCUSATION');
  tick(g, out, now + 200 * 1000);
  assert.equal(g.phase, 'FINALE', 'la casa abre la ceremonia sola al agotarse la acusación');

  // La ceremonia avanza sola hasta el último paso (cada paso: un tick arma, otro dispara)
  for (let i = 0; i < 30 && g.finaleStep < g.finale!.totalSteps - 1; i++) {
    now = g.phaseEndsAt ?? Date.now();
    tick(g, out, now + 1);
  }
  assert.equal(g.finaleStep, g.finale!.totalSteps - 1, 'la crónica es el último paso y ahí para');
  tick(g, out, Date.now() + 1000);
  assert.equal(g.phaseEndsAt, null, 'en el último paso la casa no arma nada más');

  // La crónica relata la noche
  assert.ok(g.finale!.chronicle.length >= 3);
  assert.match(g.finale!.chronicle[0], /casa TEST5/);
  assert.ok(g.finale!.chronicle.some((l) => l.includes('La balanza quedó')));
  assert.ok(g.finale!.chronicle.some((l) => l.startsWith('Ronda 1')));
});

test('predicción a ciegas, reacciones, notario y misiones del grupo', () => {
  const settings: GameSettings = {
    durationMin: 60,
    difficulty: 'normal',
    mode: 'clasico',
    expectedPlayers: 6,
    hostPlays: true,
    customMissions: ['haz que {A} saque el tema del viaje a Benidorm', 'convence a {A} de que la casa está encantada'],
  };
  const g: Game = createGame('TEST6', settings);
  const ps = ['Ana', 'Carlos', 'Diego', 'Laura', 'Marcos', 'Marta'].map((n) => addPlayer(g, n, '🐓'));
  const [ana, carlos, diego, laura, marcos] = ps;
  laura.roleId = 'cuco_falsificador';
  diego.roleId = 'notario';
  for (const p of ps) p.roleId ??= 'curioso';
  const out = newOutbox();
  g.roundIndex = 0;

  // ---- Misiones del grupo: el pool custom se mezcla y acaba saliendo
  // (peso x3; cada reparto descarta las activas para seguir probando el pool)
  g.phase = 'ROUND_INTRO';
  let tries = 0;
  while (!g.missions.some((m) => m.missionId.startsWith('custom:')) && tries++ < 200) {
    dealMissions(g, out);
    for (const p of ps) for (const m of g.missions.filter((x) => x.playerId === p.id && x.status === 'active' && !x.missionId.startsWith('custom:'))) discardMission(g, p, m.id);
  }
  const custom = g.missions.filter((m) => m.missionId.startsWith('custom:'));
  assert.ok(custom.length >= 1, 'una misión del grupo acaba repartida');
  assert.ok(custom.every((m) => /Benidorm|encantada/.test(m.text)), 'el texto del anfitrión llega intacto');
  assert.ok(!custom[0].text.includes('{A}'), 'los placeholders se resuelven a nombres reales');

  // Otra casa no hereda las misiones del grupo
  const g2 = createGame('TEST6B', { ...settings, customMissions: undefined });
  for (const n of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']) addPlayer(g2, n, '🐓');
  for (const p of g2.players) p.roleId = 'vecino';
  g2.roundIndex = 0;
  for (let i = 0; i < 30; i++) dealMissions(g2, newOutbox());
  assert.ok(!g2.missions.some((m) => m.missionId.startsWith('custom:')), 'sin contaminación entre partidas');

  // ---- Predicción a ciegas: solo ronda 1 temprano, una vez, secreta, paga al final
  assert.throws(() => playerAction(g, diego, { type: 'predict', targetId: diego.id }, out, true), /otra persona/);
  playerAction(g, ana, { type: 'predict', targetId: laura.id }, out, true); // Laura es Cuco → acierta
  assert.equal(g.predictions[ana.id], laura.id);
  assert.throws(() => playerAction(g, ana, { type: 'predict', targetId: carlos.id }, out, true), /primera impresión/i);
  playerAction(g, carlos, { type: 'predict', targetId: ana.id }, out, true); // Ana no es Cuco → falla

  g.phase = 'INVESTIGATION';
  assert.throws(() => playerAction(g, marcos, { type: 'predict', targetId: laura.id }, out, true), /empezar la noche/i, 'fuera de plazo');

  // ---- Reacciones a la TV: whitelist, fase y cooldown
  playerAction(g, ana, { type: 'react', emoji: '🔪' }, out, true);
  assert.deepEqual(out.reactions.at(-1), { playerId: ana.id, emoji: '🔪' });
  assert.throws(() => playerAction(g, ana, { type: 'react', emoji: '🦄' }, out, true), /bandeja/i);
  assert.throws(() => playerAction(g, ana, { type: 'react', emoji: '😂' }, out, true), /Respira/);
  ana.lastReactAt = 0;
  playerAction(g, ana, { type: 'react', emoji: '😂' }, out, true);
  g.phase = 'RITUAL';
  ana.lastReactAt = 0;
  assert.throws(() => playerAction(g, ana, { type: 'react', emoji: '😂' }, out, true), /Ahora no/i, 'el Ritual es sagrado');

  // ---- El Notario: certifica notas, una vez por partida
  g.phase = 'INVESTIGATION';
  ana.coins = 60;
  playerAction(g, ana, { type: 'buy', item: 'nota', targetId: diego.id, text: 'Te creo inocente' }, out, true);
  playerAction(g, laura, { type: 'ability', targets: [diego.id, carlos.id] }, out, true); // nota falsa a Diego señalando a Carlos
  const notas = g.clues.filter((c) => c.recipientId === diego.id && c.source === 'nota');
  assert.equal(notas.length, 2, 'Diego tiene una nota auténtica y una falsificada');
  const falsa = notas.find((c) => c.forgedBy)!;

  // Marcos no es notario: no puede certificar nada
  assert.throws(() => playerAction(g, marcos, { type: 'certify', clueId: falsa.id }, out, true), /sello/i);
  // Diego no puede certificar una nota que no es suya
  const ajena = g.clues.find((c) => c.recipientId !== diego.id && c.source === 'nota');
  if (ajena) assert.throws(() => playerAction(g, diego, { type: 'certify', clueId: ajena.id }, out, true));

  playerAction(g, diego, { type: 'certify', clueId: falsa.id }, out, true);
  assert.ok(falsa.certified);
  const sello = g.clues.filter((c) => c.recipientId === diego.id && c.source === 'revelado').at(-1)!;
  assert.match(sello.text, /FALSIFICACIÓN/);
  assert.ok(!sello.text.includes('Laura'), 'el sello no delata al falsificador');
  assert.throws(() => playerAction(g, diego, { type: 'certify', clueId: notas.find((c) => !c.forgedBy)!.id }, out, true), /una vez/i, 'una sola certificación por noche');

  // ---- La predicción se cobra y se revela en la ceremonia
  g.roundIndex = g.plan.length - 1;
  g.phase = 'FINAL_ACCUSATION';
  g.vote = { kind: 'final', status: 'open', picks: 1, isPublic: false, voters: ps.map((p) => p.id), ballots: {}, weights: {}, tally: null, suspects: [], bets: {} };
  const antes = ana.coins;
  advance(g, out);
  assert.equal(g.phase, 'FINALE');
  const pred = g.finale!.predictions.find((x) => x.playerId === ana.id)!;
  assert.equal(pred.targetId, laura.id);
  assert.equal(pred.hit, true, 'oler a un Cuco desde el minuto 1 acierta');
  assert.equal(g.finale!.predictions.find((x) => x.playerId === carlos.id)!.hit, false);
  assert.ok(ana.coins > antes, 'la predicción paga su recompensa');
});

test('el anfitrión edita, quita y añade contenido solo para su casa', () => {
  const interroBase = content.interro.map((_, i) => `interro:${i}`);
  const missionId = content.missions[0].id;
  const challengeId = content.challenges[0].id;
  const interroId = content.challenges.find((c) => c.kind === 'interrogatorio')!.id;
  const settings: GameSettings = {
    durationMin: 60,
    difficulty: 'normal',
    mode: 'clasico',
    expectedPlayers: 6,
    hostPlays: true,
    contentMod: {
      disabled: [...interroBase, missionId],
      edits: { [`${challengeId}:title`]: 'EL TÍTULO NUEVO', 'social:0': '¿Quién es más probable que sea un robot?' },
      extraInterro: ['¿Quién se comió las croquetas del armario?'],
    },
  };
  const g = createGame('TEST7', settings);
  for (const n of ['Ana', 'Carlos', 'Diego', 'Laura', 'Marcos', 'Marta']) addPlayer(g, n, '🐓');
  const out = newOutbox();
  g.roundIndex = 0;
  g.phase = 'CHALLENGE';

  const gc = gameContent(g);
  assert.deepEqual(gc.interro, ['¿Quién se comió las croquetas del armario?'], 'quedan solo las preguntas del anfitrión');
  assert.equal(gc.social[0], '¿Quién es más probable que sea un robot?', 'edición de una pregunta plana');
  assert.ok(!gc.missions.some((m) => m.id === missionId), 'misión desactivada fuera del pool');
  assert.equal(gc.challengeById.get(challengeId)!.title, 'EL TÍTULO NUEVO', 'título de prueba reescrito');
  assert.equal(challengeById.get(challengeId)!.title, content.challenges[0].title, 'el catálogo global no se contamina');

  // El interrogatorio de esta casa solo pregunta lo del anfitrión
  const c = setupChallenge(g, interroId, out);
  assert.deepEqual(c.interro!.questions, ['¿Quién se comió las croquetas del armario?']);

  // Una prueba desactivada nunca entra en el plan
  const plan = buildPlan(settings, 6, { ...gc, challenges: gc.challenges.filter((d) => d.id !== challengeId) });
  assert.ok(!plan.some((r) => r.challengeId === challengeId));

  // Y una casa sin retoques ve el catálogo intacto
  const g2 = createGame('TEST7B', { ...settings, contentMod: undefined });
  assert.equal(gameContent(g2).interro.length, content.interro.length);
});

test('buscavidas, carta del condenado y misión relámpago', () => {
  const settings: GameSettings = { durationMin: 60, difficulty: 'normal', mode: 'clasico', expectedPlayers: 6, hostPlays: true };
  const g: Game = createGame('TEST8', settings);
  const ps = ['Ana', 'Carlos', 'Diego', 'Laura', 'Marcos', 'Marta'].map((n) => addPlayer(g, n, '🐓'));
  const [ana, carlos, diego, , marcos] = ps;
  ps[3].roleId = 'cuco_falsificador';
  diego.roleId = 'buscavidas';
  for (const p of ps) p.roleId ??= 'curioso';
  g.cucoCount = 1;
  g.plan = buildPlan(settings, 6);
  g.roundIndex = 0;
  g.phase = 'ROUND_INTRO';
  const out = newOutbox();

  // ---- Misión relámpago: todos reciben una misión cronometrada
  applyEvent(g, 'e53', out);
  const bolt = g.missions.filter((m) => m.expiresAt);
  assert.equal(new Set(bolt.map((m) => m.playerId)).size, 6, 'una misión relámpago por jugador');
  assert.ok(bolt.every((m) => m.status === 'active'));
  // Ana cumple la suya a tiempo; al caer el plazo el resto se apaga
  const mia = bolt.find((m) => m.playerId === ana.id)!;
  const before = ana.coins;
  playerAction(g, ana, { type: 'claimMission', missionId: mia.id }, out, true);
  assert.ok(ana.coins > before, 'cumplirla a tiempo paga');
  tick(g, out, Date.now() + 95_000);
  assert.equal(bolt.find((m) => m.playerId === carlos.id)!.status, 'discarded', 'la que nadie cumplió se apaga');
  assert.equal(bolt.find((m) => m.playerId === ana.id)!.status, 'completed', 'la cumplida sobrevive al plazo');
  assert.ok(g.announcements.some((a) => a.text.includes('relámpago')), 'la casa se entera de que se apagó');

  // ---- La carta del condenado: solo el sospechoso, una vez, anónima
  g.suspects = [diego.id];
  g.suspectRound = g.roundIndex;
  assert.throws(() => playerAction(g, marcos, { type: 'letter', text: 'fui yo' }, out, true), /ninguna carta/i, 'solo el condenado escribe');
  playerAction(g, diego, { type: 'letter', text: 'No he sido. Mirad a quien calla.' }, out, true);
  assert.throws(() => playerAction(g, diego, { type: 'letter', text: 'otra' }, out, true), /Ya dejaste tu carta/);

  // Al abrir la siguiente ronda, la casa la lee en voz alta sin remite
  g.phase = 'ROUND_RESULT';
  advance(g, out);
  assert.equal(g.roundIndex, 1);
  assert.equal(g.letters.length, 0, 'la carta ya se leyó');
  const leida = g.announcements.find((a) => a.text.includes('carta anónima'));
  assert.ok(leida?.text.includes('Mirad a quien calla'), 'se lee en la intro de la ronda');
  assert.ok(!leida!.text.includes('Diego'), 'anónima: no delata al autor');

  // ---- El Buscavidas: top 3 en monedas ganadas a pulso
  diego.coins = 300;
  ana.coins = 250;
  carlos.coins = 200;
  for (const p of ps.filter((x) => ![diego.id, ana.id, carlos.id].includes(x.id))) p.coins = 10;
  const f1 = computeFinale(g);
  assert.equal(f1.buscavidasWon, diego.id, 'tercero más rico: dentro');
  diego.coins = 5; // ahora está el último
  const f2 = computeFinale(g);
  assert.equal(f2.buscavidasWon, null, 'fuera del top 3: no gana');
});

test('doble o nada: una jugada por ronda y la casa lo ve todo', () => {
  const g: Game = createGame('TEST9', { durationMin: 60, difficulty: 'normal', mode: 'clasico', expectedPlayers: 6, hostPlays: true });
  const [ana] = ['Ana', 'Carlos', 'Diego', 'Laura', 'Marcos', 'Marta'].map((n) => addPlayer(g, n, '🐓'));
  g.roundIndex = 0;
  g.phase = 'INVESTIGATION';
  const out = newOutbox();

  ana.coins = 50;
  assert.throws(() => playerAction(g, ana, { type: 'coinflip', amount: 5 }, out, true), /mínima/i);
  assert.throws(() => playerAction(g, ana, { type: 'coinflip', amount: 999 }, out, true), /tantas monedas/i);
  playerAction(g, ana, { type: 'coinflip', amount: 40 }, out, true);
  assert.ok([10, 90].includes(ana.coins), `la moneda decide: quedan ${ana.coins} (era 50 ± 40)`);
  assert.throws(() => playerAction(g, ana, { type: 'coinflip', amount: 10 }, out, true), /esta ronda/i, 'una jugada por ronda');
  assert.ok(g.announcements.some((a) => a.text.includes('doble o nada')), 'la casa ve el resultado');
});

test('rachas y sequías: la casa premia la racha y compadece la sequía', () => {
  const g: Game = createGame('TESTA', { durationMin: 60, difficulty: 'normal', mode: 'clasico', expectedPlayers: 6, hostPlays: true });
  const [ana, carlos] = ['Ana', 'Carlos', 'Diego', 'Laura', 'Marcos', 'Marta'].map((n) => addPlayer(g, n, '🐓'));
  startGame(g, newOutbox());
  const out = newOutbox();

  // ---- Racha: 3 misiones cumplidas sin que te pillen → bonus público
  g.phase = 'INVESTIGATION';
  g.roundIndex = 0;
  for (let i = 0; i < 3; i++) {
    g.missions.push({ id: `m${i}`, missionId: 'm001', playerId: ana.id, text: 'x', difficulty: 'facil', category: 'x', reward: 20, targets: [], tags: [], status: 'active', assignedRound: g.roundIndex, resolvedAt: null });
    playerAction(g, ana, { type: 'claimMission', missionId: `m${i}` }, out, true);
  }
  assert.equal(ana.streak, 3);
  assert.ok(g.announcements.some((a) => a.text.includes('racha') || a.text.includes('🔥')), 'la racha es pública — le pintan una diana');

  // Si le pillan con una misión sobre ti… no: si le queman una misión, se corta
  const burnable = { id: 'm9', missionId: 'm001', playerId: ana.id, text: 'x', difficulty: 'facil' as const, category: 'x', reward: 20, targets: [carlos.id], tags: [] as string[], status: 'active' as const, assignedRound: g.roundIndex, resolvedAt: null };
  g.missions.push(burnable);
  pillar(g, carlos, ana, out);
  assert.equal(ana.streak, 0, 'que te pillen te rompe la racha');

  // ---- Sequía: dos rondas sin ganar nada → limosna de la casa
  // Sin eventos aleatorios: un regalo de la casa movería lastEarnRound y el test sería flaky
  g.used.events.push(...gameContent(g).events.map((e) => e.id));
  carlos.lastEarnRound = 0; // ganó en la ronda 1
  ana.lastEarnRound = -1; // nunca ha ganado
  g.phase = 'ROUND_RESULT';
  advance(g, out); // entra la ronda 2
  assert.ok(!g.announcements.some((a) => a.text.includes(carlos.name) && a.text.includes('apiada')), 'Carlos ganó en la ronda anterior: sin limosna');
  g.phase = 'ROUND_RESULT';
  advance(g, out); // entra la ronda 3
  assert.ok(g.announcements.some((a) => a.text.includes(ana.name) && a.text.includes('apiada')), 'Ana lleva dos rondas en blanco: la casa se apiada');
  assert.ok(ana.coins >= 15, 'la limosna llega al bolsillo');
});

test('subasta ciega: pujas selladas, solo paga el ganador y nadie sabe quién', () => {
  const g: Game = createGame('TESTB', { durationMin: 60, difficulty: 'normal', mode: 'clasico', expectedPlayers: 6, hostPlays: true });
  const [ana, carlos] = ['Ana', 'Carlos', 'Diego', 'Laura', 'Marcos', 'Marta'].map((n) => addPlayer(g, n, '🐓'));
  startGame(g, newOutbox());
  const out = newOutbox();
  g.phase = 'INVESTIGATION';
  g.roundIndex = 1;

  ana.coins = 100;
  carlos.coins = 100;
  applyEvent(g, 'e54', out);
  assert.ok(g.auction, 'la subasta queda abierta');

  assert.throws(() => playerAction(g, ana, { type: 'bid', amount: 5 }, out, true), /mínima/i);
  playerAction(g, ana, { type: 'bid', amount: 30 }, out, true);
  playerAction(g, carlos, { type: 'bid', amount: 70 }, out, true);
  assert.equal(ana.coins, 100, 'pujar no cobra: solo paga el ganador');

  tick(g, out, g.auction!.endsAt + 1);
  assert.equal(g.auction, null, 'la subasta se cierra sola al caer el plazo');
  assert.equal(carlos.coins, 30, 'el ganador paga su puja');
  assert.equal(ana.coins, 100, 'el resto no paga nada');
  const pista = g.clues.find((c) => c.recipientId === carlos.id);
  assert.ok(pista && pista.truth === 'true', 'el ganador se lleva una pista cierta');
  const anuncio = g.announcements.find((a) => a.text.includes('sobre del casero') && a.text.includes('70'));
  assert.ok(anuncio && !anuncio.text.includes('Carlos'), 'el precio es público; el comprador, jamás');
});

test('herencia, chivato, voto lastrado y sobremesa', () => {
  const settings: GameSettings = { durationMin: 60, difficulty: 'normal', mode: 'clasico', expectedPlayers: 6, hostPlays: true };
  const g: Game = createGame('TESTC', settings);
  const ps = ['Ana', 'Carlos', 'Diego', 'Laura', 'Marcos', 'Marta'].map((n) => addPlayer(g, n, '🐓'));
  const [ana, carlos, diego] = ps;
  for (const p of ps) p.roleId = 'vecino';
  const out = newOutbox();
  g.roundIndex = 2;
  g.phase = 'INVESTIGATION';

  // ---- La herencia: el más rico cede el 25% al más pobre
  ana.coins = 200;
  carlos.coins = 10;
  diego.coins = 60;
  applyEvent(g, 'e55', out);
  assert.equal(ana.coins, 150, 'el más rico suelta el 25%');
  assert.equal(carlos.coins, 60, 'el más pobre lo hereda');
  assert.equal(diego.coins, 60, 'la clase media ni la tocan');
  assert.ok(g.announcements.some((a) => a.text.includes('Ana') && a.text.includes('Carlos')), 'la herencia es pública');

  // ---- El chivato: uno sabe la verdad, otro sabe quién la sabe
  const cluesBefore = g.clues.length;
  applyEvent(g, 'e56', out);
  const nuevas = g.clues.slice(cluesBefore);
  assert.equal(nuevas.length, 2, 'una pista al informado y otra al testigo');
  assert.ok(nuevas.every((c) => c.truth === 'true'), 'el chivato no miente');
  const testigo = nuevas.find((c) => c.source === 'chisme')!;
  const informado = nuevas.find((c) => c.source === 'nota')!;
  assert.match(testigo.text, /susurrarle algo a/, 'el testigo ve el susurro');
  assert.ok(testigo.recipientId !== informado.recipientId, 'nadie sabe las dos mitades');

  // ---- Voto lastrado: el condenado anterior vota doble
  g.condemned = [ana.id]; // Ana quedó bajo sospecha en el juicio anterior
  applyEvent(g, 'e57', out);
  g.phase = 'VOTING';
  g.vote = { kind: 'juicio', status: 'open', picks: 1, isPublic: false, voters: ps.map((p) => p.id), ballots: {}, weights: {}, tally: null, suspects: [], bets: {} };
  for (const p of ps) playerAction(g, p, { type: 'vote', targets: [p.id === ana.id ? carlos.id : p.id === diego.id ? carlos.id : diego.id] }, out, true);
  assert.equal(g.vote.status, 'revealed', 'el juicio se cierra solo');
  assert.equal(g.vote.weights[ana.id], 2, 'el condenado vota con rabia doble');
  assert.equal(g.vote.weights[carlos.id] ?? 1, 1, 'los demás votan normal');
  const carlosTally = g.vote.tally!.find((t) => t.id === carlos.id)!;
  assert.equal(carlosTally.votes, 3, 'el lastre pesa en el recuento (Ana×2 + Diego)');

  // Sin evento: nadie pesa doble
  g.flags.ladenVote = false;
  g.vote = { kind: 'juicio', status: 'open', picks: 1, isPublic: false, voters: ps.map((p) => p.id), ballots: {}, weights: {}, tally: null, suspects: [], bets: {} };
  playerAction(g, ana, { type: 'vote', targets: [carlos.id] }, out, true);
  assert.equal(g.vote.weights[ana.id] ?? 1, 1, 'sin evento no hay lastre');

  // ---- El lastre se aplica al contar, no al emitir: el evento puede caer a mitad de votación
  g.condemned = [ana.id];
  g.flags.ladenVote = false;
  g.vote = { kind: 'juicio', status: 'open', picks: 1, isPublic: false, voters: ps.map((p) => p.id), ballots: {}, weights: {}, tally: null, suspects: [], bets: {} };
  playerAction(g, ana, { type: 'vote', targets: [diego.id] }, out, true); // vota ANTES del evento
  applyEvent(g, 'e57', out); // el director lanza el evento con la urna abierta
  for (const p of ps) if (p.id !== ana.id) playerAction(g, p, { type: 'vote', targets: [p.id === diego.id ? carlos.id : diego.id] }, out, true);
  assert.equal(g.vote.status, 'revealed');
  assert.equal(g.vote.weights[ana.id], 2, 'el lastre alcanza al voto ya emitido');
  assert.equal(g.flags.ladenVote, false, 'el lastre se consume al cerrar el juicio');

  // ---- Lastrado + voto_doble se apilan a ×3
  g.condemned = [ana.id];
  ana.inventory.voto_doble = 1;
  applyEvent(g, 'e57', out);
  g.vote = { kind: 'juicio', status: 'open', picks: 1, isPublic: false, voters: ps.map((p) => p.id), ballots: {}, weights: {}, tally: null, suspects: [], bets: {} };
  for (const p of ps) playerAction(g, p, { type: 'vote', targets: [p.id === ana.id || p.id === diego.id ? carlos.id : diego.id] }, out, true);
  assert.equal(g.vote.weights[ana.id], 3, 'lastrado + voto doble = triple peso');
  ana.inventory.voto_doble = 0;

  // ---- La sobremesa: ni ¡PILLADO! ni casino durante la tregua
  g.phase = 'INVESTIGATION';
  applyEvent(g, 'e58', out);
  assert.ok(g.truceUntil > Date.now(), 'la tregua corre');
  assert.throws(() => playerAction(g, ana, { type: 'pillar', targetId: carlos.id }, out, true), /sobremesa/i);
  assert.throws(() => playerAction(g, ana, { type: 'coinflip', amount: 20 }, out, true), /sobremesa|casino/i);
  g.truceUntil = 0; // la campana suena: se acabó la paz
  playerAction(g, ana, { type: 'coinflip', amount: 10 }, out, true);
  assert.ok([140, 160].includes(ana.coins), 'acabada la tregua el casino reabre');
});

test('padrino, casera y ermitaño: lazos, libros y silencio', () => {
  const settings: GameSettings = { durationMin: 60, difficulty: 'normal', mode: 'clasico', expectedPlayers: 6, hostPlays: true };
  const g: Game = createGame('TESTD', settings);
  const ps = ['Ana', 'Carlos', 'Diego', 'Laura', 'Marcos', 'Marta'].map((n) => addPlayer(g, n, '🐓'));
  const [ana, carlos, diego, laura, marcos] = ps;
  ana.roleId = 'padrino';
  carlos.roleId = 'cuco_falsificador';
  diego.roleId = 'casera';
  laura.roleId = 'ermitano';
  marcos.roleId = 'vecino';
  ps[5].roleId = 'curioso';
  g.cucoCount = 1;
  g.roundIndex = 1;
  g.phase = 'INVESTIGATION';
  const out = newOutbox();

  // ---- El Padrino apadrina en secreto, una vez
  assert.throws(() => playerAction(g, ana, { type: 'ability', targets: [ana.id] }, out, true), /ti mismo/i);
  playerAction(g, ana, { type: 'ability', targets: [carlos.id] }, out, true); // apadrina al Cuco
  assert.equal(ana.ahijadoId, carlos.id);
  assert.throws(() => playerAction(g, ana, { type: 'ability', targets: [marcos.id] }, out, true), /gastado/i, 'una sola bendición por noche');

  // ---- La Casera anota cada compra de la Despensa
  marcos.coins = 100;
  const antes = g.clues.filter((c) => c.recipientId === diego.id && c.source === 'chisme').length;
  playerAction(g, marcos, { type: 'buy', item: 'candado' }, out, true);
  const apunte = g.clues.filter((c) => c.recipientId === diego.id && c.source === 'chisme').at(-1);
  assert.equal(g.clues.filter((c) => c.recipientId === diego.id && c.source === 'chisme').length, antes + 1);
  assert.match(apunte!.text, /Marcos.*Candado/i, 'el libro dice quién y qué');
  // La Casera no recibe apunte de sus propias compras
  diego.coins = 100;
  playerAction(g, diego, { type: 'buy', item: 'candado' }, out, true);
  assert.ok(!g.clues.some((c) => c.recipientId === diego.id && c.text.includes('Diego pagó')), 'su propia compra no se anota');

  // ---- El Padrino no puede esperar a saber quién es el Cuco
  ana.roleId = 'padrino';
  ana.ability = { roundIndex: 0, inRound: 0, total: 0 };
  ana.ahijadoId = undefined;
  g.roundIndex = 3;
  assert.throws(() => playerAction(g, ana, { type: 'ability', targets: [marcos.id] }, out, true), /primeras rondas/i, 'apadrinar tarde sería hacer trampa');
  g.roundIndex = 1;
  playerAction(g, ana, { type: 'ability', targets: [carlos.id] }, out, true);

  // ---- El Ermitaño y su voto de silencio
  g.phase = 'VOTING';
  g.vote = { kind: 'juicio', status: 'open', picks: 1, isPublic: false, voters: ps.map((p) => p.id), ballots: {}, weights: {}, tally: null, suspects: [], bets: {} };
  for (const p of ps) if (p.id !== laura.id) playerAction(g, p, { type: 'vote', targets: [p.id === marcos.id ? carlos.id : marcos.id] }, out, true);
  // Si se cerrase sin ella, toda la casa sabría que Laura es la Ermitaña (huésped confirmada)
  assert.equal(g.vote.status, 'open', 'el juicio espera a la Ermitaña como a cualquiera: no la delata');
  assert.equal(laura.stats.votesCast, 0, 'no ha votado');
  advance(g, out); // el temporizador (o el director) cierra el juicio
  assert.equal(g.vote.status, 'revealed');

  // Si vota, pierde el voto de silencio
  const f1 = computeFinale(g);
  assert.equal(f1.ermitanoWon, laura.id, 'silencio cumplido: cobra');
  laura.stats.votesCast = 1;
  const f2 = computeFinale(g);
  assert.equal(f2.ermitanoWon, null, 'un solo voto rompe el voto de silencio');
  laura.stats.votesCast = 0;

  // ---- El Padrino cobra si su ahijado es Cuco impune
  g.vote = { kind: 'final', status: 'revealed', picks: 1, isPublic: false, voters: [], ballots: {}, weights: {}, tally: [], suspects: [], bets: {} };
  const f3 = computeFinale(g);
  assert.equal(f3.padrinoWon, ana.id, 'apadrinó al Cuco que nadie desenmascaró');
  // Si el ahijado fuera desenmascarado, el Padrino se queda sin nada
  g.vote.ballots = { [diego.id]: [carlos.id], [laura.id]: [carlos.id], [marcos.id]: [carlos.id] };
  const f4 = computeFinale(g);
  assert.equal(f4.padrinoWon, null, 'el ahijado desenmascarado no paga');

  // ---- Abandonar no es salir impune ni guardar silencio
  g.vote.ballots = {};
  carlos.left = true;
  const f5 = computeFinale(g);
  assert.equal(f5.padrinoWon, null, 'un ahijado que abandonó no es un Cuco impune');
  carlos.left = false;
  laura.left = true; // la Ermitaña se fue sin votar
  const f6 = computeFinale(g);
  assert.equal(f6.ermitanoWon, null, 'irse de la casa no cuenta como silencio');
  laura.left = false;
});

test('misión de corro: tres cómplices, misma tarea', () => {
  const g: Game = createGame('TESTE', { durationMin: 60, difficulty: 'normal', mode: 'clasico', expectedPlayers: 8, hostPlays: true });
  const ps = ['Ana', 'Carlos', 'Diego', 'Laura', 'Marcos', 'Marta', 'Pablo', 'Sara'].map((n) => addPlayer(g, n, '🐓'));
  for (const p of ps) p.roleId = 'vecino';
  const out = newOutbox();
  g.roundIndex = 1;

  dealCorroMission(g, out, true);
  const corro = g.missions.filter((m) => m.missionId.startsWith('corro:'));
  assert.equal(corro.length, 3, 'tres cómplices reciben la misión');
  assert.equal(new Set(corro.map((m) => m.missionId)).size, 1, 'misma misión');
  assert.ok(corro.every((m) => m.text === corro[0].text));
  for (const m of corro) {
    assert.equal(m.partners!.length, 2, 'cada uno conoce a sus dos cómplices');
    assert.deepEqual(new Set([m.playerId, ...m.partners!]), new Set(corro.map((x) => x.playerId)), 'el corro se cierra entre los tres');
  }
});

test('el apagón: la TV se apaga 30 segundos y vuelve sola', () => {
  const g: Game = createGame('TESTF', { durationMin: 60, difficulty: 'normal', mode: 'clasico', expectedPlayers: 6, hostPlays: true });
  for (const n of ['Ana', 'Carlos', 'Diego', 'Laura', 'Marcos', 'Marta']) addPlayer(g, n, '🐓');
  const out = newOutbox();
  g.roundIndex = 1;
  g.phase = 'INVESTIGATION';

  applyEvent(g, 'e59', out);
  assert.ok(g.event, 'el evento queda activo');
  assert.ok(g.event!.endsAt! > Date.now(), 'es un evento cronometrado');
  assert.ok(g.event!.endsAt! <= Date.now() + 31_000, 'dura lo que dice el contenido (30s)');
  assert.equal(gameContent(g).eventById.get('e59')!.effect.type, 'blackout', 'la TV lo reconoce como apagón');

  // Pasada la media hora... perdón, los 30 segundos, la casa vuelve sola
  tick(g, out, g.event!.endsAt! + 1);
  assert.equal(g.event!.endsAt, null, 'el apagón se acaba sin que nadie toque nada');
  assert.equal(g.phase, 'INVESTIGATION', 'el juego nunca se detuvo — solo la pantalla');
});

test('estamos listos: la espera salta cuando lo confirma todo el mundo', () => {
  const g: Game = createGame('TESTG', { durationMin: 60, difficulty: 'normal', mode: 'clasico', expectedPlayers: 6, hostPlays: true });
  const ps = ['Ana', 'Carlos', 'Diego', 'Laura', 'Marcos', 'Marta'].map((n) => addPlayer(g, n, '🐓'));
  const [ana, carlos, diego, laura, marcos, marta] = ps;
  for (const p of ps) { p.roleId = 'vecino'; p.connected = true; }
  const out = newOutbox();
  g.plan = buildPlan({ durationMin: 60, difficulty: 'normal', mode: 'clasico', expectedPlayers: 6, hostPlays: true }, 6);
  g.roundIndex = 0;
  g.phase = 'ROUND_INTRO';

  // Uno que falta frena a todos: la unanimidad es de verdad
  assert.ok(readyUp(g), 'la intro de ronda es una espera confirmable');
  for (const p of ps.slice(0, 5)) playerAction(g, p, { type: 'ready' }, out, true);
  assert.equal(g.phase, 'ROUND_INTRO', 'con una silla sin confirmar la casa espera');
  assert.equal(readyUp(g)!.count, 5);

  playerAction(g, marta, { type: 'ready' }, out, true);
  assert.equal(g.phase, 'CHALLENGE', 'todos listos → la espera salta sola');

  // Las marcas son por momento: las de la intro no valen para el briefing
  assert.equal(g.challenge!.status, 'briefing');
  assert.equal(readyUp(g)!.count, 0, 'cada espera pide su propia confirmación');

  // briefing → running: mismo salto colectivo
  for (const p of ps) playerAction(g, p, { type: 'ready' }, out, true);
  assert.equal(g.challenge!.status, 'running', 'nadie espera al director para empezar a jugar');

  // Durante el juego real no hay botón: las pruebas tienen su propio cierre
  assert.equal(readyUp(g), null);
  assert.throws(() => playerAction(g, ana, { type: 'ready' }, out, true), /nada que confirmar/i);

  // El juicio abierto exige votos, no confirmaciones — el "listos" no lo esquiva
  g.challenge = null;
  g.phase = 'VOTING';
  g.vote = { kind: 'juicio', status: 'open', picks: 1, isPublic: false, voters: ps.map((p) => p.id), ballots: {}, weights: {}, tally: null, suspects: [], bets: {} };
  assert.throws(() => playerAction(g, ana, { type: 'ready' }, out, true), /nada que confirmar/i, 'la votación no se salta: hay que votar');

  // Votación revelada → espera al director otra vez. Marcos se cae: no cuenta
  // para el quórum, pero Marta (conectada y sin pulsar) sí retiene a la casa.
  g.vote.status = 'revealed';
  marcos.connected = false;
  for (const p of ps) if (p.id !== marta.id && p.id !== marcos.id) playerAction(g, p, { type: 'ready' }, out, true);
  assert.equal(g.phase, 'VOTING', 'Marta sigue ahí sin confirmar: la casa espera');
  assert.equal(readyUp(g)!.total, 5, 'Marcos caído no cuenta en el total');
  playerAction(g, marta, { type: 'ready' }, out, true);
  assert.equal(g.phase, 'ROUND_RESULT', 'con Marta ya es unanimidad entre los presentes');

  // En el resumen de la ronda, quien se va desbloquea la unanimidad
  g.roundIndex = 1;
  g.phase = 'ROUND_RESULT';
  for (const p of ps) p.connected = true;
  for (const p of ps.slice(0, 5)) playerAction(g, p, { type: 'ready' }, out, true);
  assert.equal(g.phase, 'ROUND_RESULT', 'Marta aún no ha pulsado');
  leavePlayer(g, marta, out);
  assert.ok(marta.left);
  assert.equal(g.phase, 'ROUND_INTRO', 'al marcharse, la casa ya estaba lista y avanza sola');
  assert.equal(g.roundIndex, 2);

  // Una desconexión repentina también reevalúa: Laura conectada sin pulsar
  // retiene la espera; al caérsele el móvil, los presentes ya eran unanimidad.
  g.phase = 'ROUND_RESULT';
  for (const p of ps) if (![laura.id, marta.id].includes(p.id)) playerAction(g, p, { type: 'ready' }, out, true);
  assert.equal(g.phase, 'ROUND_RESULT', 'Laura conectada sin pulsar retiene la espera');
  laura.connected = false;
  onPlayerOffline(g, out);
  assert.equal(g.phase, 'ROUND_INTRO', 'al caer Laura, los presentes ya habían dicho que sí');
});

test('tiempo muerto: el reloj de la casa se congela también por dentro', () => {
  const g: Game = createGame('TESTH', { durationMin: 60, difficulty: 'normal', mode: 'clasico', expectedPlayers: 6, hostPlays: true });
  const ps = ['Ana', 'Carlos', 'Diego', 'Laura', 'Marcos', 'Marta'].map((n) => addPlayer(g, n, '🐓'));
  const [ana, carlos] = ps;
  for (const p of ps) p.roleId = 'vecino';
  const out = newOutbox();
  g.roundIndex = 1;
  g.phase = 'INVESTIGATION';
  g.phaseEndsAt = Date.now() + 120_000;
  g.truceUntil = Date.now() + 60_000; // sobremesa en marcha
  applyEvent(g, 'e54', out); // subasta abierta
  ana.coins = 100;
  g.missions.push({
    id: 'm1', missionId: 'x', playerId: ana.id, text: 'relámpago', difficulty: 'facil',
    category: 'movil', reward: 10, targets: [], tags: [], status: 'active', assignedRound: 1, resolvedAt: null,
    expiresAt: Date.now() + 30_000,
  });

  hostAction(g, { type: 'pause' }, out, true);
  assert.ok(g.pausedRemainingMs !== null, 'la casa queda en pausa');

  // Simulamos que el tiempo muerto dura una eternidad: los plazos quedan VENCIDOS
  // en el reloj de pared pero con margen en el reloj congelado de la casa.
  g.pausedAt = Date.now() - 10_000;
  g.truceUntil = g.pausedAt + 5_000;
  g.auction!.endsAt = g.pausedAt + 5_000;
  g.missions[0].expiresAt = g.pausedAt + 5_000;

  playerAction(g, ana, { type: 'bid', amount: 40 }, out, true);
  assert.equal(g.auction!.bids[ana.id].amount, 40, 'la subasta congelada sigue aceptando pujas');
  assert.throws(() => playerAction(g, carlos, { type: 'pillar', targetId: ana.id }, out, true), /sobremesa/i, 'la tregua no expira en la pausa');
  playerAction(g, ana, { type: 'claimMission', missionId: 'm1' }, out, true);
  assert.equal(g.missions[0].status, 'completed', 'la relámpago no se apaga durante el tiempo muerto');
  assert.equal(tick(g, out, Date.now() + 999_999_999), false, 'el barrido no ejecuta nada en pausa');
});

test('tiempo muerto sin temporizador de fase: se puede pausar igualmente', () => {
  const g: Game = createGame('TESTL', { durationMin: 60, difficulty: 'normal', mode: 'clasico', expectedPlayers: 6, hostPlays: true });
  const ps = ['Ana', 'Carlos', 'Diego', 'Laura', 'Marcos', 'Marta'].map((n) => addPlayer(g, n, '🐓'));
  for (const p of ps) p.roleId = 'vecino';
  ps[0].connected = true; // alguien despierto que aún no ha confirmado: no hay unanimidad
  const out = newOutbox();
  // Fase narrativa sin piloto: no hay phaseEndsAt, pero sí plazos internos vivos
  g.roundIndex = 1;
  g.phase = 'ROUND_INTRO';
  g.phaseEndsAt = null;
  g.settings.autopilot = false;
  applyEvent(g, 'e54', out); // subasta abierta
  const auctionEnd = g.auction!.endsAt;

  hostAction(g, { type: 'pause' }, out, true);
  assert.ok(g.pausedAt !== null, 'la casa queda en pausa aunque no haya timer de fase');
  assert.equal(g.pausedRemainingMs, null, 'no hay timer de fase que guardar');

  // La eternidad no consume la subasta
  g.pausedAt = Date.now() - 600_000;
  assert.equal(tick(g, out, Date.now() + 999_999_999), false, 'el barrido no ejecuta nada en pausa');

  hostAction(g, { type: 'resume' }, out, true);
  assert.equal(g.pausedAt, null);
  assert.equal(g.phaseEndsAt, null, 'una pausa sin timer no crea un temporizador fantasma');
  assert.ok(g.auction!.endsAt > auctionEnd, 'la subasta recupera el tiempo congelado');
});

test('la Gran Acusación es input real: el "estamos listos" no la salta', () => {
  const g: Game = createGame('TESTI', { durationMin: 60, difficulty: 'normal', mode: 'clasico', expectedPlayers: 6, hostPlays: true });
  const ps = ['Ana', 'Carlos', 'Diego', 'Laura', 'Marcos', 'Marta'].map((n) => addPlayer(g, n, '🐓'));
  const ana = ps[0];
  for (const p of ps) { p.roleId = 'vecino'; p.connected = true; }
  const out = newOutbox();
  g.phase = 'FINAL_ACCUSATION';
  g.vote = { kind: 'final', status: 'open', picks: 2, isPublic: false, voters: ps.map((p) => p.id), ballots: {}, weights: {}, tally: null, suspects: [], bets: {} };

  assert.equal(readyUp(g), null, 'no hay espera que confirmar: hay que acusar y apostar');
  assert.throws(() => playerAction(g, ana, { type: 'ready' }, out, true), /nada que confirmar/i);
  for (const p of ps) assert.throws(() => playerAction(g, p, { type: 'ready' }, out, true), /nada que confirmar/i);
  assert.equal(g.phase, 'FINAL_ACCUSATION', 'la unanimidad no puede saltarse la Gran Acusación');
});

test('relevo: el móvil nuevo no hereda el "estoy listo" del móvil muerto', () => {
  const g: Game = createGame('TESTJ', { durationMin: 60, difficulty: 'normal', mode: 'clasico', expectedPlayers: 6, hostPlays: true });
  const ps = ['Ana', 'Carlos', 'Diego', 'Laura', 'Marcos', 'Marta'].map((n) => addPlayer(g, n, '🐓'));
  const [ana, , , , marcos] = ps;
  for (const p of ps) { p.roleId = 'vecino'; p.connected = true; }
  const out = newOutbox();
  g.plan = buildPlan({ durationMin: 60, difficulty: 'normal', mode: 'clasico', expectedPlayers: 6, hostPlays: true }, 6);
  g.roundIndex = 0;
  g.phase = 'ROUND_INTRO';

  // Marcos y Ana confirman, Marta no → la espera sigue abierta
  playerAction(g, marcos, { type: 'ready' }, out, true);
  playerAction(g, ana, { type: 'ready' }, out, true);
  const key = g.players.find((p) => p.id === marcos.id)!.readyFor;
  assert.ok(key, 'Marcos había confirmado la espera');
  assert.equal(g.phase, 'ROUND_INTRO');

  // Marcos se cae y otro móvil toma el relevo pasada la gracia
  marcos.connected = false;
  marcos.lastSeen = Date.now() - TAKEOVER_GRACE_MS - 1;
  const relief = takeOverPlayer(g, marcos.id, out);
  assert.equal(relief.readyFor, null, 'el relevo no hereda una confirmación que no pulsó');
  assert.equal(relief.ready, false);

  // El relevo se conecta y confirma por sí mismo: ahora sí cuenta
  relief.connected = true;
  assert.equal(readyUp(g)!.count, 1, 'solo Ana sigue confirmada');
});

test('snapshot en pausa: al restaurar, los plazos internos no nacen caducados', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'casa-snap-'));
  try {
    const store = new GameStore({ snapshotDir: dir });
    const g: Game = createGame('TESTK', { durationMin: 60, difficulty: 'normal', mode: 'clasico', expectedPlayers: 6, hostPlays: true });
    for (const n of ['Ana', 'Carlos', 'Diego', 'Laura', 'Marcos', 'Marta']) addPlayer(g, n, '🐓');
    const out = newOutbox();
    g.roundIndex = 1;
    g.phase = 'INVESTIGATION';
    g.phaseEndsAt = Date.now() + 120_000;
    hostAction(g, { type: 'pause' }, out, true);
    assert.ok(g.pausedRemainingMs !== null);

    // El servidor estuvo caído una hora: todos los plazos están vencidos en pared,
    // pero en el momento de congelarse les quedaba margen.
    g.pausedAt = Date.now() - 3_600_000;
    g.event = { id: 'e59', title: 'El apagón', endsAt: g.pausedAt + 30_000 } as Game['event'];
    g.truceUntil = g.pausedAt + 45_000;
    g.missions.push({
      id: 'm1', missionId: 'x', playerId: g.players[0].id, text: 'relámpago', difficulty: 'facil',
      category: 'movil', reward: 10, targets: [], tags: [], status: 'active', assignedRound: 1, resolvedAt: null,
      expiresAt: g.pausedAt + 20_000,
    });
    store.add(g);
    await store.flush();

    // La casa revive en otro proceso
    const revived = new GameStore({ snapshotDir: dir });
    await revived.init();
    const r = revived.get(g.code)!;
    const now = Date.now();
    assert.equal(r.pausedRemainingMs, null, 'la pausa no sobrevive al reinicio');
    assert.ok(r.phaseEndsAt !== null && r.phaseEndsAt > now, 'el temporizador de fase recupera su margen');
    assert.ok(r.event!.endsAt! > now, 'el apagón revive con su cuenta atrás intacta');
    assert.ok(r.truceUntil > now, 'la sobremesa no muere durante el apagón del servidor');
    assert.ok(r.missions[0].expiresAt! > now, 'la misión relámpago no nace caducada');
    assert.ok(r.players.every((p) => !p.connected), 'nadie queda conectado tras un reinicio');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('incompatibilidades de jugabilidad: roles, misiones, eventos y final', () => {
  const settings: GameSettings = { durationMin: 60, difficulty: 'normal', mode: 'clasico', expectedPlayers: 6, hostPlays: true };
  const out = newOutbox();

  // ---- Turbo de 30 min: no hay juicios, así que ni Fotógrafa ni Ermitaño
  assert.ok(buildPlan({ ...settings, durationMin: 30 }, 12).every((r) => !r.hasJudgment), 'el turbo no tiene juicios');
  for (let i = 0; i < 40; i++) {
    const roles = roleDistribution(12, false);
    assert.ok(!roles.includes('fotografa') && !roles.includes('ermitano'), 'sin juicios no salen oficios de juicio');
  }
  const turbo = createGame('TESTT', { ...settings, durationMin: 30 });
  ['Ana', 'Carlos', 'Diego', 'Laura', 'Marcos', 'Marta'].forEach((n) => addPlayer(turbo, n, '🐓'));
  startGame(turbo, out);
  assert.ok(turbo.players.every((p) => p.roleId !== 'fotografa' && p.roleId !== 'ermitano'));
  turbo.phase = 'INVESTIGATION';
  turbo.roundIndex = 0;
  turbo.players[0].coins = 500;
  assert.throws(() => playerAction(turbo, turbo.players[0], { type: 'buy', item: 'voto_doble' }, out, true), /ningún juicio/, 'no se vende un voto doble que nunca se usará');

  // ---- Misiones según rol y horizonte
  const g: Game = createGame('TESTI', settings);
  const ps = ['Ana', 'Carlos', 'Diego', 'Laura', 'Marcos', 'Marta'].map((n) => addPlayer(g, n, '🐓'));
  const [ana, carlos, diego, laura] = ps;
  ana.roleId = 'insomne';
  carlos.roleId = 'cuco_falsificador';
  diego.roleId = 'cuco_carterista';
  laura.roleId = 'ermitano';
  for (const p of ps) p.roleId ??= 'vecino';
  g.cucoCount = 2;
  g.plan = buildPlan(settings, 6);
  g.roundIndex = 1;
  g.phase = 'ROUND_INTRO';

  // El Ermitaño nunca recibe misiones que le obliguen a votar
  for (let i = 0; i < 60; i++) {
    g.missions = [];
    g.used.missions = [];
    dealMissions(g, out);
    assert.ok(g.missions.filter((m) => m.playerId === laura.id).every((m) => !m.tags.includes('votes_self')), 'nada de votar para el Ermitaño');
  }

  // «Los Cucos traman algo» no le chiva al Insomne quiénes son los Cucos
  g.missions = [];
  const before = g.clues.filter((c) => c.recipientId === ana.id).length;
  applyEvent(g, 'e22', out);
  assert.ok(g.missions.some((m) => m.playerId === carlos.id), 'los Cucos reciben su misión');
  assert.equal(g.clues.filter((c) => c.recipientId === ana.id).length, before, 'el Insomne no oye a los Cucos');

  // Misión relámpago: solo misiones cumplibles en 90 segundos
  for (let i = 0; i < 20; i++) {
    g.missions = [];
    g.used.missions = [];
    g.used.events = [];
    applyEvent(g, 'e53', out);
    const bolts = g.missions.filter((m) => m.expiresAt);
    assert.ok(bolts.every((m) => !m.tags.some((t) => ['needs_judgment', 'needs_ritual', 'needs_challenge'].includes(t))), 'nada de «el próximo juicio» con 90 segundos');
  }

  // Última ronda ya jugada: nada de «la próxima prueba» ni «el próximo Ritual»
  g.roundIndex = g.plan.length - 1;
  g.phase = 'INVESTIGATION';
  for (let i = 0; i < 40; i++) {
    g.missions = [];
    g.used.missions = [];
    dealMissions(g, out);
    assert.ok(g.missions.every((m) => !m.tags.includes('needs_challenge') && !m.tags.includes('needs_ritual')), 'sin rondas por delante no hay misiones de prueba futura');
  }

  // ---- Final: un Cuco que abandona no regala puntos a su bando
  g.phase = 'FINAL_ACCUSATION';
  g.vote = { kind: 'final', status: 'open', picks: 2, isPublic: false, voters: ps.map((p) => p.id), ballots: {}, weights: {}, tally: null, suspects: [], bets: {} };
  g.velas = 2;
  g.grietas = 2;
  diego.left = true;
  const f1 = computeFinale(g);
  assert.equal(f1.balance.cucos, 2 + 2, 'solo el Cuco que sigue en la casa cuenta como impune');
  diego.left = false;

  // «Más de la mitad de la casa»: dos acusaciones en una casa de seis no desenmascaran
  g.vote.ballots = { [ana.id]: [carlos.id], [laura.id]: [carlos.id] };
  assert.deepEqual(computeFinale(g).unmasked, [], 'dos de seis no es mayoría de la casa');
  g.vote.ballots = { [ana.id]: [carlos.id], [laura.id]: [carlos.id], [ps[4].id]: [carlos.id], [ps[5].id]: [carlos.id] };
  assert.deepEqual(computeFinale(g).unmasked, [carlos.id], 'cuatro de seis sí');

  // ---- Quiz: quien abandona no hunde al equipo con sus respuestas en blanco
  g.phase = 'CHALLENGE';
  diego.left = false;
  const quizDef = content.challenges.find((d) => d.kind === 'quiz' && d.participants === 'all')!;
  const c = setupChallenge(g, quizDef.id, out);
  g.challenge = c;
  c.status = 'running';
  const qs = c.quiz!.questionIds.map((id) => gameContent(g).quizById.get(id)!);
  const right = qs.map((q) => q.answer);
  const quitters = c.participants.slice(0, Math.ceil(c.participants.length / 2));
  for (const id of quitters) getPlayer(g, id).left = true;
  for (const id of c.participants.filter((x) => !quitters.includes(x))) c.quiz!.answers[id] = right;
  finalizeChallenge(g, out);
  assert.equal(c.passed, true, 'los que siguen acertaron todo: superada');
});
