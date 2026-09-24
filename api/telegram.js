// Telegram webhook for the alerts bot.
const B = require("../brand.json");
const {send, tg, esc, webhookSecret} = require("../lib/telegram");
const {redis} = require("../lib/store");
const {currentBoard, spreadOf, THIN} = require("../lib/board");
const A = require("../lib/alerts");
const WB = require("../lib/weekendbot");
const W = require("../lib/weekend");

const LEVELS = [0.5, 1, 2];
const TICK = /^[A-Z0-9.]{1,12}$/;
const num = x => parseFloat(String(x || "").replace(",", ".").replace("%", "").replace("±", ""));
const chainName = (board, id) => (board.chains.find(c => c.id === id) || {}).name || id;

// A token symbol (TSLAx, TSLAon, TSLA) or a version id (TSLAx_solana) -> its deepest matching version.
function findVersion(board, q){
  const [sym, chain] = String(q).replace(/-/g, ".").split("_");
  const all = board.stocks.flatMap(s => s.versions.map(v => ({s, v})))
    .filter(({v}) => v.symbol.toLowerCase() === sym.toLowerCase() && (!chain || v.chain === chain));
  return all.sort((a, b) => (b.v.liquidity || 0) - (a.v.liquidity || 0))[0] || null;
}
const findStock = (board, t) => board.stocks.find(s => s.ticker === String(t).toUpperCase().replace(/-/g, ".")) || null;

async function gapCard(chat, q){
  const board = await currentBoard(A.SITE), hit = findVersion(board, q);
  if (!hit) return send(chat, `I couldn’t find that token. Pick one on ${A.SITE}`);
  const {s, v} = hit, id = A.vidOf(v);
  await redis("SET", A.K.ctx(chat), "g:" + id, "EX", 86400);
  const now = v.gap == null ? "No live price gap right now." :
    `On chain <b>${A.price(v.onchain)}</b> vs share <b>${A.price(s.ref * (v.multiplier || 1))}</b> (<b>${A.signed(v.gap)}</b>)\nMarket depth ${A.usd(v.liquidity)}`;
  return send(chat, `<b>${esc(v.symbol)} on ${esc(chainName(board, v.chain))}</b> · ${esc(s.name)}\n${now}\n\n` +
    `Ping me when this token trades this far above or below the share price. Tap a level, or send <code>/gap 1.5</code> for your own.`,
    {reply_markup: {inline_keyboard: [LEVELS.map(l => ({text: `🔔 ±${l}%`, callback_data: `g|${id}|${l}`})), [{text: `Open ${B.name}`, url: `${A.SITE}/stock/${encodeURIComponent(s.ticker.replace(/\./g, "-"))}`}]]}});
}

async function spreadCard(chat, t){
  const board = await currentBoard(A.SITE), s = findStock(board, t);
  if (!s) return send(chat, `I couldn’t find that stock. Pick one on ${A.SITE}/spreads`);
  await redis("SET", A.K.ctx(chat), "s:" + s.ticker, "EX", 86400);
  const sp = spreadOf(s);
  const now = sp ? `Cheapest <b>${esc(sp.lo.symbol)}</b> on ${esc(chainName(board, sp.lo.chain))} (${A.signed(sp.lo.gap)}), priciest <b>${esc(sp.hi.symbol)}</b> on ${esc(chainName(board, sp.hi.chain))} (${A.signed(sp.hi.gap)}).\nSpread now <b>${A.pct(sp.spread * 100)}</b>`
    : "It doesn’t trade in two deep markets right now, so there is no spread yet.";
  return send(chat, `<b>${esc(s.ticker)} · ${esc(s.name)}</b>, spread across chains\n${now}\n\n` +
    `Ping me when the gap between its cheapest and priciest token reaches a level. Tap one, or send <code>/spread ${esc(s.ticker)} 1.5</code>.`,
    {reply_markup: {inline_keyboard: [LEVELS.map(l => ({text: `🔔 ${l}%`, callback_data: `s|${s.ticker}|${l}`})), [{text: "Open spreads", url: `${A.SITE}/spreads`}]]}});
}

