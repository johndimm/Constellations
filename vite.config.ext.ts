import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
        root: '.', // Build from root so we can access components
        publicDir: 'chrome-extension/public',
        plugins: [tailwindcss(), react()],
        define: {
            // Force API keys to be empty in the extension build. 
            // All AI requests will be proxied through the backend.
            'process.env.GEMINI_API_KEY': JSON.stringify(''),
            'process.env.API_KEY': JSON.stringify(''),
            'import.meta.env.VITE_GEMINI_API_KEY': JSON.stringify(''),
            'import.meta.env.GEMINI_API_KEY': JSON.stringify(''),
            'import.meta.env.VITE_API_KEY': JSON.stringify(''),
            'import.meta.env.VITE_CACHE_URL': JSON.stringify(env.VITE_CACHE_URL || env.VITE_CACHE_API_URL || ""),
            'import.meta.env.VITE_CACHE_API_URL': JSON.stringify(env.VITE_CACHE_URL || env.VITE_CACHE_API_URL || "")
        },
        build: {
            outDir: 'dist-extension',
            emptyOutDir: true,
            sourcemap: mode === 'development' ? 'inline' : false,
            chunkSizeWarningLimit: 1000,
            rollupOptions: {
                input: {
                    popup: resolve(__dirname, 'chrome-extension/popup.html'),
                    sidepanel: resolve(__dirname, 'chrome-extension/sidepanel.html'),
                    welcome: resolve(__dirname, 'chrome-extension/welcome.html'),
                    background: resolve(__dirname, 'chrome-extension/background.ts'),
                    content: resolve(__dirname, 'chrome-extension/content.ts')
                },
                output: {
                    manualChunks: {
                        'vendor-react': ['react', 'react-dom'],
                        'vendor-d3': ['d3'],
                        'vendor-ai': ['@google/genai'],
                        'vendor-icons': ['lucide-react']
                    },
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
