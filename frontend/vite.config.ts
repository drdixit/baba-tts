import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 7061,
    strictPort: true,
    fs: {
      allow: ['..'],
    },
    proxy: {
      '/auth': 'http://localhost:7060',
      '/api': 'http://localhost:7060',
      '/ws': {
        target: 'http://localhost:7060',
        ws: true,
      },
    },
  },
})
