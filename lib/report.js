// Weekly peg report: once the US market closes on Friday, the week's peg ranking is frozen into a short report
// (steadiest and furthest-off tokens, the biggest single-hour miss, each issuer's score) that the /report page, its
// share card and a Telegram message all read. While the market trades, the same report is built live as "this week so far".
//   tk:rep:index        list of week ids (the Friday's New York date, as in lib/weekend.js), oldest first
//   tk:rep:{week}       the frozen report
//   tk:rep:subs         Telegram chats that get it every Friday
const {redis} = require("./store");
const {marketOpen, CHAINS, ISSUERS} = require("./board");
const {esc} = require("./telegram");
const H = require("./history");
const W = require("./weekend");

const K = {index: "tk:rep:index", week: w => `tk:rep:${w}`, subs: "tk:rep:subs"};
const TOP = 5;
const MIN_HOURS = 3;   // fewer readings than this and there is nothing to report

// The report a moment belongs to: while the market trades, the Friday ahead; once it closes, the Friday just past.
function reportWeek(t = Date.now()){
  const w = W.weekOf(t);
  if (!marketOpen(new Date(t))) return w;
  const d = new Date(w + "T12:00:00Z");
  if (w !== nyDate(t)) d.setUTCDate(d.getUTCDate() + 7);   // not Friday yet: the report is for the Friday ahead
  return d.toISOString().slice(0, 10);
}
const nyDate = t => new Date(t).toLocaleDateString("en-CA", {timeZone: "America/New_York"});

const slim = t => ({ticker: t.ticker, name: t.name, logo: t.logo, symbol: t.symbol, chain: t.chain, issuer: t.issuer,
  typical: t.typical, within: t.within, worst: t.worst, n: t.n});

async function build(board, t = Date.now()){
  const [rank, iss, wk] = await Promise.all([H.ranking(board, 7), H.issuers(7), W.view(t).catch(() => null)]);
  const all = rank.tokens || [];
  if (rank.hours < MIN_HOURS || !all.length) return null;
  const swing = all.reduce((a, b) => b.worst > a.worst ? b : a);
  const steady = all.filter(x => x.within >= 0.9).length;
  const last = wk && wk.past && wk.past[0];
  return {
    week: reportWeek(t), t, hours: rank.hours, markets: all.length, chains: new Set(all.map(x => x.chain)).size,
    steady, typical: all.map(x => x.typical).sort((a, b) => a - b)[all.length >> 1],
    best: all.slice(0, TOP).map(slim), worst: all.slice(Math.max(TOP, all.length - TOP)).reverse().map(slim), swing: slim(swing),
    issuers: (iss.issuers || []).filter(i => i.markets).sort((a, b) => a.medianGap - b.medianGap),
    weekend: last && last.called ? {week: last.week, right: last.right, called: last.called} : null,
  };
}

// Friday after the close (and all weekend): freeze this week's report once. Returns the report when it was just saved.
async function freeze(board, t = Date.now()){
  if (marketOpen(new Date(t))) return null;
  const w = W.weekOf(t);
  if (await redis("EXISTS", K.week(w))) return null;
  const r = await build(board, t);
  if (!r) return null;
  r.week = w;
  if (!(await redis("SET", K.week(w), JSON.stringify(r), "NX"))) return null;
  await redis("RPUSH", K.index, w);
  return r;
}

// Everything the /report page needs: the week asked for, else this week (live while the market trades), plus past weeks.
async function view(board, want, t = Date.now()){
  const weeks = ((await redis("LRANGE", K.index, -26, -1)) || []).reverse();
  const pick = want && weeks.includes(want) ? want : !marketOpen(new Date(t)) && weeks[0] === W.weekOf(t) ? weeks[0] : null;
  if (pick) return {report: JSON.parse(await redis("GET", K.week(pick))), live: false, weeks};
  return {report: board ? await build(board, t) : null, live: true, week: reportWeek(t), weeks};
}

// The latest frozen report, or the live one while this week is still trading.
async function latest(board, t = Date.now()){
  const v = await view(board, null, t);
  return v.report ? {...v.report, live: v.live} : null;
}

// The Telegram version.
const chainName = id => (CHAINS.find(c => c.id === id) || {}).name || id;
const issuerName = id => { const i = ISSUERS.find(x => x.id === id) || {}; return i.short || i.name || id; };
const pm = g => "±" + (g * 100).toFixed(2) + "%";
const day = w => new Date(w + "T12:00:00Z").toLocaleDateString("en-US", {month: "short", day: "numeric", timeZone: "UTC"});
const row = (x, i) => `${i + 1}. <b>${esc(x.symbol)}</b> (${esc(chainName(x.chain))}) ${pm(x.typical)}`;

function text(r, site){
  return `📊 <b>Weekly peg report</b>, week to ${day(r.week)}${r.live ? " (so far)" : ""}\n\n` +
    `${r.markets} stock tokens over $10k deep, checked every trading hour (${r.hours} readings). ` +
    `${r.steady} stayed within ±0.5% of their share almost all week.\n\n` +
    `<b>Held the peg best</b>\n${r.best.slice(0, 3).map(row).join("\n")}\n\n` +
    `<b>Furthest from the share</b>\n${r.worst.slice(0, 3).map(row).join("\n")}\n\n` +
    `<b>Biggest miss:</b> ${esc(r.swing.symbol)} on ${esc(chainName(r.swing.chain))}, ${(r.swing.worst * 100).toFixed(2)}% off in its worst hour.\n` +
    (r.issuers.length ? `<b>Issuers:</b> ${r.issuers.map(i => `${esc(issuerName(i.id))} ${pm(i.medianGap)}`).join(", ")} typical gap.\n` : "") +
    (r.weekend ? `<b>Weekend signal:</b> tokens called ${r.weekend.right} of ${r.weekend.called} Monday opens right.\n` : "") +
    `\n${site}/report`;
}

const subscribe = chat => redis("SADD", K.subs, String(chat));
const unsubscribe = chat => redis("SREM", K.subs, String(chat));

module.exports = {build, freeze, view, latest, reportWeek, text, subscribe, unsubscribe, K};
