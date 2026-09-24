// Peg history: once an hour, while the US market trades, save how far every token sits from its share price.
// Per token:  tk:peg:v:{vid}  list of "hour,gapBp,depthK" (oldest first, capped).
// Per issuer: tk:peg:agg      list of JSON {t, i: {issuerId: [medianAbsBp, shareWithinFairPct, n]}} over deep markets
//              whose share ratio is published.
// Hours are unix hours (ms / 3.6e6), so a reading is identified by the hour it was taken in.
const {redis, pipeline} = require("./store");
const {THIN} = require("./board");
const {vidOf} = require("./alerts");

const FAIR_BP = 50;             // ±0.5%, same line the site draws between fair and premium/discount
const BROKEN_BP = 2500;         // a typical gap over 25% means broken data (as in the weekend signal), so it isn't ranked
const KEEP = 1500;              // ~7 market hours a day on weekdays, so about a year per token
const K = {
  hour: h => `tk:peg:hour:${h}`,
  v: vid => `tk:peg:v:${vid}`,
  agg: "tk:peg:agg",
  since: "tk:peg:since",
};
const hourNow = (t = Date.now()) => Math.floor(t / 3.6e6);
const median = xs => { const a = [...xs].sort((x, y) => x - y), m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

// Save this hour's readings; returns how many tokens were saved, or 0 if this hour was already saved.
async function record(board, t = Date.now()){
  const h = hourNow(t);
  if (!(await redis("SET", K.hour(h), "1", "NX", "EX", 7200))) return 0;
  const cmds = [], per = {};
  for (const s of board.stocks){
    if (s.ref == null || !s.refAt || t - Date.parse(s.refAt) > 30 * 60000) continue;   // no live share price
    for (const v of s.versions){
      if (v.gap == null || v.halted) continue;
      const bp = Math.round(v.gap * 1e4), k = K.v(vidOf(v));
      cmds.push(["RPUSH", k, `${h},${bp},${Math.round((v.liquidity || 0) / 1e3)}`], ["LTRIM", k, -KEEP, -1]);
      // Issuer scores use deep markets with a published share ratio only; without the ratio the gap can be off by dividends.
      if (v.liquidity >= THIN && !v.ratioUnknown) (per[v.issuer] = per[v.issuer] || []).push(Math.abs(bp));
    }
  }
  const i = {};
  for (const [id, xs] of Object.entries(per))
    i[id] = [Math.round(median(xs)), Math.round(100 * xs.filter(x => x <= FAIR_BP).length / xs.length), xs.length];
  cmds.push(["RPUSH", K.agg, JSON.stringify({t: h, i})], ["LTRIM", K.agg, -KEEP, -1], ["SET", K.since, String(h), "NX"]);
  await pipeline(cmds);
  return (cmds.length - 3) / 2;
}

// One token's history as [[ms, gap, depthUsd], …].
async function token(vid){
  const raw = await redis("LRANGE", K.v(vid), 0, -1) || [];
  return raw.map(r => { const [h, bp, d] = r.split(",").map(Number); return [h * 3.6e6, bp / 1e4, d * 1e3]; });
}

// Peg score per issuer over the last `days`: typical distance from the share and how often it sat within ±0.5%.
async function issuers(days = 7){
  const [raw, since] = await Promise.all([redis("LRANGE", K.agg, -Math.min(KEEP, days * 24), -1), redis("GET", K.since)]);
  const from = hourNow() - days * 24, rows = (raw || []).map(r => JSON.parse(r)).filter(r => r.t >= from);
  const acc = {};
  for (const r of rows) for (const [id, [med, fair, n]] of Object.entries(r.i)){
    const a = acc[id] = acc[id] || {meds: [], fair: 0, w: 0, n: 0};
    a.meds.push(med); a.fair += fair * n; a.w += n; a.n = Math.max(a.n, n);
  }
  return {
    since: since ? Number(since) * 3.6e6 : null, hours: rows.length, days,
    issuers: Object.entries(acc).map(([id, a]) => ({id, medianGap: median(a.meds) / 1e4, withinFair: a.w ? a.fair / a.w / 100 : null, markets: a.n})),
  };
}

// Peg ranking: every deep market with a published share ratio, scored on its hourly readings over the last `days`.
// The board tells us which markets exist; each gets its typical distance from the share, how often it sat within ±0.5%,
// its worst hour and a short sparkline. Markets with too few readings to judge are left out.
async function ranking(board, days = 7){
  const vs = [];
  for (const s of board.stocks) for (const v of s.versions)
    if (v.liquidity >= THIN && !v.ratioUnknown && !v.halted) vs.push({s, v, vid: vidOf(v)});
  if (!vs.length) return {hours: 0, days, tokens: []};
  const from = hourNow() - days * 24, cap = days * 24;
  const [since, ...lists] = await pipeline([["GET", K.since], ...vs.map(x => ["LRANGE", K.v(x.vid), -cap, -1])]);
  const rows = vs.map((x, i) => {
    const pts = (lists[i] || []).map(r => r.split(",").map(Number)).filter(p => p[0] >= from);
    if (!pts.length) return null;
    const abs = pts.map(p => Math.abs(p[1]));
    if (median(abs) > BROKEN_BP) return null;   // a price or ratio the source got wrong, not a peg to rank
    return {vid: x.vid, ticker: x.s.ticker, name: x.s.name, logo: x.s.logo || null, symbol: x.v.symbol, chain: x.v.chain, issuer: x.v.issuer,
      n: pts.length, typical: median(abs) / 1e4, within: abs.filter(b => b <= FAIR_BP).length / abs.length, worst: Math.max(...abs) / 1e4,
      depth: x.v.liquidity || 0, volume: x.v.volume24h || 0, spark: pts.slice(-48).map(p => [p[0] * 3.6e6, p[1] / 1e4])};
  }).filter(Boolean);
  const most = Math.max(0, ...rows.map(r => r.n)), need = Math.max(3, Math.ceil(most / 2));
  return {since: since ? Number(since) * 3.6e6 : null, hours: most, days,
    tokens: rows.filter(r => r.n >= need).sort((a, b) => a.typical - b.typical || b.within - a.within || b.depth - a.depth)};
}

module.exports = {record, token, issuers, ranking, K, hourNow};
