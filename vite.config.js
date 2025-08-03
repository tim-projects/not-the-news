import { defineConfig } from 'vite';
import { resolve } from 'path';
import { VitePWA } from 'vite-plugin-pwa';

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
        // Remove sw.js from this list! The PWA plugin will handle it.
        main: resolve(__dirname, 'src/index.html'),
        login: resolve(__dirname, 'src/login.html'),
      },
      output: {
        // Your old custom logic for sw.js is no longer needed.
        // Vite will now use standard naming for all assets.
        entryFileNames: `assets/[name]-[hash].js`,
        chunkFileNames: `assets/[name]-[hash].js`,
        assetFileNames: `assets/[name]-[hash].[ext]`,
      },
    },
  },

  plugins: [
    // This is the new part.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      injectManifest: {
        globPatterns: [
          '**/*.{js,css,html,ico,png,svg,json}',
          'images/*.{png,svg}', // Example to match images in the public dir
          'manifest.json' // Assuming this is in your public directory
        ],
      },
      manifest: {
        // You should define your manifest here or let the plugin generate one.
        // It's a good practice to define it here for consistency.
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