async function createGap(chat, q, thr){
  if (!(thr >= 0.1 && thr <= 50)) return send(chat, "Pick a level between 0.1% and 50%, like <code>/gap 1.5</code>.");
  const board = await currentBoard(A.SITE), hit = findVersion(board, q);
  if (!hit) return send(chat, `I couldn’t find that token. Pick one on ${A.SITE}`);
  const {s, v} = hit, where = chainName(board, v.chain);
  const r = await A.addAlert(chat, {kind: "gap", key: A.vidOf(v), label: `${v.symbol} on ${where}`, ticker: s.ticker, thr},
    v.gap != null && Math.abs(v.gap * 100) >= thr);
  if (r.error) return send(chat, r.error);
  return send(chat, `${r.dup ? "You already have this one" : "Done"}. I’ll message you when <b>${esc(v.symbol)} on ${esc(where)}</b> trades <b>${A.pct(thr)}</b> or more above or below the share price` +
    `${v.gap != null ? ` (now ${A.signed(v.gap)})` : ""}. Checked every 5 minutes while the US market trades.` +
    `${!(v.liquidity >= THIN) ? "\n\nNote: its market holds under $10k, so one small trade can swing the price. I’ll only alert once it’s deeper." : ""}\n\nSee all your alerts with /list.`);
}

async function createSpread(chat, t, thr){
  if (!(thr >= 0.1 && thr <= 50)) return send(chat, "Pick a level between 0.1% and 50%, like <code>/spread TSLA 1</code>.");
  const board = await currentBoard(A.SITE), s = TICK.test(String(t).toUpperCase()) && findStock(board, t);
  if (!s) return send(chat, `I couldn’t find that stock. Pick one on ${A.SITE}/spreads`);
  const sp = spreadOf(s);
  const r = await A.addAlert(chat, {kind: "spread", key: s.ticker, label: `${s.ticker} spread across chains`, ticker: s.ticker, thr},
    sp != null && sp.spread * 100 >= thr);
  if (r.error) return send(chat, r.error);
  return send(chat, `${r.dup ? "You already have this one" : "Done"}. I’ll message you when <b>${esc(s.ticker)}</b>’s cheapest and priciest tokens are <b>${A.pct(thr)}</b> or more apart` +
    `${sp ? ` (now ${A.pct(sp.spread * 100)})` : ""}. Only markets over $10k count.\n\nSee all your alerts with /list.`);
}

async function list(chat){
  const alerts = await A.listAlerts(chat);
  const lines = alerts.map((a, i) => `${i + 1}. ${esc(a.label)}: ${a.kind === "gap" ? "±" : ""}${A.pct(a.thr)}`);
  const rows = alerts.map((a, i) => [{text: `Remove ${i + 1}`, callback_data: `d|${a.id}`}]);
  rows.push([{text: `Open ${B.name}`, url: A.SITE}]);
  return send(chat, lines.length ? "<b>Your alerts</b>\n" + lines.join("\n") : `You have no alerts yet. Tap 🔔 next to any token on ${A.SITE} or any stock on ${A.SITE}/spreads.`,
    {reply_markup: {inline_keyboard: rows}});
}

async function weekend(chat){
  await WB.subscribe(chat);
  const v = await W.view().catch(() => null), l = v && v.latest && v.latest.snap;
  const now = v && v.closed && l && l.week === W.weekOf() ? "\n\nRight now:\n" + WB.signalText(l, A.SITE).split("\n\n").slice(1, 2).join("") : "";
  return send(chat, `🗓 <b>You’re in for the weekend signal.</b>\n\nEvery Sunday afternoon (New York time) I’ll send where stock tokens say stocks will reopen, and on Monday after the opening bell how the call turned out.${now}`,
    {reply_markup: {inline_keyboard: [[{text: "Open the weekend signal", url: `${A.SITE}/weekend`}], [{text: "Stop weekend updates", callback_data: "w|off"}]]}});
}

