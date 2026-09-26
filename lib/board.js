// The stock board: every tokenized stock, each of its versions (issuer × chain), priced against the real share.
// Issuers are plug-ins below: each lists its tokens; DexScreener supplies on-chain price, depth and volume for all of them.
const B = require("../brand.json");
const {redis, pipeline} = require("./store");

const DEX = "https://api.dexscreener.com/tokens/v1/";
const DEX_BATCH = 30;
const MIN_DEPTH = 1000;  // below this a market is dust and its price means nothing   // DexScreener's limit on addresses per request
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
      const nodes = await shared("xlist", 6 * 36e5, xAssets);
      const tokens = [];
      for (const n of nodes){
        const ticker = normTicker(n.underlyingSymbol || (n.underlying || {}).symbol);
        if (!ticker) continue;
        for (const d of n.deployments || []){
          const chain = NET[d.network];
          if (chain) tokens.push({ticker, name: String(n.name || ticker).replace(/\s*xStock$/i, ""), symbol: n.symbol, chain, address: d.address,
            multiplier: null, logo: n.logo || null, primary: chain === "solana", halted: !!n.isTradingHalted});
        }
      }
      return {tokens, refPrice: xPrice, ratios: xRatios};
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
  for (const h of XHOSTS){ try { return await getJson(h + path, {timeout: 9000}); } catch (e) { err = e; } }
  throw err;
}
// The full asset list is 300+ assets in pages of 100, each about 2 seconds, so pages are fetched four at a time
// and the list is kept six hours per server instance (new listings are rare).
async function xAssets(){
  const nodes = [];
  for (let start = 0; start < 12; start += 4){
    const pages = await Promise.all([0, 1, 2, 3].map(k => xget(`/public/assets?page=${start + k}&pageSize=100`)));
    let more = true;
    for (const j of pages){ nodes.push(...(j.nodes || [])); if (!(j.page && j.page.hasNextPage)) { more = false; break; } }
    if (!more) break;
  }
  if (!nodes.length) throw new Error("xStocks list empty");
  // only what list() reads, so the copy kept in the database stays small
  return nodes.map(n => ({symbol: n.symbol, name: n.name, logo: n.logo || null, isTradingHalted: !!n.isTradingHalted,
    underlyingSymbol: (n.underlying || {}).symbol || n.underlyingSymbol, deployments: (n.deployments || []).map(d => ({network: d.network, address: d.address}))}));
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
// Slow lookups are also kept in the database (tk:c:*), so a freshly started server doesn't have to fetch them again
// inside a visitor's request. A stale copy is served while a fresh one is fetched; the database is optional.
const CKEY = k => "tk:c:" + k;
const loadShared = k => redis("GET", CKEY(k)).then(r => r ? JSON.parse(r) : null, () => null);
const saveShared = (k, e) => redis("SET", CKEY(k), JSON.stringify(e), "EX", String(7 * 86400)).catch(() => {});
async function shared(key, ms, fn){
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ms) return hit.v;
  const stored = hit || await loadShared(key);
  if (stored && Date.now() - stored.at < ms){ memo.set(key, stored); return stored.v; }
  const job = fn().then(v => { const e = {at: Date.now(), v}; memo.set(key, e); saveShared(key, e); return v; });
  if (stored){ memo.set(key, stored); job.catch(() => {}); return stored.v; }
  return job;
}
const CLOSE = "tk:c:close";
let closeSaved = 0;
function keepClose(quotes){
  if (Date.now() - closeSaved < 120000 || !Object.keys(quotes).length) return;
  closeSaved = Date.now();
  const q = Object.fromEntries(Object.entries(quotes).map(([t, x]) => [t, +((x.bid + x.ask) / 2).toPrecision(8)]));
  redis("SET", CLOSE, JSON.stringify({at: Date.now(), q}), "EX", String(30 * 86400)).catch(() => {});
}
async function lastClose(tokens){
  const hit = memo.get("close");
  if (hit && hit.v && Date.now() - hit.at < 5 * 60000) return hit.v;
  const c = await redis("GET", CLOSE).then(r => r ? JSON.parse(r) : null, () => null) || await seedClose(tokens).catch(() => null);
  memo.set("close", {at: Date.now(), v: c});
  return c;
}
// Only for a weekend with no saved close (the first one after this was added): rebuild it from the hourly share prices
// Tidewatch keeps for Robinhood tokens in the same database (tw:g:{symbol} = "minute,gap,sharePrice,onchainPrice"),
// taking each stock's last reading from while the market traded, if it is under three days old.
async function seedClose(tokens){
  const rh = tokens.filter(t => t.issuer === "robinhood");
  const lists = await pipeline(rh.map(t => ["LRANGE", "tw:g:" + t.symbol, -24, -1]));
  const q = {};
  let at = 0;
  rh.forEach((t, i) => {
    const rows = (lists[i] || []).map(r => r.split(",").map(Number))
      .filter(r => r[2] > 0 && Date.now() - r[0] * 60000 < 3 * 864e5 && marketOpen(new Date(r[0] * 60000)));
    const r = rows[rows.length - 1];
    if (r){ q[t.ticker] = r[2]; at = Math.max(at, r[0] * 60000); }
  });
  if (!Object.keys(q).length) return null;
  const c = {at, q, from: "tidewatch"};
  await redis("SET", CLOSE, JSON.stringify(c), "NX", "EX", String(30 * 86400));
  return c;
}
function useClose(quotes, c){
  const at = new Date(c.at).toISOString();
  for (const k of Object.keys(quotes)) delete quotes[k];
  for (const [t, p] of Object.entries(c.q)) quotes[t] = {bid: p, ask: p, at};
}
async function pool(items, n, fn){
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({length: Math.min(n, items.length)}, async () => { while (i < items.length){ const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}
// one call per token, so only for tokens that trade; answers are kept six hours, in memory and in the database
async function xRatios(symbols){
  const RK = "xratios", ttl = 6 * 36e5, stored = (await loadShared(RK)) || {};
  for (const [sym, [at, v]] of Object.entries(stored)) if (!memo.has("xm:" + sym)) memo.set("xm:" + sym, {at, v});
  let changed = false;
  const out = await pool(symbols, 10, sym => cached("xm:" + sym, ttl,
    () => xget(`/public/assets/${encodeURIComponent(sym)}/multiplier?network=Solana`).then(j => { const v = num(j.currentMultiplier); stored[sym] = [Date.now(), v]; changed = true; return v; })).catch(() => null));
  if (changed) await saveShared(RK, stored);
  return out;
}
// resolves to what finished within ms; slow lookups keep running and fill the cache for the next request
const within = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r(undefined), ms))]);
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
  const t0 = Date.now();
  const results = await Promise.all(ISSUERS.map(i => within(i.list(), 12000).then(r => r ? {i, ...r, ms: Date.now() - t0} : {i, tokens: [], error: "timed out"}, e => ({i, tokens: [], error: String(e.message || e)}))));
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
    // other issuers list every chain they deploy on: show only where a real market exists (dust pools price nonsense)
    const depth = ms.reduce((s, p) => s + (num((p.liquidity || {}).usd) || 0), 0);
    if (t.issuer !== "robinhood" && depth < MIN_DEPTH) continue;
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

  // xStocks share ratios for the tokens that trade, within a time budget
  const xr = results.find(r => r.i.id === "xstocks" && r.ratios);
  if (xr){
    const traded = [...new Set([...stocks.values()].flatMap(s => s.versions.filter(v => v.issuer === "xstocks").map(v => v.symbol)))];
    const vals = await within(xr.ratios(traded), 7000);
    const m = new Map(traded.map((sym, i) => [sym, vals ? vals[i] : (memo.get("xm:" + sym) || {}).v]));
    for (const s of stocks.values()) for (const v of s.versions) if (v.issuer === "xstocks") v.multiplier = m.get(v.symbol) ?? null;
  }

  // share price: Robinhood's live quote, else xStocks' price for the underlying (only where a deep market makes it matter)
  const xsym = new Map(tokens.filter(t => t.issuer === "xstocks").map(t => [t.ticker, t.symbol]));
  const xref = results.find(r => r.i.id === "xstocks" && r.refPrice);
  const need = [...stocks.values()].filter(s => !quotes[s.ticker] && xsym.has(s.ticker) && s.versions.some(v => v.liquidity >= 1e4));
  const open = marketOpen();
  if (xref && open) await within(pool(need, 8, async s => { const p = await xref.refPrice(xsym.get(s.ticker)); if (p > 0) quotes[s.ticker] = {bid: p, ask: p, at: new Date().toISOString()}; }), 5000);
  // Brokers keep publishing quotes while the market is shut, and those are not Friday's close. So the last prices seen
  // while it traded are kept in the database and stand in as the share price until trading restarts.
  if (open) keepClose(quotes);
  else { const c = await lastClose(tokens); if (c) useClose(quotes, c); }
  for (const s of stocks.values()){
    const q = quotes[s.ticker];
    if (q){ s.ref = (q.bid + q.ask) / 2; s.refAt = q.at; }
    for (const v of s.versions){
      const fair = s.ref != null ? s.ref * (v.multiplier || 1) : null;
      v.gap = fair && v.onchain ? v.onchain / fair - 1 : null;
      // half or double the share price means a ratio or price the sources got wrong (a reverse split, a different unit), not a real gap
      if (v.gap != null && Math.abs(v.gap) > MAX_GAP){ v.gap = null; v.unclear = true; }
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
    timing: {issuers: Object.fromEntries(results.map(r => [r.i.id, r.ms || null])), total: Date.now() - t0},
    stocks: list,
  };
}

