// Weekend signal: from Friday 8 pm to Sunday 8 pm New York time the share prices behind these tokens stand still,
// but the tokens keep trading on chain. Their distance from Friday's close is the market's guess at where each stock
// reopens. Hourly over the weekend we save that guess; after the reopen we save what actually happened.
//   tk:wk:index          list of week ids (the Friday's New York date, e.g. "2026-09-25"), oldest first
//   tk:wk:{week}:snap    latest weekend snapshot: {week, t, stocks: [{k, n, lg, c, i, d, v}]}
//   tk:wk:{week}:res     outcome: {reopen: {t, m: {TICKER: move}}, open: {t, m: {…}}}
const {redis, pipeline} = require("./store");
const {THIN, marketOpen} = require("./board");

const MAX_MOVE = 0.25;   // an implied move bigger than this is a broken market, not a signal
const K = {
  index: "tk:wk:index",
  seen: w => `tk:wk:${w}:seen`,
  hour: h => `tk:wk:hour:${h}`,
  snap: w => `tk:wk:${w}:snap`,
  res: w => `tk:wk:${w}:res`,
};

// New York wall-clock parts for a time.
function ny(t = Date.now()){
  const d = new Date(new Date(t).toLocaleString("en-US", {timeZone: "America/New_York"}));
  return {d, day: d.getDay(), min: d.getHours() * 60 + d.getMinutes()};
}
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
// The week a moment belongs to: the most recent Friday (New York date), counting Friday itself.
function weekOf(t = Date.now()){
  const {d, day} = ny(t);
  d.setDate(d.getDate() - ((day - 5 + 7) % 7));
  return ymd(d);
}

// Depth-weighted guess for one stock from its deep token markets with a known share ratio. Null if none qualify.
function implied(s){
  const vs = (s.versions || []).filter(v => v.gap != null && !v.halted && !v.ratioUnknown && v.liquidity >= THIN && Math.abs(v.gap) < MAX_MOVE);
  if (!vs.length) return null;
  const w = vs.reduce((t, v) => t + v.liquidity, 0);
  return {move: vs.reduce((t, v) => t + v.gap * v.liquidity, 0) / w, depth: w, versions: vs.length};
}

// Friday's close is frozen once the share quote is over an hour old.
const frozen = (s, t) => s.ref != null && s.refAt && t - Date.parse(s.refAt) > 3.6e6;
const fresh = (s, t) => s.ref != null && s.refAt && t - Date.parse(s.refAt) < 30 * 60000;

// Weekend: save this hour's snapshot. Returns the number of stocks saved (0 if this hour is done or nothing qualifies).
async function snapshot(board, t = Date.now()){
  if (marketOpen(new Date(t))) return 0;
  const h = Math.floor(t / 3.6e6);
  if (!(await redis("SET", K.hour(h), "1", "NX", "EX", 7200))) return 0;
  const stocks = [];
  for (const s of board.stocks){
    if (!frozen(s, t)) continue;
    const x = implied(s);
    if (x) stocks.push({k: s.ticker, n: s.name, lg: s.logo || null, c: s.ref, i: +x.move.toFixed(5), d: Math.round(x.depth), v: x.versions});
  }
  if (!stocks.length) return 0;
  const w = weekOf(t);
  const cmds = [["SET", K.snap(w), JSON.stringify({week: w, t, stocks}), "EX", 86400 * 400]];
  if (await redis("SET", K.seen(w), "1", "NX", "EX", 86400 * 400)) cmds.push(["RPUSH", K.index, w], ["LTRIM", K.index, -104, -1]);
  await pipeline(cmds);
  return stocks.length;
}

// Which outcome the current moment can settle: "reopen" from Sunday 8 pm to Monday 9:30, "open" for the rest of Monday.
function phaseOf(t = Date.now()){
  if (!marketOpen(new Date(t))) return null;
  const {day, min} = ny(t);
  return day === 0 || (day === 1 && min < 570) ? "reopen" : day === 1 && min >= 575 ? "open" : null;
}
const settleDue = (t = Date.now()) => !!phaseOf(t);

// After the weekend: save each stock's move from Friday's close, once at the Sunday 8 pm reopen ("reopen")
// and once after Monday's 9:30 regular open ("open"). Returns which outcome was saved, if any.
async function settle(board, t = Date.now()){
  const phase = phaseOf(t), w = weekOf(t);
  if (!phase) return null;
  const [snapRaw, resRaw] = await Promise.all([redis("GET", K.snap(w)), redis("GET", K.res(w))]);
  if (!snapRaw) return null;
  const res = resRaw ? JSON.parse(resRaw) : {};
  if (res[phase]) return null;
  const snap = JSON.parse(snapRaw), live = new Map(board.stocks.filter(s => fresh(s, t)).map(s => [s.ticker, s.ref]));
  const m = {};
  for (const s of snap.stocks) if (live.has(s.k)) m[s.k] = +(live.get(s.k) / s.c - 1).toFixed(5);
  if (!Object.keys(m).length) return null;
  res[phase] = {t, m};
  await redis("SET", K.res(w), JSON.stringify(res), "EX", 86400 * 400);
  return phase;
}

// How good the call was: direction right for stocks the tokens moved at least 0.25%, and the typical miss.
function score(snap, out){
  if (!snap || !out) return null;
  const rows = snap.stocks.filter(s => out.m[s.k] != null);
  const called = rows.filter(s => Math.abs(s.i) >= 0.0025);
  const errs = rows.map(s => Math.abs(out.m[s.k] - s.i)).sort((a, b) => a - b);
  return {stocks: rows.length, called: called.length,
    right: called.filter(s => Math.sign(s.i) === Math.sign(out.m[s.k])).length,
    typicalMiss: errs.length ? errs[errs.length >> 1] : null};
}

// Everything the /weekend page needs.
async function view(t = Date.now()){
  const weeks = (await redis("LRANGE", K.index, -9, -1)) || [];
  const raws = weeks.length ? await pipeline(weeks.flatMap(w => [["GET", K.snap(w)], ["GET", K.res(w)]])) : [];
  const all = weeks.map((w, i) => ({week: w, snap: raws[2 * i] ? JSON.parse(raws[2 * i]) : null, res: raws[2 * i + 1] ? JSON.parse(raws[2 * i + 1]) : null}));
  const latest = all[all.length - 1] || null;
  return {
    closed: !marketOpen(new Date(t)), week: weekOf(t),
    latest: latest && {week: latest.week, snap: latest.snap, res: latest.res},
    past: all.filter(x => x.res && x.res.open).map(x => ({week: x.week, ...score(x.snap, x.res.open)})).reverse(),
  };
}

module.exports = {snapshot, settle, settleDue, view, implied, weekOf, score, K};
