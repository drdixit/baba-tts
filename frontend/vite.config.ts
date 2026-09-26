import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
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
