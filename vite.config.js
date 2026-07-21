import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Split heavy vendor libs into their own chunks so the main app bundle
        // stays small and vendors cache independently across deploys.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('@solana/web3.js')) return 'solana';
          if (id.includes('ethers')) return 'ethers';
          if (id.includes('framer-motion') || id.includes('@react-spring')) return 'motion';
          if (id.includes('lightweight-charts')) return 'charts';
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) return 'react';
          return 'vendor';
        },
      },
    },
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