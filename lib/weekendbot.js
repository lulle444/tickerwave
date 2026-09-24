// Weekend signal on Telegram: people subscribe with /weekend (or the button on /weekend) and get two messages a week,
// Sunday afternoon with the tokens' call and Monday after the opening bell with how it turned out.
const {send, esc} = require("./telegram");
const {redis} = require("./store");
const W = require("./weekend");

const SUBS = "tk:wk:subs";
const sentKey = (w, kind) => `tk:wk:${w}:sent:${kind}`;
const SUNDAY_SEND = 16 * 60;   // 4 pm New York, four hours before trading restarts

const subscribe = chat => redis("SADD", SUBS, String(chat));
const unsubscribe = chat => redis("SREM", SUBS, String(chat));
const isSubscribed = async chat => !!(await redis("SISMEMBER", SUBS, String(chat)));

const pct = g => (g > 0 ? "+" : g < 0 ? "−" : "") + Math.abs(g * 100).toFixed(2) + "%";
const line = s => `${esc(s.k)} ${pct(s.i)}`;

function signalText(snap, site){
  const rows = snap.stocks, spy = rows.find(s => s.k === "SPY");
  const up = rows.filter(s => s.i >= 0.0025).sort((a, b) => b.i - a.i), down = rows.filter(s => s.i <= -0.0025).sort((a, b) => a.i - b.i);
  return `🗓 <b>Weekend signal</b>: where stock tokens say stocks reopen\n\n` +
    (spy ? `S&amp;P 500 (SPY): <b>${pct(spy.i)}</b> vs. Friday’s close\n` : "") +
    (up.length ? `▲ ${up.slice(0, 4).map(line).join(", ")}\n` : "") +
    (down.length ? `▼ ${down.slice(0, 4).map(line).join(", ")}\n` : "") +
    `\n${up.length} of ${rows.length} stocks point up, ${down.length} down. Trading restarts at 8 pm New York time.\n\n${site}/weekend`;
}

function resultText(snap, out, site){
  const sc = W.score(snap, out);
  const rows = snap.stocks.filter(s => out.m[s.k] != null && Math.abs(s.i) >= 0.0025).sort((a, b) => Math.abs(b.i) - Math.abs(a.i)).slice(0, 6);
  return `✅ <b>Weekend signal, scored</b>\n\n` +
    (sc && sc.called ? `Tokens called the direction of Monday’s open right for <b>${sc.right} of ${sc.called}</b> stocks that moved at least 0.25% (${Math.round(sc.right / sc.called * 100)}%). Typical miss ±${(sc.typicalMiss * 100).toFixed(2)}%.\n\n` : "Tokens barely moved this weekend, so there was little to call.\n\n") +
    rows.map(s => `${esc(s.k)}: tokens ${pct(s.i)} → opened ${pct(out.m[s.k])} ${Math.sign(s.i) === Math.sign(out.m[s.k]) ? "✓" : "✗"}`).join("\n") +
    `\n\n${site}/weekend`;
}

// Send one text to every subscriber (of the weekend signal, or another list), once per week and kind.
// Drops chats that blocked the bot.
async function broadcast(week, kind, text, subs = SUBS){
  if (!(await redis("SET", sentKey(week, kind), String(Date.now()), "NX", "EX", 86400 * 30))) return {skipped: true};
  const chats = (await redis("SMEMBERS", subs)) || [];
  let sent = 0, gone = 0;
  for (let i = 0; i < chats.length; i += 20){
    await Promise.all(chats.slice(i, i + 20).map(c => send(c, text, {disable_web_page_preview: true}).then(() => sent++).catch(async e => {
      if (/blocked|deactivated|chat not found|403/i.test(String(e.message))){ gone++; await redis("SREM", subs, String(c)); }
      else console.error(kind + " send:", e.message);
    })));
  }
  return {sent, gone, of: chats.length};
}

// Sunday: send the call once, from 4 pm New York until trading restarts.
async function maybeSendSignal(site, t = Date.now()){
  const et = new Date(new Date(t).toLocaleString("en-US", {timeZone: "America/New_York"}));
  if (et.getDay() !== 0 || et.getHours() * 60 + et.getMinutes() < SUNDAY_SEND) return null;
  const w = W.weekOf(t), raw = await redis("GET", W.K.snap(w));
  if (!raw) return null;
  return broadcast(w, "signal", signalText(JSON.parse(raw), site));
}

// Monday: send the outcome once the opening move is saved.
async function sendResult(site, t = Date.now()){
  const w = W.weekOf(t);
  const [snap, res] = await Promise.all([redis("GET", W.K.snap(w)), redis("GET", W.K.res(w))]);
  if (!snap || !res || !JSON.parse(res).open) return null;
  return broadcast(w, "result", resultText(JSON.parse(snap), JSON.parse(res).open, site));
}

module.exports = {subscribe, unsubscribe, isSubscribed, signalText, resultText, maybeSendSignal, sendResult, broadcast, SUBS};
