import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Proxy TMX GraphQL → bypasses CORS from localhost
      '/api/tmx': {
        target: 'https://app-money.tmx.com',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/tmx/, ''),
        headers: {
          'Origin': 'https://money.tmx.com',
          'Referer': 'https://money.tmx.com/',
        },
      },
      // Proxy Yahoo Finance chart API → bypasses CORS from localhost
      '/api/yahoo': {
        target: 'https://query1.finance.yahoo.com',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/yahoo/, ''),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      },
    },
  },
})
