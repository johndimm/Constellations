import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

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
        root: '.', // Build from root so we can access components
        plugins: [react()],
        define: {
            'process.env.API_KEY': JSON.stringify(apiKey),
            'process.env.GEMINI_API_KEY': JSON.stringify(apiKey),
            'import.meta.env.VITE_GEMINI_API_KEY': JSON.stringify(apiKey),
            'import.meta.env.GEMINI_API_KEY': JSON.stringify(apiKey)
        },
        build: {
            outDir: 'dist-extension',
            emptyOutDir: true,
            sourcemap: mode === 'development' ? 'inline' : false,
            rollupOptions: {
                input: {
                    popup: resolve(__dirname, 'chrome-extension/popup.html'),
                    sidepanel: resolve(__dirname, 'chrome-extension/sidepanel.html'),
                    background: resolve(__dirname, 'chrome-extension/background.ts'),
                    content: resolve(__dirname, 'chrome-extension/content.ts')
                },
                output: {
                    entryFileNames: (chunkInfo) => {
                        if (chunkInfo.name === 'background') {
                            return 'background.js';
                        }
                        if (chunkInfo.name === 'content') {
                            return 'content.js';
                        }
                        return 'assets/[name]-[hash].js';
                    }
                }
            }
        },
        resolve: {
            alias: {
                '@': resolve(__dirname, '.')
            }
        }
    };
});
