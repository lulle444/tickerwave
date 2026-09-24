# Tickerwave (working title)

Stock tokens on every chain, compared. For each stock, every tokenized version (Robinhood Chain, Solana, Ethereum and more) side by side: on-chain price against the real share, market depth and 24h volume.

## Renaming the brand

Everything that names or colors the site is in `brand.json`: name, wordmark, tagline, domain, X handle and colors. To change it:

1. Edit `brand.json`.
2. Run `python3 build.py`. It rewrites the pages, `brand.css`, the logo, `sitemap.xml` and `robots.txt`.
3. Commit and push. Vercel deploys on every push to `main`.

Server code reads `brand.json` directly, so the share-preview image and the API's user agent follow along.

## How it works

- `lib/board.js` holds one plug-in per issuer. Each lists its tokens (chain, address, share ratio); DexScreener supplies price, depth and volume for all of them. Share prices come from live quotes for the underlying stock.
- `api/board.js` serves the combined board, cached 60 seconds at Vercel's CDN.
- `api/og.js` draws the share-preview image with today's numbers.
- `board.js` renders the table in the browser; `backdrop.js` is the animated background; `chart.js` is a small line-chart helper.

Built from the same engine as [Tidewatch](https://github.com/lulle444/tidewatch).

Not financial advice.
