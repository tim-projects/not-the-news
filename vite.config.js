import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  // Set the root to the 'src' directory
  root: 'src',

  // Configure the public directory to be the one at the same level as src/
  publicDir: '../public',

  build: {
    // Output everything to the 'www' directory, which is outside the 'src' folder
    outDir: '../www',

    // Clear the output directory on each build
    emptyOutDir: true,

    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/index.html'),
        login: resolve(__dirname, 'src/login.html'),
        sw: resolve(__dirname, 'src/sw.js'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          // Force sw.js to be named sw.js and placed in the root
          if (chunkInfo.name === 'sw') {
            return '[name].js';
          }
          // The other files will get standard hashed names.
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: `assets/[name]-[hash].js`,
        assetFileNames: `assets/[name]-[hash].[ext]`,
      },
    },
  },
});
