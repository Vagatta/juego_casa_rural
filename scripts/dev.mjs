// Arranca servidor (tsx watch) y cliente (vite) a la vez, en cualquier sistema operativo.
// Uso: npm run dev            → web en 5173, API en 3001
//      npm run dev -- 4321    → web en 4321 (el proxy sigue apuntando a la API)
//      PORT=4000 npm run dev  → API en 4000
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const arg = process.argv.find((a) => /^\d+$/.test(a));
const webPort = arg ? Number(arg) : Number(process.env.VITE_PORT ?? 5173);
const apiPort = Number(process.env.PORT ?? 3001);
const env = { ...process.env, PORT: String(apiPort) };
const root = resolve(import.meta.dirname, '..');
const win = process.platform === 'win32';

// Sin npm ni shell: menos capas = cierre más limpio
const children = [
  spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'watch', 'src/server/index.ts'], { cwd: root, stdio: 'inherit', env }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(webPort)], { cwd: root, stdio: 'inherit', env }),
];

const stop = () => {
  for (const c of children) {
    // Windows: kill() solo mata el proceso raíz y deja los hijos huérfanos con el puerto pillado
    if (win) spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
    else c.kill();
  }
};
process.on('SIGINT', () => { stop(); process.exit(0); });
process.on('SIGTERM', () => { stop(); process.exit(0); });
children.forEach((c) => c.on('exit', (code) => { if (code) { stop(); process.exit(code); } }));

console.log(`🛠️  dev: web http://localhost:${webPort} · API http://localhost:${apiPort}`);
