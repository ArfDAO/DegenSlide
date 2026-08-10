import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {

  },
  server: {
    proxy: {
      '/monad-api': {
        target: 'https://monadexplorer.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/monad-api/, '')
      }
    }
  }
});