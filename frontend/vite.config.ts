import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repositoryRoot, 'BABA_TTS_')
  const backendPort = Number(process.env.BABA_TTS_PORT || env.BABA_TTS_PORT || '7060')
  if (!Number.isInteger(backendPort) || backendPort < 7060 || backendPort > 7100) {
    throw new Error('BABA_TTS_PORT must be a number between 7060 and 7100')
  }

  const backend = `http://127.0.0.1:${backendPort}`

  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: '127.0.0.1',
      port: 7061,
      strictPort: true,
      proxy: {
        '/api': backend,
        '/ws': {
          target: backend,
          ws: true,
        },
      },
    },
  }
})
