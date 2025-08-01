import { defineConfig } from 'vite';

export default defineConfig({
  // This tells Vite that the 'src' directory is the root of your source files.
  root: 'src',
  build: {
    // This tells Vite to put the output one directory up from the root (`src`).
    outDir: '../www',
    emptyOutDir: true, // Clean the output directory before building
    // This tells Vite to process all three files as separate entry points.
    rollupOptions: {
      input: {
        main: 'index.html',
        login: 'login.html',
        sw: 'sw.js',
      },
    },
  },
});