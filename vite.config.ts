import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Vercel/CI: dashboard env vars live on `process.env` at build time. `loadEnv` only reads `.env*`
 * files, so we merge both or the client bundle would ship with an empty API key.
 */
export default defineConfig(({ mode }) => {
  const fromFiles = loadEnv(mode, process.cwd(), '');
  const e = (key: string): string => {
    const v = fromFiles[key] ?? process.env[key];
    if (v == null || v === '') return '';
    return String(v);
  };
  const apiKey =
    e('VITE_GEMINI_API_KEY') ||
    e('GEMINI_API_KEY') ||
    e('VITE_API_KEY') ||
    e('API_KEY') ||
    e('NEXT_PUBLIC_GEMINI_API_KEY') ||
    e('NEXT_PUBLIC_API_KEY') ||
    '';
  const cacheUrl = e('VITE_CACHE_URL') || e('VITE_CACHE_API_URL');
  const cacheTarget = (cacheUrl || 'http://127.0.0.1:4000').replace(/\/$/, '');
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
      /** Dev: `getImageApiBaseUrl` uses same origin; forward to graph server if it implements GET /api/image. */
      proxy: {
        '/api/image': {
          target: cacheTarget,
          changeOrigin: true,
        },
      },
    },
    plugins: [tailwindcss(), react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-d3': ['d3'],
            'vendor-ai': ['@google/genai'],
            'vendor-icons': ['lucide-react']
          }
        }
      },
      chunkSizeWarningLimit: 1000 // Raise limit slightly since we are breaking things up
    },
    define: {
      'process.env.API_KEY': JSON.stringify(apiKey),
      'process.env.GEMINI_API_KEY': JSON.stringify(apiKey),
      'import.meta.env.VITE_GEMINI_API_KEY': JSON.stringify(apiKey),
      'import.meta.env.GEMINI_API_KEY': JSON.stringify(apiKey),
      'import.meta.env.VITE_CACHE_URL': JSON.stringify(cacheUrl),
      'import.meta.env.VITE_CACHE_API_URL': JSON.stringify(cacheUrl)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        '@johndimm/constellations': path.resolve(__dirname, '.'),
      }
    }
  };
});
