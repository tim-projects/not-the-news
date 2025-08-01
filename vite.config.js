import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'www', // Match Parcel's output directory
    rollupOptions: {
      input: {
        main: 'src/index.html',
        sw: 'src/sw.js'
      }
    }
  }
});