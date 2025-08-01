import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    // We can revert to a simple outDir since the input paths are absolute.
    outDir: 'www',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/index.html'),
        login: resolve(__dirname, 'src/login.html'),
        sw: resolve(__dirname, 'src/sw.js'),
      },
    },
  },
});