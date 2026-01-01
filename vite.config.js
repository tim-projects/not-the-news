import { defineConfig } from 'vite';
import { resolve } from 'path';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Set the root to the 'src' directory
  root: 'src',

  // Look for .env files in the project root
  envDir: '../',

  resolve: {
    dedupe: ['firebase/app', 'firebase/auth', 'firebase/firestore']
  },

  // Configure the public directory to be the one at the same level as src/
  publicDir: '../public',

  server: {
    allowedHosts: ['vscode.tail06b521.ts.net', 'localhost'],
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      }
    }
  },

  build: {
    // Output everything to the 'www' directory, which is outside the 'src' folder
    outDir: '../www',
    emptyOutDir: true,
    minify: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/index.html'),
        login: resolve(__dirname, 'src/login.html'),
      },
      output: {
        entryFileNames: `assets/[name]-[hash].js`,
        chunkFileNames: `assets/[name]-[hash].js`,
        assetFileNames: `assets/[name]-[hash].[ext]`,
      },
    },
  },

  plugins: [
    VitePWA({
      strategies: 'injectManifest',
      srcDir: '.',
      filename: 'sw.js',
      manifestFilename: 'manifest.json',
      injectManifest: {
        globPatterns: [
          '**/*.{js,css,html,ico,png,svg,json,ttf,woff,woff2}',
        ],
      },
      manifest: {
        name: 'Not The News',
        short_name: 'NTN',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#000000',
        icons: [
          {
            src: 'images/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'images/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
    }),
  ],
});