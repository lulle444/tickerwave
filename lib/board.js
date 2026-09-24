// The stock board: every tokenized stock, each of its versions (issuer × chain), priced against the real share.
// Issuers are plug-ins below: each lists its tokens; DexScreener supplies on-chain price, depth and volume for all of them.
const B = require("../brand.json");

const DEX = "https://api.dexscreener.com/tokens/v1/";
const DEX_BATCH = 30;   // DexScreener's limit on addresses per request
const UA = `${B.name.toLowerCase()}/1.0 (+https://${B.domain})`;

const CHAINS = [
  {id: "robinhood", name: "Robinhood Chain", explorer: "https://robinhoodchain.blockscout.com/token/"},
  {id: "solana", name: "Solana", explorer: "https://solscan.io/token/"},
  {id: "ethereum", name: "Ethereum", explorer: "https://etherscan.io/token/"},
  {id: "bsc", name: "BNB Chain", explorer: "https://bscscan.com/token/"},
];

async function getJson(url, opts = {}){
  const r = await fetch(url, {headers: {accept: "application/json", "user-agent": UA, ...(opts.headers || {})}, signal: AbortSignal.timeout(opts.timeout || 15000)});
  if (!r.ok) throw new Error(`${url.split("?")[0]} → HTTP ${r.status}`);
  return r.json();
}
const num = v => { const n = parseFloat(v); return isFinite(n) ? n : null; };
const lc = s => String(s || "").toLowerCase();
// EVM addresses are case-insensitive; Solana mints are not
const keyOf = (chain, addr) => chain + ":" + (chain === "solana" ? addr : lc(addr));

/* ---------- issuers ---------- */
// Each list() returns {tokens: [{ticker, name, symbol, chain, address, multiplier, logo}], quotes?: {TICKER: {bid, ask, at}}}.
// quotes are live share prices per underlying ticker, used as the reference for every issuer's version.
const RH = "https://api.robinhood.com/rhj";
const ISSUERS = [
  {
    id: "robinhood", name: "Robinhood", url: "https://robinhood.com/eu/en/stock-tokens/",
    about: "Robinhood’s own stock tokens, minted on its Arbitrum-based chain and traded 24/5 in the EU app and on chain.",
    async list(){
      const addrOf = x => ((x.deployments || []).find(d => d.chainId === 4663) || {}).contractAddress;
      const [assets, prices] = await Promise.all([getJson(RH + "/assets"), getJson(RH + "/prices")]);
      const qBy = new Map();
      for (const q of prices.quotes || []){ const a = addrOf(q); if (a) qBy.set(lc(a), q); }
      const tokens = [], quotes = {};
      for (const a of assets.assets || []){
        const address = addrOf(a);
        if (a.status !== "ASSET_STATUS_ACTIVE" || !address) continue;
        const ticker = normTicker(a.tokenSymbol);
        const q = qBy.get(lc(address)) || {};
        tokens.push({ticker, name: String(a.tokenName || ticker).split("•")[0].trim(), symbol: a.tokenSymbol, chain: "robinhood",
          address, multiplier: num(a.currentMultiplier) || 1, logo: a.logoUrl || null, primary: true});
        const bid = num(q.bid), ask = num(q.ask);
        if (bid > 0 && ask > 0 && !q.isTradingHalt) quotes[ticker] = {bid, ask, at: q.generatedAt || null};
      }
      return {tokens, quotes};
    },
  },
  {
    id: "xstocks", name: "xStocks", url: "https://xstocks.fi",
    about: "Backed’s xStocks, traded on Kraken and Bybit and across DeFi. Largest on Solana, with the same token on Ethereum and BNB Chain.",
    async list(){
      const NET = {Solana: "solana", Ethereum: "ethereum", BinanceSmartChain: "bsc"};
      const nodes = [];
      for (let page = 0; page < 10; page++){
        const j = await xget(`/public/assets?page=${page}&pageSize=100`);
        const got = j.nodes || j.data || [];
        nodes.push(...got);
        if (j.page ? !j.page.hasNextPage : got.length < 100) break;
      }
      const mult = await xMultipliers(nodes.map(n => n.symbol));
      const tokens = [];
      for (const n of nodes){
        const ticker = normTicker((n.underlying || {}).symbol || n.underlyingSymbol);
        if (!ticker) continue;
        for (const d of n.deployments || []){
          const chain = NET[d.network];
          if (chain) tokens.push({ticker, name: String(n.name || ticker).replace(/\s*xStock$/i, ""), symbol: n.symbol, chain, address: d.address,
            multiplier: mult.get(n.symbol) ?? null, logo: n.logo || null, primary: chain === "solana", halted: !!n.isTradingHalted});
        }
      }
      return {tokens, refPrice: xPrice};
    },
  },
  {
    id: "ondo", name: "Ondo Global Markets", short: "Ondo", url: "https://ondo.finance/global-markets",
    about: "Ondo’s tokenized stocks and ETFs, issued on Ethereum and BNB Chain and minted around the clock for eligible investors.",
    async list(){
      const j = await getJson("https://raw.githubusercontent.com/ondoprotocol/ondo-global-markets-token-list/main/tokenlist.json");
      const CH = {1: "ethereum", 56: "bsc"};
      const tokens = [];
      for (const t of j.tokens || []){
        const chain = CH[t.chainId], m = String(t.symbol || "").match(/^(.+?)on$/);
        if (!chain || !m) continue;
        tokens.push({ticker: normTicker(m[1]), name: String(t.name || m[1]).replace(/\s*\(Ondo Tokenized\)\s*$/i, "").replace(/\s*Ondo Tokenized( Stock| ETF)?$/i, ""),
          symbol: t.symbol, chain, address: t.address, multiplier: null, logo: t.logoURI || null, primary: chain === "ethereum"});
      }
      return {tokens};
    },
  },
];

