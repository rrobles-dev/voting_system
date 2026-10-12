import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// El proxy envía /api al backend: el navegador ve un solo origen y no hay problemas de CORS en desarrollo.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
});
