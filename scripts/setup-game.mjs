// Monta una partida en marcha y dispara reacciones ~20s. Uso: node scripts/setup-game.mjs [port]
import { io } from 'socket.io-client';

const port = process.argv[2] ?? '3002';
const base = `http://localhost:${port}`;
const post = (path, body) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const ack = (s, ev, a) => s.timeout(5000).emitWithAck(ev, a).catch((e) => ({ ok: false, error: String(e) }));
const AV = [0x1f413, 0x1f989, 0x1f410, 0x1f344, 0x1f377, 0x1f9c0, 0x1fa93, 0x1f98a, 0x1f330].map((c) => String.fromCodePoint(c));
const REACT = ['🔪', '😂', '👀', '😱', '🤨', '👏', '🤫', '💀'];

const created = await post('/api/games', {
  settings: { durationMin: 60, difficulty: 'normal', mode: 'clasico', expectedPlayers: 5, hostPlays: true, autopilot: false },
  host: { name: 'Ana', avatar: AV[0] },
});
const code = created.code;
console.log('CODE=' + code);

const sockets = [];
for (const [i, name] of ['Bruno', 'Carla', 'Diego', 'Elena'].entries()) {
  const j = await post(`/api/games/${code}/join`, { name, avatar: AV[i + 1] });
  if (j.error) { console.log('join FAIL', name, j.error); process.exit(1); }
  console.log('PTOKEN_' + name + '=' + j.playerToken);
  const s = io(base, { auth: { code, token: j.playerToken }, transports: ['websocket'] });
  await new Promise((res, rej) => { s.on('connect', res); s.on('connect_error', rej); });
  sockets.push(s);
}
const host = io(base, { auth: { code, token: created.hostToken }, transports: ['websocket'] });
await new Promise((res, rej) => { host.on('connect', res); host.on('connect_error', rej); });

console.log('start:', await ack(host, 'host:action', { type: 'start' }));
for (const s of [...sockets, host]) console.log('ready:', await ack(s, 'player:action', { type: 'ready' }));
console.log('advance:', await ack(host, 'host:action', { type: 'advance' }));
console.log('advance:', await ack(host, 'host:action', { type: 'advance' }));

console.log('reactions-start');
for (let i = 0; i < 120; i++) {
  const r = await ack(sockets[i % sockets.length], 'player:action', { type: 'react', emoji: REACT[i % REACT.length] });
  if (i === 0 || !r.ok) console.log(REACT[i % REACT.length], r);
  await new Promise((r2) => setTimeout(r2, 900));
}
console.log('reactions-done');
process.exit(0);
