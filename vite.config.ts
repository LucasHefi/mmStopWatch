import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
      },
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('framer-motion')) return 'motion'
          if (id.includes('lucide-react')) return 'icons'
          if (id.includes('@dnd-kit')) return 'dnd'
          if (id.includes('@tauri-apps')) return 'tauri'
          if (id.includes('react') || id.includes('zustand')) return 'react-vendor'
          return 'vendor'
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || '127.0.0.1',
    origin: 'http://127.0.0.1:1420',
    hmr: {
      protocol: 'ws',
      host: host || '127.0.0.1',
      port: 1421,
    },
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  // @ts-expect-error - vitest config
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
}));
