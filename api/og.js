// Share-preview image (1200×630 PNG) with today's numbers: /api/og?p=home.
// Pages point their og:image here; X and others fetch it when a link is shared. Name, colors and logo come from brand.json.
const B = require("../brand.json");
const {currentBoard, spreadOf, marketOpen} = require("../lib/board");
const W = require("../lib/weekend");
const fs = require("fs"), path = require("path");

let logo;
const logoUri = () => logo || (logo = "data:image/svg+xml;base64," + fs.readFileSync(path.join(__dirname, "..", "assets", "logo-mark.svg")).toString("base64"));

const K = B.colors, F = B.fonts;
const C = {ink: K.ink, muted: K.muted, accent: K.accent, card: K.panel, edge: K.line};

const usd = v => {
  const a = Math.abs(v), s = v < 0 ? "−" : "";
  if (a >= 1e9) return s + "$" + (a / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return s + "$" + (a / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return s + "$" + (a / 1e3).toFixed(a >= 1e5 ? 0 : 1) + "k";
  return s + "$" + a.toFixed(0);
};
const fmtN = n => n.toLocaleString("en-US");
const sgn = g => (g > 0 ? "+" : g < 0 ? "−" : "") + Math.abs(g * 100).toFixed(2) + "%";

// tiny element builder for @vercel/og (it takes React-shaped objects)
const h = (style, ...children) => ({type: "div", props: {style: {display: "flex", ...style}, children: children.flat().filter(c => c != null && c !== false)}});

let fonts;
async function loadFonts(){
  if (fonts) return fonts;
  const want = [[F.display, 600], [F.display, 700], [F.body, 500], [F.mono, 500]];
  const out = [];
  await Promise.all(want.map(async ([name, weight]) => {
    try {
      // without a browser user agent Google Fonts answers with TTF, which the renderer can read
      const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${name.replace(/ /g, "+")}:wght@${weight}`, {signal: AbortSignal.timeout(5000)})).text();
      const url = (css.match(/src: url\((.+?)\) format\('(truetype|opentype)'\)/) || [])[1];
      if (!url) return;
      out.push({name, weight, style: "normal", data: await (await fetch(url, {signal: AbortSignal.timeout(5000)})).arrayBuffer()});
    } catch (e) {}
  }));
  fonts = out;
  return fonts;
}

// What each page's card says: {eyebrow, big, label, stats: [[value, caption] × 3], path}.
const CARDS = {
  async home(site){
    const {stocks, chains, issuers} = await currentBoard(site);
    const V = stocks.flatMap(s => s.versions);
    const multi = stocks.filter(s => new Set(s.versions.map(v => v.chain)).size > 1).length;
    return {
      eyebrow: "Stock tokens · Every chain", big: fmtN(stocks.length),
      label: `stocks tokenized across ${chains.length} chains, ${fmtN(multi)} of them on more than one`,
      stats: [[fmtN(V.length), "token versions"], [usd(V.reduce((t, v) => t + (v.volume24h || 0), 0)), "traded on chain, 24h"], [fmtN(issuers.length), "issuers compared"]],
      path: "",
    };
  },
  async spreads(site){
    const {stocks} = await currentBoard(site);
    const sp = stocks.map(s => ({s, x: spreadOf(s)})).filter(r => r.x).sort((a, b) => b.x.spread - a.x.spread);
    if (!sp.length) return null;
    const w = sp[0], over = sp.filter(r => r.x.spread >= 0.01).length;
    const med = sp.map(r => r.x.spread).sort((a, b) => a - b)[sp.length >> 1];
    return {
      eyebrow: "Spreads · Same stock, different price", big: (w.x.spread * 100).toFixed(2) + "%",
      label: `between the cheapest and priciest ${w.s.ticker} token right now: ${w.x.lo.symbol} vs ${w.x.hi.symbol}`,
      stats: [[fmtN(sp.length), "stocks on 2+ chains"], [(med * 100).toFixed(2) + "%", "typical spread"], [fmtN(over), "spreads over 1%"]],
      path: "/spreads",
    };
  },
  async weekend(site){
    const path = "/weekend";
    if (!marketOpen()){
      // live: where tokens trade against Friday's frozen close right now
      const {stocks} = await currentBoard(site), t = Date.now();
      const rows = stocks.filter(s => s.ref != null && s.refAt && t - Date.parse(s.refAt) > 3.6e6).map(s => ({s, x: W.implied(s)})).filter(r => r.x);
      if (rows.length){
        const lead = rows.find(r => r.s.ticker === "SPY") || rows.slice().sort((a, b) => b.x.depth - a.x.depth)[0];
        const big = rows.slice().sort((a, b) => Math.abs(b.x.move) - Math.abs(a.x.move))[0];
        return {eyebrow: "Weekend signal · Live", big: sgn(lead.x.move),
          label: `where ${lead.s.ticker} tokens trade vs. Friday’s close, while the stock market is shut`,
          stats: [[fmtN(rows.filter(r => r.x.move >= 0.0025).length), "stocks pointing up"], [fmtN(rows.filter(r => r.x.move <= -0.0025).length), "pointing down"], [sgn(big.x.move), `biggest: ${big.s.ticker}`]], path};
      }
    }
    try {
      const v = await W.view(), l = v.latest, out = l && l.res && (l.res.open || l.res.reopen);
      if (out){
        const sc = W.score(l.snap, out);
        if (sc && sc.called) return {eyebrow: "Weekend signal · Last weekend", big: `${sc.right}/${sc.called}`,
          label: `stocks where weekend token trading called the direction of ${l.res.open ? "Monday’s open" : "the Sunday reopen"}`,
          stats: [[fmtN(sc.stocks), "stocks tracked"], [Math.round(sc.right / sc.called * 100) + "%", "direction right"], [sc.typicalMiss == null ? "–" : "±" + (sc.typicalMiss * 100).toFixed(2) + "%", "typical miss"]], path};
      }
    } catch (e) {}
    return {eyebrow: "Weekend signal", big: "Fri–Sun",
      label: "The stock market closes for the weekend. Stock tokens don’t. See where they say every stock reopens on Monday.",
      stats: [["24/7", "tokens keep trading"], ["Hourly", "readings all weekend"], ["Monday", "checked against the open"]], path};
  },
};

function card(c, logo){
  const [w1, w2] = B.wordmark;
  const stat = ([v, cap]) => h({flexDirection: "column", padding: "22px 28px", borderRadius: 12, background: C.card, border: `1px solid ${C.edge}`, flex: 1},
    h({fontFamily: F.mono, fontWeight: 500, fontSize: 38, color: C.ink}, v),
    h({fontFamily: F.body, fontSize: 22, color: C.muted, marginTop: 4}, cap));
  return h({width: 1200, height: 630, flexDirection: "column", padding: "56px 64px", fontFamily: F.body, color: C.ink,
      backgroundColor: K.bg, backgroundImage: `radial-gradient(900px 520px at 95% -15%, ${K.accent2}40 0%, ${K.bg}00 65%), radial-gradient(700px 400px at 0% 110%, ${K.accent}1A 0%, ${K.bg}00 60%)`},
    h({alignItems: "center", justifyContent: "space-between"},
      h({alignItems: "center"},
        {type: "img", props: {src: logo, width: 52, height: 52, style: {marginRight: 16}}},
        h({fontFamily: F.display, fontWeight: 600, fontSize: 30, letterSpacing: -0.5, color: C.ink}, w1, h({color: C.accent}, w2))),
      h({fontFamily: F.display, fontWeight: 600, fontSize: 20, letterSpacing: 1, color: C.accent, textTransform: "uppercase"}, c.eyebrow)),
    h({flexDirection: "column", marginTop: 46, flex: 1},
      h({fontFamily: F.display, fontWeight: 700, fontSize: 132, lineHeight: 1, color: C.accent, letterSpacing: -3}, c.big),
      h({fontFamily: F.body, fontWeight: 500, fontSize: 34, color: C.ink, marginTop: 18, maxWidth: 1000, lineHeight: 1.25}, c.label)),
    h({gap: 20}, c.stats.map(stat)),
    h({marginTop: 22, fontSize: 20, color: C.muted, justifyContent: "space-between"},
      h({}, B.domain + c.path), h({}, "Live on-chain data · Not financial advice")));
}

module.exports = async function handler(req, res){
  const p = String((req.query || {}).p || "home");
  const fallback = () => { res.setHeader("Cache-Control", "public, s-maxage=600"); res.redirect(302, "/assets/logo-mark.svg"); };
  if (!CARDS[p]) return fallback();
  try {
    const site = "https://" + (req.headers["x-forwarded-host"] || req.headers.host || B.domain);
    const [c, f, {ImageResponse}] = await Promise.all([CARDS[p](site), loadFonts(), import("@vercel/og")]);
    if (!c) return fallback();
    const img = new ImageResponse(card(c, logoUri()), {width: 1200, height: 630, fonts: f.length ? f : undefined});
    const buf = Buffer.from(await img.arrayBuffer());
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", `public, s-maxage=${p === "weekend" ? 900 : 3600}, stale-while-revalidate=86400`);
    res.status(200).end(buf);
  } catch (e) {
    console.error("og", p, e);
    fallback();
  }
};