const MAX_GAP = 0.5;
const THIN = 10000;   // markets shallower than this move on small trades, so their prices don't count for gaps or spreads

// Cross-chain spread for one stock: the cheapest and the priciest deep version, measured against the share price.
function spreadOf(s){
  const vs = s.versions.filter(v => v.gap != null && v.liquidity >= THIN && !v.halted);
  if (vs.length < 2) return null;
  const lo = vs.reduce((a, b) => b.gap < a.gap ? b : a), hi = vs.reduce((a, b) => b.gap > a.gap ? b : a);
  return {lo, hi, spread: hi.gap - lo.gap};
}

// US shares trade 24/5 at the brokers behind these tokens: Sunday 8 pm to Friday 8 pm New York time.
// Outside that window share prices freeze, so gaps and spreads say little.
function marketOpen(now = new Date()){
  const et = new Date(now.toLocaleString("en-US", {timeZone: "America/New_York"}));
  const day = et.getDay(), m = et.getHours() * 60 + et.getMinutes();
  return !(day === 6 || (day === 5 && m >= 1200) || (day === 0 && m < 1200));
}

// For server code that needs the board: our CDN-cached endpoint first, the sources directly as backup.
async function currentBoard(site){
  try {
    const j = await getJson(site.replace(/\/$/, "") + "/api/board");
    if (j && j.stocks && j.stocks.length) return j;
  } catch (e) {}
  return board();
}

module.exports = {board, currentBoard, spreadOf, marketOpen, THIN, CHAINS, ISSUERS};
