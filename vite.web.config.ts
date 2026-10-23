import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { webDocuments } from './src/web/documents';

export default defineConfig({
  root: resolve('src/renderer'),
  publicDir: resolve('desktop-public'),
  plugins: [webDocuments(), react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
    proxy: { '/api': 'http://127.0.0.1:8765' }
  }
});
