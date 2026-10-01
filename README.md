# 🏚️ LA CASA RURAL

Party game presencial para 6–12 jugadores. El móvil es el controlador; la diversión ocurre en la habitación. Un jugador proyecta la pantalla de la casa (TV/portátil) y el resto juega desde su móvil: roles secretos, misiones, velas, traiciones y una Gran Acusación final con casino incluido.

## Desarrollo

```bash
npm install
npm run dev          # API :3001 + web :5173 (npm run dev -- 4321 cambia el puerto web)
npm test             # partidas simuladas completas + auditoría de fugas de secretos
npm run typecheck
npm run build        # cliente → dist/client
npm start            # producción local en :3001 (PORT para cambiarlo)
```

`/dev` abre una mesa de pruebas con la TV + N móviles en paralelo para desarrollar solo.

## Despliegue

La app es un solo proceso Node (Express + Socket.IO + estáticos). Necesita un host con **WebSockets** (hosting compartido clásico NO vale) y un puerto (`PORT`).

### Railway (recomendado)

1. `railway up` o conecta el repo en railway.app — detecta el `Dockerfile` solo.
2. Añade un plugin **PostgreSQL** → Railway inyecta `DATABASE_URL` automáticamente y las partidas sobreviven a redespliegues (la tabla `game_snapshots` se crea sola).
3. Despliega → te da `https://xxx.up.railway.app` con HTTPS listo para la PWA.

Sin Postgres funciona igual, pero los snapshots van a disco efímero: las partidas en curso se pierden al redesplegar.

### Render / Fly

- **Render**: New → Web Service → Docker. Health check: `/api/health`. Add-on Postgres opcional (`DATABASE_URL`).
- **Fly.io**: `fly launch` detecta el Dockerfile; `fly postgres create` + `fly secrets set DATABASE_URL=...` para persistencia.

### Docker a mano / VPS

```bash
docker build -t casa-rural .
docker run -p 3001:3001 -e PORT=3001 \
  -e DATABASE_URL=postgres://... \   # opcional; sin esto usa archivos en /app/data/snapshots
  -v casa-data:/app/data \            # volumen para snapshots si no hay Postgres
  casa-rural
```

Detrás de nginx/Caddy: proxy inverso normal + `Upgrade`/`Connection` para WebSocket. HTTPS recomendado (PWA + móviles).

### Solo LAN (sin internet)

```bash
npm run build && npm start
```

Los jugadores conectados a tu Wi-Fi entran a `http://<tu-ip>:3001`. Para saber la IP: `ipconfig` (Windows). El QR de la sala apunta al origen que vea el navegador, así que funciona directo.

## Variables de entorno

| Variable | Defecto | Para qué |
| --- | --- | --- |
| `PORT` | `3001` | Puerto HTTP |
| `DATABASE_URL` | — | Postgres para snapshots persistentes (recomendado en PaaS) |
| `SNAPSHOT_DIR` | `./data/snapshots` | Dónde guardar snapshots si no hay Postgres |

## Estructura

```
content/     contenido del juego (JSON editable: roles, misiones, pruebas, eventos)
src/shared/  tipos de vistas públicas + constantes
src/server/  Express + Socket.IO + motor de juego (engine/)
src/client/  React + Vite
tests/       simulación de partidas completas con sockets reales
docs/        diseño (01) y arquitectura (02)
```
