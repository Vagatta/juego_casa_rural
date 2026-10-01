# LA CASA RURAL · Arquitectura (Fase 3)

## Decisión general

**Monolito modular, un único despliegue.** Un proceso Node.js sirve la SPA, la API REST y los WebSockets. Para 6-12 jugadores por partida y unas pocas partidas simultáneas no hay ninguna razón para separar servicios.

```
src/
  shared/        tipos y constantes compartidos cliente/servidor (sin lógica secreta)
  server/
    index.ts     Express + Socket.IO + estáticos
    content.ts   carga y valida content/*.json (zod)
    store.ts     partidas en memoria + snapshot (archivo o PostgreSQL)
    sockets.ts   autenticación por token, acciones, difusión de vistas
    views.ts     PROYECCIONES: lo único que sale del servidor
    engine/      reglas del juego (funciones puras sobre el estado)
  client/        React + Vite, CSS propio (sin framework CSS)
content/         contenido modular editable (misiones, pruebas, eventos...)
db/schema.sql    modelo relacional PostgreSQL (fase de producción)
tests/           simulaciones de partida completas vía sockets
```

## Frontend

- React 19 + Vite. Router mínimo propio (5 rutas). CSS con variables, sin Tailwind.
- El cliente es **tonto**: pinta la vista que le manda el servidor y envía intenciones (`action`). No calcula reglas.
- Reconexión: `{code, token}` en `localStorage`. Refrescar la página recupera la sesión.
- Reloj: cada vista incluye `serverNow`; el cliente calcula el desfase y pinta cuentas atrás a partir de `endsAt`.

## Backend

- Express 5 (REST) + Socket.IO 4 (tiempo real). `tsx` ejecuta TypeScript directamente.
- **Estado autoritativo en memoria** (una partida es un objeto JSON). Cada mutación incrementa `version` y programa un snapshot.
- Persistencia: `SNAPSHOT_DIR` (archivo JSON por partida) por defecto, o **PostgreSQL** si hay `DATABASE_URL` (tabla `game_snapshots`, JSONB). Al arrancar se restauran las partidas no terminadas.
- Un `tick` de 1 s gestiona temporizadores (auto-avance) y limpieza de partidas inactivas (>12 h).

### API REST

| Método | Ruta | Descripción |
| --- | --- | --- |
| `POST` | `/api/games` | Crea partida. Devuelve `code`, `hostToken` y, si el anfitrión juega, `playerToken`. |
| `GET` | `/api/games/:code` | Info pública mínima: existe, fase, nº jugadores, si admite entradas. |
| `POST` | `/api/games/:code/join` | Entra con nombre y avatar. Devuelve `playerToken`. |
| `GET` | `/api/health` | Salud. |

### WebSockets

Handshake: `auth: { code, token }`. El servidor resuelve si el token es de jugador o de director. Sin token válido, desconexión.

| Evento cliente → servidor | Payload |
| --- | --- |
| `player:action` | `{ type: 'ready' | 'challenge' | 'ritual' | 'vote' | 'buy' | 'ability' | 'claimMission' | 'discardMission' | 'pillar' | 'claimHost' | 'leave', ... }` |
| `host:action` | `{ type: 'start' | 'advance' | 'judge' | 'extend' | 'pause' | 'resume' | 'event' | 'adjustCoins' | 'kick' | 'end' | 'openSeal' }` |

| Evento servidor → cliente | Payload |
| --- | --- |
| `view` | La proyección completa para ese destinatario. |
| `toast` | Aviso puntual (privado o público). |
| `kicked` | Has sido expulsado. |

Todas las acciones usan `ack` con `{ ok, error? }`.

## Seguridad (regla de oro)

**El navegador solo recibe su proyección.** `views.ts` construye desde cero un objeto nuevo por destinatario, eligiendo campo a campo. Nunca se serializa el estado interno ni se "oculta" nada en el cliente.

- Jugador: su rol, sus misiones, sus pistas, sus compañeros Cucos (si es Cuco), sus respuestas. Del resto: nombre, avatar, color, monedas, conexión, "ha votado sí/no".
- Director: solo información pública + indicadores de progreso.
- En `FINALE` todo pasa a ser público.
- Tokens aleatorios de 128 bits (`crypto.randomBytes`), nunca incluidos en vistas ajenas.
- Validación de todas las acciones con zod + comprobación de fase, permisos y límites de uso.
- Test automático que recorre **todos** los mensajes recibidos por cada jugador y falla si aparece el rol de otro jugador antes del final.

## Máquina de estados

```
LOBBY
  │ start (≥4 jugadores)
ROLE_REVEAL ── todos "lo he entendido" o director avanza
  │
ROUND_INTRO (evento, misiones) ◄─────────────────────────┐
  │                                                      │
CHALLENGE  [briefing → running → judging|voting → done]  │
  │ ¿equipo y superada?                                  │
  ├─ sí ─► RITUAL [open → revealed]                      │
  ▼                                                      │
INVESTIGATION (temporizador)                             │
  │ ¿ronda con juicio?                                   │
  ├─ sí ─► VOTING [open → revealed]                      │
  ▼                                                      │
ROUND_RESULT ── quedan rondas ───────────────────────────┘
  │ última ronda
FINAL_ACCUSATION [open]
  │
FINALE [paso 0..8]
```

Cada fase tiene un sub-estado explícito y el servidor calcula la etiqueta del botón principal del director (`hostPrimary`), así que no hay estados ambiguos ni el cliente decide transiciones.

## Modelo de datos

El MVP guarda la partida como documento JSON (un objeto `Game`). `db/schema.sql` define el modelo relacional para cuando haga falta histórico, panel de administración o analítica:

| Entidad | Clave | Relaciones | Notas |
| --- | --- | --- | --- |
| `games` | `id uuid`, `code` único | 1-N players, rounds, votes, game_events | estado, fase, ajustes, velas, grietas |
| `players` | `id uuid` | N-1 game, N-1 role | `token_hash` (nunca el token), monedas, conexión |
| `roles` | `id text` | contenido | facción, habilidad, usos |
| `missions` | `id text` | contenido | tipo, dificultad, recompensa, facción, etiquetas |
| `player_missions` | `id uuid` | N-1 player, N-1 mission | estado, objetivos, textos resueltos |
| `rounds` | `(game_id, index)` | N-1 game | plan, prueba, evento, resultado |
| `challenges` | `id text` | contenido | tipo, participantes, duración |
| `clues` | `id uuid` | N-1 game, destinatario | fiabilidad (secreta), origen, autor |
| `events` | `id text` | contenido | efecto |
| `votes` | `id uuid` | N-1 game, votante, objetivo | tipo (juicio/final), peso |
| `inventory` | `(player_id, item)` | N-1 player | cantidad |
| `score_entries` | `id uuid` | N-1 player | delta, motivo (base de las estadísticas) |
| `game_events` | `id bigserial` | N-1 game | log append-only de todo lo que pasa |

## Despliegue (Railway / Render)

```
npm ci && npm run build      # compila el cliente a dist/client
npm start                    # PORT, DATABASE_URL (opcional), SNAPSHOT_DIR (opcional)
```

En discos efímeros, usa `DATABASE_URL` para que las partidas sobrevivan a un redeploy.
