import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const serverPort = Number(process.env.PORT ?? 3001);

export default defineConfig({
  plugins: [react()],
  root: 'src/client',
  publicDir: 'public',
  build: { outDir: '../../dist/client', emptyOutDir: true },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': `http://localhost:${serverPort}`,
      '/socket.io': { target: `http://localhost:${serverPort}`, ws: true },
    },
  },
});
