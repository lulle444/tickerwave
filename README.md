# Pegwatch

Stock tokens on every chain, compared. For each stock, every tokenized version (Robinhood Chain, Solana, Ethereum and more) side by side: on-chain price against the real share, market depth and 24h volume.

## Renaming the brand

Everything that names or styles the site is in `brand.json`: name, wordmark, tagline, domain, X handle, colors and fonts. To change it:

1. Edit `brand.json`.
2. Run `python3 build.py`. It rewrites the pages, `brand.css`, the logo, `sitemap.xml` and `robots.txt`.
3. Commit and push. Vercel deploys on every push to `main`.

Server code reads `brand.json` directly, so the share-preview image and the API's user agent follow along.

## How it works

- `lib/board.js` holds one plug-in per issuer. Each lists its tokens (chain, address, share ratio); DexScreener supplies price, depth and volume for all of them. Share prices come from live quotes for the underlying stock.
- `api/board.js` serves the combined board, cached 60 seconds at Vercel's CDN.
- `api/og.js` draws the share-preview image with today's numbers.
- `lib/history.js` saves every token's distance from its share once an hour while the US market trades (called from `api/check-alerts.js`, which the Warm board workflow runs every 5 minutes). `api/history.js` serves it: `?v=TSLAx_solana` for one token's sparkline, `?p=issuers` for the peg score per issuer.
- `api/stock.js` serves one page per stock at `/stock/TSLA` (rewritten in `vercel.json`): it fills `templates/stock.html`, which `build.py` writes, with the stock's name, summary and share card, and `board.js` adds the live prices. `/sitemap-stocks.xml` lists every stock page.
- `board.js` renders the table, ticker tape and spotlight in the browser; `backdrop.js` is the animated chart background.

Built from the same engine as [Tidewatch](https://github.com/lulle444/tidewatch).

Not financial advice.
