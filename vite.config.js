import { defineConfig } from 'vite';

export default defineConfig({
  // This tells Vite that the 'src' directory is the root of your source files.
  root: 'src',
  build: {
    // This tells Vite to put the output in a 'www' directory that is outside
    // the 'src' directory (relative to the project root).
    outDir: '../www',
    emptyOutDir: true, // Clean the output directory before building
  }
});