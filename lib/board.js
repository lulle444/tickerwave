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
        const ticker = String(a.tokenSymbol || "").toUpperCase();
        const q = qBy.get(lc(address)) || {};
        tokens.push({ticker, name: String(a.tokenName || ticker).split("•")[0].trim(), symbol: a.tokenSymbol, chain: "robinhood",
          address, multiplier: num(a.currentMultiplier) || 1, logo: a.logoUrl || null});
        const bid = num(q.bid), ask = num(q.ask);
        if (bid > 0 && ask > 0 && !q.isTradingHalt) quotes[ticker] = {bid, ask, at: q.generatedAt || null};
      }
      return {tokens, quotes};
    },
  },
];

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
    const top = ms[0], q = quotes[t.ticker];
    const ref = q ? (q.bid + q.ask) / 2 : null;
    const onchain = top ? num(top.priceUsd) : null;
    const fair = ref != null ? ref * (t.multiplier || 1) : null;
    const v = {
      issuer: t.issuer, chain: t.chain, symbol: t.symbol, address: t.address, multiplier: t.multiplier || 1,
      onchain, gap: fair && onchain ? onchain / fair - 1 : null,
      liquidity: ms.length ? ms.reduce((s, p) => s + (num((p.liquidity || {}).usd) || 0), 0) : null,
      volume24h: ms.length ? ms.reduce((s, p) => s + (num((p.volume || {}).h24) || 0), 0) : null,
      url: top ? top.url : (CHAINS.find(c => c.id === t.chain) || {}).explorer + t.address,
    };
    if (!stocks.has(t.ticker)) stocks.set(t.ticker, {ticker: t.ticker, name: t.name, logo: t.logo, ref, refAt: q ? q.at : null, versions: []});
    const s = stocks.get(t.ticker);
    if (!s.logo && t.logo) s.logo = t.logo;
    if (t.issuer === "robinhood" || !s.name) s.name = t.name;
    s.versions.push(v);
  }

  const list = [...stocks.values()];
  if (!list.length) throw new Error("no stock tokens: " + results.map(r => r.error).filter(Boolean).join("; "));
  const used = new Set(list.flatMap(s => s.versions.map(v => v.chain)));
  return {
    chains: CHAINS.filter(c => used.has(c.id)).map(({id, name}) => ({id, name})),
    issuers: ISSUERS.map(({id, name, url, about}) => ({id, name, url, about})),
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
