const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Proxy: /api/tmx → app-money.tmx.com (SEDI insider data + TSX quotes)
app.use(
  '/api/tmx',
  createProxyMiddleware({
    target: 'https://app-money.tmx.com',
    changeOrigin: true,
    pathRewrite: { '^/api/tmx': '' },
    on: {
      proxyReq: (proxyReq) => {
        proxyReq.setHeader('Origin', 'https://money.tmx.com');
        proxyReq.setHeader('Referer', 'https://money.tmx.com/');
        proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
      },
    },
  })
);

// Proxy: /api/yahoo → query1.finance.yahoo.com (OHLCV candles for .TO stocks)
app.use(
  '/api/yahoo',
  createProxyMiddleware({
    target: 'https://query1.finance.yahoo.com',
    changeOrigin: true,
    pathRewrite: { '^/api/yahoo': '' },
    on: {
      proxyReq: (proxyReq) => {
        proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
      },
    },
  })
);

// Proxy: /api/sec → www.sec.gov  (SEC EDGAR browse + Atom feeds)
// Proxy: /api/edgar → efts.sec.gov (SEC EDGAR full-text search API)
// User-Agent format required by SEC: "<Org> <contact-email>"
const SEC_UA = 'MoneyTalks admin@moneytalks.app';

app.use('/api/sec', createProxyMiddleware({
  target: 'https://www.sec.gov',
  changeOrigin: true,
  pathRewrite: { '^/api/sec': '' },
  on: { proxyReq: (pr) => { pr.setHeader('User-Agent', SEC_UA); pr.setHeader('Accept', 'text/xml,application/xml,*/*'); } },
}));

app.use('/api/edgar', createProxyMiddleware({
  target: 'https://efts.sec.gov',
  changeOrigin: true,
  pathRewrite: { '^/api/edgar': '' },
  on: { proxyReq: (pr) => { pr.setHeader('User-Agent', SEC_UA); pr.setHeader('Accept', 'application/json'); } },
}));

// Serve built React app
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

// SPA fallback — send index.html for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`MoneyTalks server running on port ${PORT}`);
});