// xStocks' public API (no key). backed.fi answers; xstocks.fi is the documented host, kept as backup.
const XHOSTS = ["https://api.backed.fi/api/v2", "https://api.xstocks.fi/api/v2"];
async function xget(path){
  let err;
  for (const h of XHOSTS){ try { return await getJson(h + path); } catch (e) { err = e; } }
  throw err;
}
// Share ratios change only on dividends and splits, so they are kept for six hours per server instance.
const memo = new Map();
async function cached(key, ms, fn){
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ms) return hit.v;
  const v = await fn();
  memo.set(key, {at: Date.now(), v});
  return v;
}
async function pool(items, n, fn){
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({length: Math.min(n, items.length)}, async () => { while (i < items.length){ const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}
async function xMultipliers(symbols){
  return cached("xmult", 6 * 36e5, async () => {
    const vals = await pool(symbols, 8, sym => xget(`/public/assets/${encodeURIComponent(sym)}/multiplier?network=Solana`)
      .then(j => num(j.currentMultiplier), () => null));
    return new Map(symbols.map((s, i) => [s, vals[i]]));
  });
}
// the underlying share price from xStocks, for stocks Robinhood doesn't quote
const xPrice = sym => cached("xp:" + sym, 60000, () => xget(`/public/assets/${encodeURIComponent(sym)}/price-data`).then(j => num(j.quote), () => null));
const normTicker = t => String(t || "").toUpperCase().replace(/[\/-]/g, ".").trim();

/* ---------- on-chain markets ---------- */
async function dexPairs(chain, addrs){
  const chunks = [];
  for (let i = 0; i < addrs.length; i += DEX_BATCH) chunks.push(addrs.slice(i, i + DEX_BATCH));
  const lists = await Promise.all(chunks.map(c => getJson(DEX + chain + "/" + c.join(",")).catch(() => [])));
  return lists.flat().filter(p => p && p.baseToken && p.priceUsd);
}

async function board(){
  const results = await Promise.all(ISSUERS.map(i => i.list().then(r => ({i, ...r}), e => ({i, tokens: [], error: String(e.message || e)}))));
  const quotes = {};
  for (const r of results) for (const [t, q] of Object.entries(r.quotes || {})) if (!quotes[t]) quotes[t] = q;

  const tokens = results.flatMap(r => r.tokens.map(t => ({...t, issuer: r.i.id})));
  const byChain = {};
  for (const t of tokens) (byChain[t.chain] = byChain[t.chain] || []).push(t.address);
  const pairs = (await Promise.all(Object.entries(byChain).map(([chain, addrs]) => dexPairs(chain, [...new Set(addrs)])))).flat();
  const markets = new Map();   // only markets where the stock token is the priced (base) side
  for (const p of pairs){
    const k = keyOf(p.chainId, p.baseToken.address);
    if (!markets.has(k)) markets.set(k, []);
    markets.get(k).push(p);
  }

  const stocks = new Map();
  for (const t of tokens){
    const ms = (markets.get(keyOf(t.chain, t.address)) || []).sort((x, y) => ((y.liquidity || {}).usd || 0) - ((x.liquidity || {}).usd || 0));
    if (!ms.length && t.issuer !== "robinhood") continue;   // other issuers list every chain they deploy on; show only where it trades
    const top = ms[0];
    const v = {
      issuer: t.issuer, chain: t.chain, symbol: t.symbol, address: t.address, multiplier: t.multiplier,
      onchain: top ? num(top.priceUsd) : null,
      liquidity: ms.length ? ms.reduce((s, p) => s + (num((p.liquidity || {}).usd) || 0), 0) : null,
      volume24h: ms.length ? ms.reduce((s, p) => s + (num((p.volume || {}).h24) || 0), 0) : null,
      url: top ? top.url : (CHAINS.find(c => c.id === t.chain) || {}).explorer + t.address,
      halted: !!t.halted,
    };
    if (!stocks.has(t.ticker)) stocks.set(t.ticker, {ticker: t.ticker, name: t.name, logo: t.logo, ref: null, refAt: null, versions: []});
    const s = stocks.get(t.ticker);
    if (!s.logo && t.logo) s.logo = t.logo;
    if (t.issuer === "robinhood") s.name = t.name;
    s.versions.push(v);
  }

  // share price: Robinhood's live quote, else xStocks' price for the underlying (only where a deep market makes it matter)
  const xsym = new Map(tokens.filter(t => t.issuer === "xstocks").map(t => [t.ticker, t.symbol]));
  const xref = results.find(r => r.i.id === "xstocks" && r.refPrice);
  const need = [...stocks.values()].filter(s => !quotes[s.ticker] && xsym.has(s.ticker) && s.versions.some(v => v.liquidity >= 1e4));
  if (xref) await pool(need, 8, async s => { const p = await xref.refPrice(xsym.get(s.ticker)); if (p > 0) quotes[s.ticker] = {bid: p, ask: p, at: new Date().toISOString()}; });
  for (const s of stocks.values()){
    const q = quotes[s.ticker];
    if (q){ s.ref = (q.bid + q.ask) / 2; s.refAt = q.at; }
    for (const v of s.versions){
      const fair = s.ref != null ? s.ref * (v.multiplier || 1) : null;
      v.gap = fair && v.onchain ? v.onchain / fair - 1 : null;
      if (v.multiplier == null) v.ratioUnknown = true;
    }
  }

  const list = [...stocks.values()].filter(s => s.versions.length);
  if (!list.length) throw new Error("no stock tokens: " + results.map(r => r.error).filter(Boolean).join("; "));
  const used = new Set(list.flatMap(s => s.versions.map(v => v.chain)));
  return {
    chains: CHAINS.filter(c => used.has(c.id)).map(({id, name}) => ({id, name})),
    issuers: ISSUERS.map(({id, name, short, url, about}) => ({id, name, short, url, about})),
    errors: results.filter(r => r.error).map(r => ({issuer: r.i.id, error: r.error})),
    stocks: list,
  };
}

// For server code that needs the board: our CDN-cached endpoint first, the sources directly as backup.
async function currentBoard(site){
  try {
    const j = await getJson(site.replace(/\/$/, "") + "/api/board");
    if (j && j.stocks && j.stocks.length) return j;
  } catch (e) {}
  return board();
}

module.exports = {board, currentBoard, CHAINS, ISSUERS};
