// Monta una partida de prueba lista para trastear: 5 bots + anfitriona jugando,
// roles repartidos y la casa en ROUND_INTRO. De ahí se conduce con el director.
// Uso: node scripts/test-game.mjs [port]
import { io } from 'socket.io-client';

const port = process.argv[2] ?? '3002';
const base = `http://localhost:${port}`;
const post = (path, body) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const ack = (s, ev, a) => s.timeout(5000).emitWithAck(ev, a).catch((e) => ({ ok: false, error: String(e) }));
const AV = [0x1f413, 0x1f989, 0x1f410, 0x1f344, 0x1f377, 0x1f9c0].map((c) => String.fromCodePoint(c));

const created = await post('/api/games', {
  settings: { durationMin: 60, difficulty: 'normal', mode: 'clasico', expectedPlayers: 6, hostPlays: true, autopilot: false },
  host: { name: 'Ana', avatar: AV[0] },
});
if (created.error) { console.log('create FAIL', created.error); process.exit(1); }
const code = created.code;
console.log('\n=== PARTIDA DE TEST ===');
console.log('código:   ' + code);
console.log('director: ' + base + '/#director/' + code + '?t=' + created.hostToken);
console.log('especta:  ' + base + '/#ver/' + code);

const bots = [];
for (const [i, name] of ['Bruno', 'Carla', 'Diego', 'Elena'].entries()) {
  const j = await post(`/api/games/${code}/join`, { name, avatar: AV[i + 1] });
  if (j.error) { console.log('join FAIL', name, j.error); process.exit(1); }
  const s = io(base, { auth: { code, token: j.playerToken }, transports: ['websocket'] });
  await new Promise((res, rej) => { s.on('connect', res); s.on('connect_error', rej); });
  bots.push({ name, token: j.playerToken, socket: s });
}
const host = io(base, { auth: { code, token: created.hostToken }, transports: ['websocket'] });
await new Promise((res, rej) => { host.on('connect', res); host.on('connect_error', rej); });
// La anfitriona también juega: sus player:action van con su playerToken
const ana = io(base, { auth: { code, token: created.playerToken }, transports: ['websocket'] });
await new Promise((res, rej) => { ana.on('connect', res); ana.on('connect_error', rej); });

console.log('start:', JSON.stringify(await ack(host, 'host:action', { type: 'start' })));
for (const b of bots) await ack(b.socket, 'player:action', { type: 'ready' });
console.log('ready:', JSON.stringify(await ack(ana, 'player:action', { type: 'ready' })));

console.log('\nAna (anfitriona, juega):', created.playerToken);
console.log('bots (para entrar como ellos, token):');
bots.forEach((b) => console.log(' ', b.name, b.token));
console.log('\nLa casa está en ROUND_INTRO. Desde el director: avanzar → prueba →');
console.log('marcar superada/fallada → ritual/investigación → tienda, doble o nada,');
console.log('eventos (e54 = subasta ciega), votaciones… Los bots no juegan solos.');
process.exit(0);
