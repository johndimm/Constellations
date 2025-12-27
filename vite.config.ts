import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const apiKey =
    env.VITE_GEMINI_API_KEY ||
    env.GEMINI_API_KEY ||
    env.VITE_API_KEY ||
    env.API_KEY ||
    env.NEXT_PUBLIC_API_KEY ||
    "";
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [tailwindcss(), react()],
    define: {
      'process.env.API_KEY': JSON.stringify(apiKey),
      'process.env.GEMINI_API_KEY': JSON.stringify(apiKey),
      'import.meta.env.VITE_GEMINI_API_KEY': JSON.stringify(apiKey),
      'import.meta.env.GEMINI_API_KEY': JSON.stringify(apiKey)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
