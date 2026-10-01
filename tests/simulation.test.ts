import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createApp } from '../src/server/app.ts';
import { TAKEOVER_GRACE_MS } from '../src/shared/constants.ts';
import { auditLeaks, Bot, createSim, sleep } from './harness.ts';

function assertFinished(sim: Awaited<ReturnType<typeof createSim>>) {
  const g = sim.game();
  assert.equal(g.phase, 'FINALE');
  assert.ok(g.finale, 'hay ceremonia final');
  assert.equal(g.finale!.ranking.length, g.players.length);
  assert.ok(g.finale!.awards.length >= 3, 'se reparten premios');
  assert.ok(g.finale!.funStats.length >= 2, 'hay estadísticas divertidas');
  assert.equal(g.velas + g.grietas <= g.plan.length, true);
  // Toda la casa ve la revelación final con todos los roles
  for (const bot of sim.bots.filter((b) => !b.view?.me?.left)) {
    assert.equal(bot.view?.phase, 'FINALE', `${bot.name} llega al final`);
    assert.equal(bot.view?.finale?.reveal.length, g.players.length);
  }
  const leaks = auditLeaks(sim);
  assert.deepEqual(leaks, [], 'sin fugas de información secreta');
}

describe('partidas completas por número de jugadores', { concurrency: false }, () => {
  for (const players of [6, 7, 8, 9, 10, 12]) {
    test(`${players} jugadores`, { timeout: 90_000 }, async () => {
      const sim = await createSim({ players, settings: { durationMin: players === 9 ? 90 : 60 } });
      try {
        await sim.run();
        assertFinished(sim);
        const g = sim.game();
        const expectedCucos = players <= 10 ? 2 : 3;
        assert.equal(g.cucoCount, expectedCucos);
        assert.equal(g.players.some((p) => p.roleId === 'turista'), players >= 10);
      } finally {
        await sim.close();
      }
    });
  }
});

