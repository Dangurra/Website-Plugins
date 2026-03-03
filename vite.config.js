import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    lib: {
      entry: 'src/main.js',
      name: 'AlbacoreGlobe',        // window.AlbacoreGlobe in IIFE mode
      fileName: 'past-missions',
      formats: ['iife'],             // single self-contained file for <script> tag
    },
    rollupOptions: {
      output: {
        assetFileNames: 'past-missions.[ext]',
      },
    },
  },
});
