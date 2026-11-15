import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { askPlugin } from './server/ask.mjs'
import { semanticPlugin } from './server/semantic.mjs'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // '' prefix loads unprefixed vars too; the API keys stay server-side because only VITE_* reach the client.
  const env = loadEnv(mode, process.cwd(), '')
  return { preview: { allowedHosts: true }, plugins: [react(), askPlugin({ gemini: env.GEMINI_API_KEY, cala: env.CALA_API_KEY }), semanticPlugin({ gemini: env.GEMINI_API_KEY })] }
})