describe('incidencias', { concurrency: false }, () => {
  test('desconexión, reconexión y refrescar página conservan identidad', { timeout: 90_000 }, async () => {
    const sim = await createSim({
      players: 9,
      onRound: async (round, s) => {
        if (round === 1) {
          const bot = s.bots[3];
          const roleBefore = bot.view?.me?.role?.id;
          bot.disconnect();
          await sleep(40);
          assert.equal(s.game().players.find((p) => p.token === bot.token)?.connected, false, 'se marca desconectado');
          await bot.connect(); // equivalente a refrescar: nuevo socket, mismo token
          await sleep(40);
          assert.equal(bot.view?.me?.role?.id, roleBefore, 'mismo rol tras reconectar');
          assert.equal(s.game().players.find((p) => p.token === bot.token)?.connected, true);
        }
      },
    });
    try {
      await sim.run();
      assertFinished(sim);
    } finally {
      await sim.close();
    }
  });

  test('jugador que abandona a mitad de partida', { timeout: 90_000 }, async () => {
    const sim = await createSim({
      players: 7,
      onRound: async (round, s) => {
        if (round === 1) {
          const ack = await s.bots[5].send({ type: 'leave' });
          assert.ok(ack.ok);
        }
      },
    });
    try {
      await sim.run();
      assertFinished(sim);
      const g = sim.game();
      assert.equal(g.players.filter((p) => p.left).length, 1);
      assert.equal(g.finale!.reveal.length, 7, 'el que se fue también aparece en la revelación');
    } finally {
      await sim.close();
    }
  });

  test('el anfitrión se cae y otro jugador reclama el mando', { timeout: 90_000 }, async () => {
    const sim = await createSim({
      players: 8,
      onRound: async (round, s) => {
        if (round === 1) await s.hostDropsAndPlayerClaims(s.bots[2]);
      },
    });
    try {
      await sim.run();
      assertFinished(sim);
      assert.equal(sim.game().hostPlayerId, sim.game().players.find((p) => p.token === sim.bots[2].token)?.id);
    } finally {
      await sim.close();
    }
  });

  test('reclamar el mando falla si el director sigue conectado', { timeout: 30_000 }, async () => {
    const sim = await createSim({ players: 6 });
    try {
      const ack = await sim.bots[1].send({ type: 'claimHost' });
      assert.equal(ack.ok, false);
      const hostAck = await sim.bots[1].host({ type: 'start' });
      assert.equal(hostAck.ok, false, 'un jugador normal no puede dar órdenes de director');
    } finally {
      await sim.close();
    }
  });

  test('no se puede unir nadie con la partida empezada, ni con nombre repetido', { timeout: 30_000 }, async () => {
    const sim = await createSim({ players: 6 });
    try {
      const dup = await sim.post(`/api/games/${sim.code}/join`, { name: 'carlos', avatar: '🐓' });
      assert.equal(dup.status, 409);
      await sim.director.host({ type: 'start' });
      const late = await sim.post(`/api/games/${sim.code}/join`, { name: 'Tardón', avatar: '🐓' });
      assert.equal(late.status, 409);
    } finally {
      await sim.close();
    }
  });

  test('modo sofá sin pruebas físicas y partida larga de 120 min', { timeout: 120_000 }, async () => {
    const sim = await createSim({ players: 9, settings: { mode: 'sofa', durationMin: 120 } });
    try {
      await sim.run(100_000);
      assertFinished(sim);
      assert.equal(sim.game().plan.length, 8);
    } finally {
      await sim.close();
    }
  });

  test('relevo: otro móvil toma el sitio de un jugador caído', { timeout: 90_000 }, async () => {
    const sim = await createSim({ players: 6 });
    try {
      await sim.director.host({ type: 'start' });
      await sleep(100);
      const g = sim.game();
      const bot = sim.bots[3];
      const player = g.players.find((p) => p.token === bot.token)!;
      const roleBefore = player.roleId;

      // Conectado: no se puede relevar
      let res = await sim.post(`/api/games/${sim.code}/join`, { takeId: player.id });
      assert.equal(res.status, 409);

      // Recién caído: periodo de gracia
      bot.disconnect();
      await sleep(50);
      res = await sim.post(`/api/games/${sim.code}/join`, { takeId: player.id });
      assert.equal(res.status, 409, 'gracia: acaba de caerse');

      // Ausente de verdad: el relevo entra
      player.lastSeen = Date.now() - TAKEOVER_GRACE_MS - 1;
      res = await sim.post(`/api/games/${sim.code}/join`, { takeId: player.id });
      assert.equal(res.status, 201);
      const relief = new Bot('Relevo', res.json.playerToken, sim.code, sim.base);
      relief.paused = true;
      await relief.connect();
      await sleep(50);
      assert.equal(relief.view?.me?.name, player.name, 'misma identidad');
      assert.equal(relief.view?.me?.role?.id, roleBefore, 'mismo rol y secretos');
      assert.equal(relief.view?.me?.coins, player.coins, 'mismas monedas');

      // El token viejo ya no abre la casa
      await assert.rejects(() => bot.connect(), /not_found/);
      relief.disconnect();
    } finally {
      await sim.close();
    }
  });

  test('un jugador expulsado o el que sigue dentro no admiten relevo', { timeout: 60_000 }, async () => {
    const sim = await createSim({ players: 6 });
    try {
      const kicked = sim.game().players.find((p) => p.token === sim.bots[2].token)!;
      await sim.director.host({ type: 'kick', playerId: kicked.id });
      const res = await sim.post(`/api/games/${sim.code}/join`, { takeId: kicked.id });
      assert.equal(res.status, 409);
    } finally {
      await sim.close();
    }
  });

  test('revancha: otra noche con la misma gente', { timeout: 120_000 }, async () => {
    const sim = await createSim({ players: 6 });
    try {
      await sim.run(100_000);
      const g = sim.game();
      assert.equal(g.phase, 'FINALE');
      const names = g.players.filter((p) => !p.left && !p.kicked).map((p) => p.name);

      // Antes del último paso de la ceremonia no se puede
      g.finaleStep = 0;
      const early = await sim.director.host({ type: 'rematch' });
      assert.equal(early.ok, false);
      g.finaleStep = g.finale!.totalSteps - 1;

      const ack = await sim.director.host({ type: 'rematch' });
      assert.ok(ack.ok, String(ack.error));
      const ng = sim.app.store.get(g.rematchTo!)!;
      assert.ok(ng, 'la casa nueva existe');
      assert.notEqual(ng.code, g.code);
      assert.equal(ng.phase, 'LOBBY');
      assert.deepEqual(ng.players.map((p) => p.name).sort(), names.sort());
      assert.ok(ng.players.every((p) => p.roleId === null && p.coins === 50), 'todo reseteado');

      // Todos los conectados reciben la mudanza con su token nuevo
      await sleep(100);
      for (const bot of sim.bots) {
        assert.equal(bot.rematch?.code, ng.code, `${bot.name} recibió el relevo de casa`);
        assert.ok(bot.rematch?.playerToken);
        const np = ng.players.find((p) => p.name === bot.name)!;
        assert.equal(bot.rematch?.playerToken, np.token);
      }
      assert.equal(sim.director.rematch?.hostToken, ng.hostToken);

      // El token nuevo entra en la casa nueva; el viejo sigue viendo la vieja
      const bot = sim.bots[1];
      const migrated = new Bot(bot.name, bot.rematch!.playerToken!, ng.code, sim.base);
      migrated.paused = true;
      await migrated.connect();
      assert.equal(migrated.view?.code, ng.code);
      migrated.disconnect();
    } finally {
      await sim.close();
    }
  });

  test('director que no juega: el sobre lacrado solo muestra roles tras abrirlo', { timeout: 60_000 }, async () => {
    const app = await createApp({ persist: false, rateLimit: 10_000 });
    const base = `http://localhost:${app.port}`;
    const post = (path: string, body: unknown) =>
      fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
    const created = await post('/api/games', { settings: { durationMin: 60, difficulty: 'normal', mode: 'clasico', expectedPlayers: 6, hostPlays: false } });
    assert.equal(created.playerToken, null);
    for (let i = 0; i < 6; i++) await post(`/api/games/${created.code}/join`, { name: `J${i}`, avatar: '🐓' });
    const director = new Bot('Director', created.hostToken, created.code, base);
    director.paused = true;
    await director.connect();
    try {
      assert.ok((await director.host({ type: 'start' })).ok);
      await sleep(50);
      assert.equal(director.view?.host?.secrets, null, 'sin abrir el sobre no hay secretos');
      assert.ok(director.view?.host?.sealAvailable);
      assert.ok((await director.host({ type: 'openSeal' })).ok);
      await sleep(50);
      const secrets = director.view?.host?.secrets as unknown[] | null | undefined;
      assert.equal(secrets?.length, 6);
    } finally {
      director.disconnect();
      await app.close();
    }
  });
});
