// Scheduled check (the "Warm board" GitHub Action calls it every 5 minutes): once an hour it saves every token's
// distance from its share price (the peg history), and each run it compares the live board with every alert
// and pings Telegram when a level is crossed. Safe to call publicly: a lock allows one run per window,
// and an alert fires only on a crossing, then re-arms once the gap has shrunk back to half its level.
const B = require("../brand.json");
const {send, esc} = require("../lib/telegram");
const {redis, pipeline} = require("../lib/store");
const {currentBoard, spreadOf, marketOpen, THIN} = require("../lib/board");
const A = require("../lib/alerts");
const H = require("../lib/history");

const REARM = 0.5;

module.exports = async function handler(req, res){
  // Until the database is connected there is nothing to save or check; say so without failing.
  if (!(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL))
    return res.status(200).json({skipped: "database not connected yet"});
  if (!marketOpen()) return res.status(200).json({skipped: "US market closed, share prices frozen"});
  try {
    if (!(await redis("SET", A.K.lock, String(Date.now()), "NX", "EX", 240)))
      return res.status(200).json({skipped: "ran recently"});
    const due = !(await redis("EXISTS", H.K.hour(H.hourNow())));
    const raw = process.env.TELEGRAM_BOT_TOKEN ? await redis("HGETALL", A.K.alerts) || [] : [];
    const all = [];
    for (let i = 1; i < raw.length; i += 2) all.push(JSON.parse(raw[i]));
    if (!all.length && !due) return res.status(200).json({alerts: 0});

    const board = await currentBoard(A.SITE);
    const saved = due ? await H.record(board).catch(e => { console.error("peg history:", e); return -1; }) : 0;
    if (!all.length) return res.status(200).json({alerts: 0, saved});
    const chainName = id => (board.chains.find(c => c.id === id) || {}).name || id;
    const byTicker = new Map(board.stocks.map(s => [s.ticker, s]));
    const writes = [], sends = [];

    for (const a of all){
      const s = byTicker.get(a.ticker);
      if (!s || s.ref == null) continue;
      let level = null, msg = "";
      if (a.kind === "gap"){
        const v = s.versions.find(x => A.vidOf(x) === a.key);
        if (!v || v.gap == null || !(v.liquidity >= THIN) || v.halted) continue;
        level = Math.abs(v.gap * 100);
        msg = `⚖️ <b>${esc(v.symbol)} on ${esc(chainName(v.chain))}</b> is trading <b>${level.toFixed(2)}% ${v.gap > 0 ? "above" : "below"}</b> the ${esc(s.ticker)} share price (your level: ±${A.pct(a.thr)}).\n` +
          `On chain ${A.price(v.onchain)} vs share ${A.price(s.ref * (v.multiplier || 1))} · depth ${A.usd(v.liquidity)}\n\n${A.SITE}/?s=${encodeURIComponent(s.ticker)}`;
      } else if (a.kind === "spread"){
        const sp = spreadOf(s);
        if (!sp) continue;
        level = sp.spread * 100;
        msg = `↔️ <b>${esc(s.ticker)}</b> tokens are <b>${level.toFixed(2)}%</b> apart across chains (your level: ${A.pct(a.thr)}).\n` +
          `Cheapest ${esc(sp.lo.symbol)} on ${esc(chainName(sp.lo.chain))} ${A.price(sp.lo.onchain)} (${A.signed(sp.lo.gap)})\n` +
          `Priciest ${esc(sp.hi.symbol)} on ${esc(chainName(sp.hi.chain))} ${A.price(sp.hi.onchain)} (${A.signed(sp.hi.gap)})\n\n${A.SITE}/spreads`;
      } else continue;
      const hit = level >= a.thr;
      if (hit && a.armed){
        a.armed = false; a.lastFired = Date.now();
        sends.push([a.chat, msg]);
        writes.push(["HSET", A.K.alerts, a.id, JSON.stringify(a)]);
      } else if (!hit && !a.armed && level < a.thr * REARM){
        a.armed = true; writes.push(["HSET", A.K.alerts, a.id, JSON.stringify(a)]);
      }
    }

    await pipeline(writes);
    const results = await Promise.allSettled(sends.map(([c, t]) => send(c, t)));
    const failed = results.filter(r => r.status === "rejected");
    failed.forEach(r => console.error("send failed:", r.reason && r.reason.message));
    res.status(200).json({alerts: all.length, saved, fired: sends.length, sent: sends.length - failed.length, failed: failed.length});
  } catch (e) {
    console.error("check-alerts:", e);
    res.status(500).json({error: String(e.message || e)});
  }
};
