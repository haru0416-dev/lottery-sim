import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 静的ホスティング(相対パス配信)でも動くよう base を './' に
export default defineConfig({
  plugins: [react()],
  base: './',
})
