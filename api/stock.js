// One page per stock: /stock/TSLA (rewritten here by vercel.json). Fills templates/stock.html, written by build.py,
// with the stock's name, a summary and links to other stocks, so the title, description and share card fit the stock
// before any script runs. The live prices are filled in by board.js. /sitemap-stocks.xml lists every stock page.
const fs = require("fs"), path = require("path");
const B = require("../brand.json");
const {currentBoard, CHAINS, ISSUERS, THIN} = require("../lib/board");

const SITE = "https://" + B.domain;
const read = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
let TPL, NOTFOUND;

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const slugOf = t => String(t).replace(/\./g, "-");
const chainName = id => (CHAINS.find(c => c.id === id) || {}).name || id;
const issuerName = id => (ISSUERS.find(i => i.id === id) || {}).name || id;
const list = a => a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
const vol = s => (s.versions || []).reduce((t, v) => t + (v.volume24h || 0), 0);

function summary(s){
  const vs = (s.versions || []).filter(v => v.onchain != null);
  const chains = [...new Set(vs.map(v => v.chain))].map(chainName), issuers = [...new Set(vs.map(v => v.issuer))].map(issuerName);
  if (!vs.length) return `${s.name} (${s.ticker}) is tokenized, but none of its tokens has a market deep enough to price right now.`;
  const deep = vs.filter(v => v.liquidity >= THIN).length;
  return `${s.name} (${s.ticker}) trades as ${vs.length === 1 ? "one stock token" : vs.length + " stock tokens"} on ${list(chains)}, issued by ${list(issuers)}. ` +
    `See each version’s price against the real share, how closely it has held its peg${deep > 1 ? ", and which chain is cheapest right now" : ""}.`;
}

function page(s, stocks){
  const slug = slugOf(s.ticker), sum = summary(s);
  const more = stocks.filter(x => x !== s && (x.versions || []).some(v => v.onchain != null)).sort((a, b) => vol(b) - vol(a)).slice(0, 24)
    .map(x => `<a href="/stock/${esc(slugOf(x.ticker))}"><b>${esc(x.ticker)}</b><span>${esc(x.name)}</span></a>`).join("");
  const logo = s.logo ? `<img src="${esc(s.logo)}" alt="" width="44" height="44" onerror="this.remove()">` : "";
  const ld = JSON.stringify({"@context": "https://schema.org", "@type": "WebPage", name: `${s.name} (${s.ticker}) stock tokens`, url: `${SITE}/stock/${slug}`,
    description: sum, isPartOf: {"@type": "WebSite", name: B.name, url: SITE + "/"}}).replace(/</g, "\\u003c");
  return TPL
    .replace(/__TITLE__/g, () => esc(`${s.ticker} stock token: ${s.name} on every chain · ${B.name}`))
    .replace(/__DESC__/g, () => esc(sum))
    .replace("__SUMMARY__", () => esc(sum))
    .replace("__LOGO__", () => logo)
    .replace("__NAME__", () => esc(s.name))
    .replace("__MORE__", () => more)
    .replace(/__SLUG__/g, () => esc(slug))
    .replace(/__TICKER__/g, () => esc(s.ticker))
    .replace("</head>", () => `<script type="application/ld+json">${ld}</script>\n</head>`);
}

module.exports = async function handler(req, res){
  const q = req.query || {};
  TPL = TPL || read("templates/stock.html");
  let board = null;
  try { board = await currentBoard(SITE); } catch (e) { console.error("stock board:", e); }
  const stocks = (board && board.stocks) || [];

  if (q.sitemap){
    if (!stocks.length){ res.setHeader("Cache-Control", "no-store"); return res.status(503).send("board unavailable"); }
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=21600, stale-while-revalidate=86400");
    return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      stocks.map(s => `  <url><loc>${SITE}/stock/${esc(slugOf(s.ticker))}</loc></url>\n`).join("") + "</urlset>\n");
  }

  const want = String(q.t || "");
  const s = /^[A-Za-z0-9.-]{1,16}$/.test(want) && stocks.find(x => slugOf(x.ticker).toUpperCase() === slugOf(want).toUpperCase());
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (!s){
    if (!stocks.length){   // the data is down, not the page: try again soon rather than tell search engines it's gone
      res.setHeader("Cache-Control", "no-store");
      return res.status(503).send(read("404.html").replace("This ticker isn’t listed.", "Prices are unavailable right now."));
    }
    NOTFOUND = NOTFOUND || read("404.html");
    res.setHeader("Cache-Control", "public, s-maxage=600");
    return res.status(404).send(NOTFOUND);
  }
  if (slugOf(s.ticker) !== want){   // one address per stock: /stock/brk.b → /stock/BRK-B
    res.setHeader("Cache-Control", "public, s-maxage=86400");
    return res.redirect(301, "/stock/" + encodeURIComponent(slugOf(s.ticker)));
  }
  res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=86400");
  res.status(200).send(page(s, stocks));
};
