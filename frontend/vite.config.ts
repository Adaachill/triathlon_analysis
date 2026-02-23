import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages: npm run build:gh で base を ./ に（プロジェクトルートで公開する場合）
// サブパスで公開する場合は vite build --base /triathlon_analysis/
export default defineConfig({
  plugins: [react()],
  base: '/',
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