const WELCOME = `<b>${esc(B.name)} alerts</b> for stock tokens on every chain.\n\n` +
  `• <code>/gap TSLAx 1</code>: when a token trades 1% or more away from the share price.\n` +
  `• <code>/spread TSLA 1</code>: when the cheapest and priciest TSLA tokens across chains are 1% or more apart.\n` +
  `• /weekend: every Sunday, where tokens say stocks reopen, and Monday how it turned out.\n` +
  `• /list to see or remove your alerts, /stop to remove everything.\n\n` +
  `Or tap 🔔 next to a token on ${A.SITE}. Checked every 5 minutes. Not financial advice.`;

async function onMessage(m){
  const chat = m.chat.id, text = String(m.text || "").trim();
  const [cmd, ...args] = text.split(/\s+/); const c = cmd.toLowerCase().replace(/@\w+$/, "");
  if (c === "/start"){
    const pl = args[0] || "";
    if (/^g_[A-Za-z0-9-]{1,16}_[a-z]{2,12}$/.test(pl)) return gapCard(chat, pl.slice(2));
    if (/^s_[A-Za-z0-9-]{1,12}$/.test(pl)) return spreadCard(chat, pl.slice(2));
    if (pl === "wk") return weekend(chat);
    return send(chat, WELCOME, {reply_markup: {inline_keyboard: [[{text: `Open ${B.name}`, url: A.SITE}]]}});
  }
  if (c === "/gap" || c === "/spread"){
    const kind = c.slice(1);
    if (args.length >= 2) return kind === "gap" ? createGap(chat, args[0], num(args[1])) : createSpread(chat, args[0], num(args[1]));
    if (args.length === 1 && isNaN(num(args[0]))) return kind === "gap" ? gapCard(chat, args[0]) : spreadCard(chat, args[0]);
    const ctx = String(await redis("GET", A.K.ctx(chat)) || "");
    if (ctx.startsWith(kind[0] + ":")) return kind === "gap" ? createGap(chat, ctx.slice(2), num(args[0])) : createSpread(chat, ctx.slice(2), num(args[0]));
    return send(chat, kind === "gap" ? "Tell me which token, like <code>/gap TSLAx 1</code>." : "Tell me which stock, like <code>/spread TSLA 1</code>.");
  }
  if (c === "/weekend") return args[0] && /^(off|stop)$/i.test(args[0]) ? WB.unsubscribe(chat).then(() => send(chat, "Weekend updates stopped. Send /weekend to start them again.")) : weekend(chat);
  if (c === "/list") return list(chat);
  if (c === "/stop"){
    const [n, wk] = await Promise.all([A.removeAll(chat), WB.unsubscribe(chat)]);
    return send(chat, `Removed ${n} alert${n === 1 ? "" : "s"}${wk ? " and stopped weekend updates" : ""}.`);
  }
  return send(chat, WELCOME);
}

async function onCallback(q){
  const chat = q.message && q.message.chat.id, [kind, a, b] = String(q.data || "").split("|");
  await tg("answerCallbackQuery", {callback_query_id: q.id}).catch(() => {});
  if (!chat) return;
  if (kind === "g") return createGap(chat, a, parseFloat(b));
  if (kind === "s") return createSpread(chat, a, parseFloat(b));
  if (kind === "d"){ await A.removeAlert(chat, a); return list(chat); }
  if (kind === "w" && a === "off"){ await WB.unsubscribe(chat); return send(chat, "Weekend updates stopped. Send /weekend to start them again."); }
}

module.exports = async function handler(req, res){
  if (req.method !== "POST" || req.headers["x-telegram-bot-api-secret-token"] !== webhookSecret())
    return res.status(401).json({error: "unauthorized"});
  try {
    const u = req.body || {};
    if (u.message && u.message.chat && u.message.chat.type === "private") await onMessage(u.message);
    else if (u.callback_query) await onCallback(u.callback_query);
  } catch (e) {
    console.error("telegram webhook:", e);
  }
  res.status(200).json({ok: true});   // always 200 so Telegram doesn't retry a failing update forever
};
