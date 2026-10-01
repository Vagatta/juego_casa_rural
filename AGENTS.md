# La Casa Rural

Party game presencial para 6–12 jugadores. Los móviles son controladores con información privada; el juego ocurre en la habitación. Monolito modular: Express + Socket.IO + React/Vite, todo en TypeScript estricto.

## Comandos

- `npm run dev` — servidor (tsx watch, puerto 3001) + Vite (5173, proxy a 3001). Script Windows-compatible en `scripts/dev.mjs`.
- `npm run dev:server` / `npm run dev:client` — por separado.
- `npm run build` — build del cliente a `dist/client` (el servidor lo sirve en producción).
- `npm start` — producción local: tsx sobre `src/server/index.ts`, `PORT` (def. 3001).
- `npm run typecheck` — `tsc --noEmit` (obligatorio tras tocar TS).
- `npm test` — `tsx --test tests/*.test.ts`: partidas completas simuladas con 6/7/8/9/10/12 jugadores, auditoría de fugas de secretos, desconexión/reconexión, abandono, caída del director, modo sofá, sobre lacrado, relevo de jugador caído y revancha.
- `node scripts/genicons.mjs` — regenera los PNG de la PWA (`public/icon-*.png`) desde la misma composición que `icon.svg`.

## Estructura

- `content/*.json` — contenido modular (roles, misiones, pruebas, eventos, quiz, palabras, `suspect.json` = tareas forzadas del sospechoso). Editable sin tocar lógica.
- `src/shared/` — `types.ts` (solo vistas públicas/proyecciones) y `constants.ts`.
- `src/server/` — `app.ts` (REST + estáticos), `sockets.ts` (auth por token, rate limit), `views.ts` (proyecciones por audiencia), `store.ts` (memoria + snapshot), `engine/` (máquina de estados, roles, misiones, pruebas, pistas, eventos, final).
- `src/client/` — React. `lib/` (router hash-history mínimo, sesiones en localStorage, red socket+REST, sonido Web Audio sintetizado), `components/` (ui, cards, privacy), `screens/` (Home, Create, Join, HowTo, Player, phases, tabs, HostControls, Director, Finale), `styles/` (base, components, screens).
- `tests/` — harness de simulación con clientes Socket.IO reales (`rateLimit: 10_000` en tests).
- `docs/` — diseño y arquitectura. `db/schema.sql` — esquema SQL futuro (la persistencia actual es snapshot en memoria).

## Reglas importantes

- **Nunca** enviar secretos a clientes que no deben verlos: toda información pasa por `views.ts` (proyección por audiencia/jugador). El cliente nunca recibe roles ni pistas ajenos, ni ocultos.
- El token del director viaja en el hash de la URL (`/director/CODE#t=...`), nunca en query ni cuerpo.
- Acciones del servidor: `player:action` / `host:action` con ack `{ok, error}`. Payloads validados con zod.
- Relevo (`takeOverPlayer`): solo si el jugador está ausente (`left` o desconectado más de `TAKEOVER_GRACE_MS`); rota el token para que el móvil viejo quede fuera. `GET /api/games/:code` expone `absentPlayers` solo con id/nombre/avatar.
- Revancha (`rematchGame`): solo en el último paso de FINALE; crea una casa nueva en LOBBY conservando id/nombre/avatar/color, y emite `rematch` a los sockets conectados (el cliente se muda solo). `rematchTo` queda en la casa vieja para que los que lleguen tarde sigan el rastro.
- Espectador: `/ver/CODE` con token literal `spectator` → `audience: 'player'` + `playerId: null` (vista pública, sin `me`). Sigue la revancha.
- Apuestas: `bet` solo en FINAL_ACCUSATION con voto abierto, una por jugador, se cobra al instante, paga `BET_PAYOUT`× al acertar Cuco; `vote.bets` es interno — la vista solo expone `betsCount` + `myBet`; el detalle sale en `finale.bets`.
- Cuaderno: `note` guarda `p.notes` (500 chars) en el servidor, proyectado solo en `me.notes`.
- CSS: variables y utilidades propias (`base.css`, `components.css`, `screens.css`). Fuentes: Big Shoulders Stencil (display), Figtree Variable (UI), Caveat (manuscrita). Fontsource se importa sin `.css` en el specifier (`@fontsource/pkg/700`) por su `exports` map.
- Animación solo con transform/opacity; respeta `prefers-reduced-motion`; móvil vertical desde 320px.
