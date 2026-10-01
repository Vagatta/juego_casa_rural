import { createApp } from './app.ts';

const app = await createApp({
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: process.env.DATABASE_URL || undefined,
  snapshotDir: process.env.SNAPSHOT_DIR || undefined,
});

console.log(`🏚️  La Casa Rural escuchando en http://localhost:${app.port}`);

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
