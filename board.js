/* The stock board: every stock, each of its token versions on every chain, priced against the real share. */
(function(){
"use strict";
const API_URL = "/api/board";
const FAIR = 0.005;        // gaps within ±0.5% count as fairly priced
const THIN = 10000;        // markets shallower than this move on small trades, so their gap means little
const STALE_MIN = 30;      // a share price older than this is treated as paused (market closed)
const PAGE = 25;

const $ = id => document.getElementById(id);
const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmtUsd = v => {
  if (v == null || !isFinite(v)) return "–";
  const a = Math.abs(v);
  if (a >= 1e9) return "$" + (v/1e9).toFixed(2) + "B";
  if (a >= 1e6) return "$" + (v/1e6).toFixed(a >= 1e8 ? 0 : 1) + "M";
  if (a >= 1e3) return "$" + (v/1e3).toFixed(a >= 1e5 ? 0 : 1) + "k";
  return "$" + v.toFixed(0);
};
const fmtPrice = v => v == null || !isFinite(v) ? "–" : "$" + v.toLocaleString("en-US", {minimumFractionDigits:2, maximumFractionDigits: v < 1 ? 4 : 2});
const fmtGap = g => g == null ? "–" : (g > 0 ? "+" : g < 0 ? "−" : "") + Math.abs(g * 100).toFixed(2) + "%";
const bandOf = g => g == null ? "none" : g > FAIR ? "premium" : g < -FAIR ? "discount" : "fair";

const BOT = document.body.dataset.bot || "";   // Telegram bot username from brand.json; empty hides the bells
const BELL = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
const vidOf = v => `${v.symbol}_${v.chain}`.replace(/\./g, "-");
const bell = (start, label) => BOT ? `<a class="bell" href="https://t.me/${BOT}?start=${encodeURIComponent(start)}" target="_blank" rel="noopener" title="${esc(label)}" aria-label="${esc(label)}">${BELL}</a>` : "";
const state = {stocks:[], chains:[], issuers:[], chain:"all", multi:false, q:"", sort:"volume24h", dir:-1, limit:PAGE, open:null, paused:false};
const chainName = id => (state.chains.find(c => c.id === id) || {}).name || id;
const issuerOf = id => state.issuers.find(i => i.id === id) || {id, name: id};

/* ---------- market clock: US shares trade 24/5 at the brokers that quote these tokens ---------- */
function marketSession(now = new Date()){
  const et = new Date(now.toLocaleString("en-US", {timeZone:"America/New_York"}));
  const day = et.getDay(), m = et.getHours() * 60 + et.getMinutes();
  const weekend = day === 6 || (day === 5 && m >= 1200) || (day === 0 && m < 1200);
  if (weekend) return {key:"closed", label:"Closed for the weekend"};
  if (m >= 570 && m < 960) return {key:"open", label:"Regular session"};
  if (m >= 240 && m < 570) return {key:"open", label:"Pre-market"};
  if (m >= 960 && m < 1200) return {key:"open", label:"After hours"};
  return {key:"open", label:"Overnight session"};
}

/* ---------- data ---------- */
function prep(s){
  const stale = !s.refAt || (Date.now() - Date.parse(s.refAt)) / 60000 > STALE_MIN;
  const versions = (s.versions || []).map(v => ({...v, thin: !(v.liquidity >= THIN), band: bandOf(v.gap)}))
    .sort((a, b) => (b.liquidity || 0) - (a.liquidity || 0));
  const deep = versions.filter(v => v.gap != null && !v.thin);
  const best = deep.slice().sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap))[0] || null;
  return {...s, versions, stale, best, bestGap: best ? -Math.abs(best.gap) : null,
    count: versions.length, chainIds: [...new Set(versions.map(v => v.chain))],
    liquidity: versions.reduce((t, v) => t + (v.liquidity || 0), 0) || null,
    volume24h: versions.reduce((t, v) => t + (v.volume24h || 0), 0) || null};
}

async function load(){
  try {
    const r = await fetch(API_URL, {headers:{accept:"application/json"}});
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    if (!j.stocks || !j.stocks.length) throw new Error("empty");
    state.chains = j.chains || []; state.issuers = j.issuers || [];
    state.stocks = j.stocks.map(prep);
    const at = new Date(j.updatedAt || Date.now());
    $("dot").className = "dot live";
    set("sourceText", "Live · " + at.toLocaleTimeString("en-US", {hour:"2-digit", minute:"2-digit"}));
    set("updated", "Updated " + at.toLocaleString("en-US", {dateStyle:"medium", timeStyle:"short"}));
    render();
  } catch (e) {
    $("dot").className = "dot sample";
    set("sourceText", "Data unavailable");
    if ($("spreadRows")) $("spreadRows").innerHTML = `<tr><td colspan="6" class="empty">Live prices couldn’t be loaded right now. Please try again in a minute.</td></tr>`;
    if ($("chainGrid")) $("chainGrid").innerHTML = `<p class="muted">Live data couldn’t be loaded right now. Please try again in a minute.</p>`;
    if ($("rows")){
      set("mkt", "Prices are temporarily unavailable.");
      $("rows").innerHTML = `<tr><td colspan="6" class="empty">Live prices couldn’t be loaded right now. Please try again in a minute.</td></tr>`;
      set("count", "");
    }
  }
}

/* ---------- render ---------- */
function renderGauge(){
  const S = state.stocks, V = S.flatMap(s => s.versions);
  set("gStocks", S.length);
  set("gStocksSub", `${S.filter(s => s.chainIds.length > 1).length} on more than one chain`);
  set("gVersions", V.length);
  const pl = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  set("gVersionsSub", `${pl(state.issuers.length, "issuer")} on ${pl(state.chains.length, "chain")}`);
  const deep = V.filter(v => v.gap != null && !v.thin && !v.ratioUnknown && !v.halted);
  const off = deep.filter(v => Math.abs(v.gap) > 0.01);
  set("gOff", deep.length ? off.length : "–");
  set("gOffSub", !deep.length ? "Needs live share prices" : state.paused ? `of ${deep.length} deep markets · shares paused` : `of ${deep.length} deep markets, over 1% away`);
  const perIssuer = {};
  for (const s of S) if (s.best && s.versions.filter(v => v.gap != null && !v.thin).length > 1) perIssuer[s.best.issuer] = (perIssuer[s.best.issuer] || 0) + 1;
  const top = Object.entries(perIssuer).sort((a, b) => b[1] - a[1])[0];
  set("gBest", top ? issuerOf(top[0]).name : "–");
  set("gBestSub", top ? `Tracks the share best for ${top[1]} stocks` : "Needs stocks on 2+ chains");
}

function renderMarket(){
  const s = marketSession(), newest = Math.max(0, ...state.stocks.map(r => r.refAt ? Date.parse(r.refAt) : 0));
  const pausedSince = newest && (Date.now() - newest) / 60000 > STALE_MIN ? new Date(newest) : null;
  state.paused = s.key === "closed" || !!pausedSince;
  const el = $("mkt");
  el.className = "mkt " + (state.paused ? "closed" : "open");
  el.innerHTML = state.paused
    ? `<b>US market ${s.key === "closed" ? "closed for the weekend" : "paused"}.</b> Share prices are frozen while tokens keep trading, so gaps now say more about expectations than mispricing.`
    : `<b>${esc(s.label)}.</b> Share prices are live, refreshed every minute.`;
}

function renderChips(){
  const box = $("chainChips");
  if (box.dataset.ready) return;
  box.dataset.ready = "1";
  box.innerHTML = `<button class="chip" data-chain="all" aria-pressed="true">All chains</button>` +
    state.chains.map(c => `<button class="chip" data-chain="${esc(c.id)}" aria-pressed="false">${esc(c.name)}</button>`).join("");
}

function renderIssuers(){
  const box = $("issuers");
  if (!box) return;
  box.innerHTML = state.issuers.map(i => {
    const V = state.stocks.flatMap(s => s.versions.filter(v => v.issuer === i.id));
    const chains = [...new Set(V.map(v => v.chain))].map(chainName);
    return `<article class="panel issuer">
      <p class="eyebrow">${esc(chains.join(" · "))}</p>
      <h3>${esc(i.name)}</h3>
      <p>${esc(i.about || "")}</p>
      <dl><div><dt>Stocks</dt><dd class="num">${V.length}</dd></div><div><dt>24h volume</dt><dd class="num">${fmtUsd(V.reduce((t, v) => t + (v.volume24h || 0), 0))}</dd></div></dl>
      ${pegScore(i.id)}
      ${i.url ? `<a class="trade" href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.name)} website ↗</a>` : ""}
    </article>`;
  }).join("");
}

/* ---------- peg history: saved hourly by the server, read from /api/history ---------- */
const peg = {issuers: null, tokens: new Map()};
function loadPegScores(){
  fetch("/api/history?p=issuers&days=7").then(r => r.json()).then(j => { peg.issuers = j; renderIssuers(); }).catch(() => {});
}
function pegScore(id){
  const h = peg.issuers;
  if (!h) return "";
  const r = (h.issuers || []).find(x => x.id === id);
  if (!r){
    const noRatio = state.stocks.some(s => s.versions.some(v => v.issuer === id && v.ratioUnknown));
    return `<p class="pegscore muted">${noRatio ? "No peg score: this issuer doesn’t publish its share ratios." : h.hours ? "No deep markets to score yet." : "Peg score starts once the first hourly reading is saved."}</p>`;
  }
  const since = h.since ? new Date(h.since).toLocaleDateString("en-US", {month: "short", day: "numeric"}) : "";
  const young = h.hours < 24;
  return `<div class="pegscore"><p class="eyebrow">Peg score${young ? " · early" : ""}</p>
    <dl><div><dt>Typical gap</dt><dd class="num">±${(r.medianGap * 100).toFixed(2)}%</dd></div><div><dt>Within ±0.5%</dt><dd class="num">${r.withinFair == null ? "–" : Math.round(r.withinFair * 100) + "%"}</dd></div></dl>
    <small>${young ? `Based on ${h.hours} hourly reading${h.hours === 1 ? "" : "s"} since ${since}. Firms up over the week.` : `Past ${h.days} days, ${h.hours} hourly readings, up to ${r.markets} markets over $10k.`}</small></div>`;
}
// Sparkline of one token's distance from its share: the dashed centre line is the peg.
function sparkline(pts){
  const W = 96, H = 26, P = 2, t0 = pts[0][0], t1 = pts[pts.length - 1][0] || t0 + 1;
  const m = Math.max(0.005, ...pts.map(p => Math.abs(p[1])));
  const x = t => P + (W - 2 * P) * (t1 === t0 ? 1 : (t - t0) / (t1 - t0)), y = g => H / 2 - (H / 2 - P) * g / m;
  const d = pts.map((p, i) => (i ? "L" : "M") + x(p[0]).toFixed(1) + " " + y(p[1]).toFixed(1)).join("");
  const typ = [...pts.map(p => Math.abs(p[1]))].sort((a, b) => a - b)[pts.length >> 1];
  const days = Math.max(1, Math.round((t1 - t0) / 864e5));
  const label = `Peg history, ${pts.length} hourly readings over ${days} day${days === 1 ? "" : "s"}: typically ±${(typ * 100).toFixed(2)}% from the share`;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${label}"><title>${label}</title>
    <path d="M${P} ${H / 2}H${W - P}" class="spark-peg"/><path d="${d}" class="spark-line"/><circle cx="${x(pts[pts.length - 1][0]).toFixed(1)}" cy="${y(pts[pts.length - 1][1]).toFixed(1)}" r="2.2" class="spark-dot"/></svg>`;
}
function fillSparks(){
  document.querySelectorAll(".sparkcell[data-vid]").forEach(el => {
    const vid = el.dataset.vid, have = peg.tokens.get(vid);
    const draw = pts => { el.innerHTML = pts && pts.length >= 3 ? sparkline(pts.slice(-24 * 7)) : '<small class="muted">History starting</small>'; };
    if (have !== undefined){ if (have !== "loading") draw(have); return; }
    peg.tokens.set(vid, "loading");
    fetch("/api/history?v=" + encodeURIComponent(vid)).then(r => r.json()).then(j => { peg.tokens.set(vid, j.points || []); fillSparks(); })
      .catch(() => { peg.tokens.set(vid, []); fillSparks(); });
  });
}

function filtered(){
  const q = state.q.trim().toLowerCase();
  return state.stocks.filter(s =>
    (state.chain === "all" || s.chainIds.includes(state.chain)) &&
    (!state.multi || s.chainIds.length > 1) &&
    (!q || s.ticker.toLowerCase().includes(q) || (s.name || "").toLowerCase().includes(q) || s.versions.some(v => v.symbol.toLowerCase().includes(q))));
}

function gapPill(v, soft){
  if (!v || v.gap == null) return `<span class="muted">${v && v.onchain == null ? "No market" : "–"}</span>`;
  const label = {premium:"Premium", discount:"Discount", fair:"Fair"}[v.band];
  return `<span class="gap ${v.band}${soft || v.thin ? " soft" : ""}"><span class="num">${fmtGap(v.gap)}</span><small>${label}</small></span>`;
}

const chainTag = id => `<span class="chaintag c-${esc(id)}">${esc(chainName(id))}</span>`;

function detailRow(s){
  const rows = s.versions.map(v => `<tr>
      <td><b>${esc(v.symbol)}</b><small class="sub2">${esc(issuerOf(v.issuer).name)}</small></td>
      <td>${chainTag(v.chain)}</td>
      <td class="r num">${fmtPrice(v.onchain)}${v.ratioUnknown ? '<small class="sub2">ratio not published</small>' : v.multiplier && Math.abs(v.multiplier - 1) > 1e-6 ? `<small class="sub2">${v.multiplier.toFixed(4)} shares</small>` : ""}</td>
      <td class="r">${gapPill(v, s.stale)}</td>
      <td class="hm sparkcell" data-vid="${esc(vidOf(v))}"></td>
      <td class="r num hm">${fmtUsd(v.liquidity)}${v.thin && v.onchain != null ? '<small class="sub2 warn">thin</small>' : ""}</td>
      <td class="r num hm">${fmtUsd(v.volume24h)}</td>
      <td class="r"><div class="acts">${v.url ? `<a class="trade" href="${esc(v.url)}" target="_blank" rel="noopener" aria-label="View the ${esc(v.symbol)} market">Market ↗</a>` : ""}${bell("g_" + vidOf(v), `Telegram alert when ${v.symbol} on ${chainName(v.chain)} drifts from the share price`)}</div></td>
    </tr>`).join("");
  return `<tr class="detail"><td colspan="6"><div class="lbdetail">
    <table class="lbsub"><thead><tr><th>Token</th><th>Chain</th><th class="r">On chain</th><th class="r">Gap</th><th class="hm">Peg history</th><th class="r hm">Depth</th><th class="r hm">24h volume</th><th class="r"><span class="visually-hidden">Link</span></th></tr></thead><tbody>${rows}</tbody></table>
    <p class="lbfoot">Gap compares each token with the share price × its share ratio (the shares one token stands for after dividends and splits). Where an issuer doesn’t publish its ratio we assume one share, so the gap can be off by past dividends. Depth and volume are for the token’s markets on that chain.</p>
  </div></td></tr>`;
}

function fitDetail(){
  const d = document.querySelector(".lbdetail"), tb = d && d.closest(".tablebox");
  if (d) d.style.width = Math.max(260, tb.clientWidth - 2) + "px";
}

function renderTable(){
  const list = filtered().sort((a, b) => {
    const k = state.sort, x = a[k], y = b[k];
    if (typeof x === "string") return state.dir * x.localeCompare(y);
    return state.dir * ((x ?? -Infinity) - (y ?? -Infinity)) || a.ticker.localeCompare(b.ticker);
  });
  const shown = list.slice(0, state.limit);
  $("rows").innerHTML = shown.length ? shown.map(s => `<tr class="srow${state.open === s.ticker ? " is-open" : ""}" data-sym="${esc(s.ticker)}">
      <td><button class="ticker" type="button" aria-expanded="${state.open === s.ticker}" aria-label="${esc(s.ticker)}, ${esc(s.name)}: show every version">${s.logo ? `<img src="${esc(s.logo)}" alt="" width="28" height="28" loading="lazy" onerror="this.remove()">` : ""}<span class="proto"><b class="asset">${esc(s.ticker)}</b><span>${esc(s.name)}</span></span><span class="chev" aria-hidden="true">›</span></button></td>
      <td class="r num">${fmtPrice(s.ref)}${s.stale ? '<small class="sub2">paused</small>' : ""}</td>
      <td><div class="chaintags">${s.chainIds.map(chainTag).join("")}</div></td>
      <td class="r">${s.best ? `${gapPill(s.best, s.stale)}<small class="sub2">${esc(s.best.symbol)} · ${esc(chainName(s.best.chain))}</small>` : '<span class="muted">–</span>'}</td>
      <td class="r num">${fmtUsd(s.liquidity)}</td>
      <td class="r num">${fmtUsd(s.volume24h)}</td>
    </tr>${state.open === s.ticker ? detailRow(s) : ""}`).join("") : `<tr><td colspan="6" class="empty">No stocks match these filters.</td></tr>`;
  set("count", `Showing ${shown.length} of ${list.length} stocks`);
  $("showMore").hidden = list.length <= state.limit;
  fitDetail();
  if (state.open) fillSparks();
  document.querySelectorAll("th button[data-sort]").forEach(b => {
    const on = b.dataset.sort === state.sort;
    b.closest("th").setAttribute("aria-sort", on ? (state.dir > 0 ? "ascending" : "descending") : "none");
    b.textContent = b.textContent.replace(/ [↓↑]$/, "") + (on ? (state.dir < 0 ? " ↓" : " ↑") : "");
  });
}


/* ---------- ticker tape (every page) ---------- */
function renderTape(){
  const track = $("tapeTrack");
  if (!track) return;
  const items = state.stocks.flatMap(s => s.versions.filter(v => v.gap != null && !v.thin).map(v => ({s, v})))
    .sort((a, b) => (b.v.volume24h || 0) - (a.v.volume24h || 0)).slice(0, 40);
  if (!items.length) return;
  const cls = g => g > FAIR ? "down" : g < -FAIR ? "up" : "flat";
  const ul = `<ul>${items.map(({s, v}) => `<li><b>${esc(v.symbol)}</b><span>${esc(chainName(v.chain))}</span>${fmtPrice(v.onchain)}<span class="${cls(v.gap)}">${fmtGap(v.gap)}</span></li>`).join("")}</ul>`;
  track.innerHTML = ul + ul.replace("<ul>", '<ul aria-hidden="true">');
}

/* ---------- spotlight: one stock, each version's gap as a bar around the share price ---------- */
const spot = {list: [], i: 0, timer: 0};
function pickSpot(){
  const deep = s => s.versions.filter(v => v.gap != null && !v.thin);
  let list = state.stocks.filter(s => deep(s).length > 1);
  if (list.length < 3) list = list.concat(state.stocks.filter(s => deep(s).length === 1 && !list.includes(s)));
  spot.list = list.sort((a, b) => (deep(b).length > 1) - (deep(a).length > 1) || (b.volume24h || 0) - (a.volume24h || 0)).slice(0, 5);
  if (spot.i >= spot.list.length) spot.i = 0;
}
function renderSpot(){
  if (!$("spot") || !spot.list.length) return;
  const s = spot.list[spot.i], vs = s.versions.filter(v => v.gap != null).slice(0, 5);
  const span = Math.max(0.01, ...vs.map(v => Math.abs(v.gap) * 1.25));
  $("spotName").innerHTML = `${esc(s.ticker)} <small>${esc(s.name)}</small>`;
  set("spotRef", fmtPrice(s.ref));
  $("spotRows").innerHTML = vs.map(v => {
    const x = Math.max(-1, Math.min(1, v.gap / span)) * 50;
    return `<li class="spotrow"><div class="who"><b>${esc(v.symbol)}</b><span>${esc(chainName(v.chain))}${v.issuer === "robinhood" ? "" : " · " + esc(issuerOf(v.issuer).short || issuerOf(v.issuer).name)}</span></div>
      <div class="spotbar" role="img" aria-label="${esc(v.symbol)} ${fmtGap(v.gap)} against the share"><i class="${v.band}" style="left:${50 + Math.min(0, x)}%;width:${Math.abs(x)}%"></i></div>
      <div class="g ${v.band}">${fmtGap(v.gap)}</div></li>`;
  }).join("");
  $("spotNav").innerHTML = spot.list.map((x, i) => `<button type="button" data-spot="${i}" aria-pressed="${i === spot.i}" aria-label="${esc(x.ticker)}"></button>`).join("");
}
function spotTick(){
  clearInterval(spot.timer);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  spot.timer = setInterval(() => { if (!document.hidden && spot.list.length > 1){ spot.i = (spot.i + 1) % spot.list.length; renderSpot(); } }, 6000);
}


/* ---------- spreads page ---------- */
const median = a => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
function spreadOf(s, min){
  const vs = s.versions.filter(v => v.gap != null && v.liquidity >= min && !v.halted);
  if (vs.length < 2) return null;
  const lo = vs.reduce((a, b) => b.gap < a.gap ? b : a), hi = vs.reduce((a, b) => b.gap > a.gap ? b : a);
  return {s, lo, hi, spread: hi.gap - lo.gap, depth: Math.min(lo.liquidity, hi.liquidity)};
}
const side = v => `<b class="num">${esc(v.symbol)}</b> ${chainTag(v.chain)}<small class="sub2">${fmtPrice(v.onchain)} · ${fmtGap(v.gap)} vs share</small>`;
function renderSpreads(){
  const min = +($("minDepth") || {}).value || THIN, q = state.q.trim().toLowerCase();
  const all = state.stocks.map(s => spreadOf(s, min)).filter(Boolean).sort((a, b) => b.spread - a.spread);
  const list = all.filter(x => !q || x.s.ticker.toLowerCase().includes(q) || (x.s.name || "").toLowerCase().includes(q));
  set("pStocks", all.length);
  set("pStocksSub", `trade on 2+ chains, ${fmtUsd(min).replace(".0k", "k").replace(".0M", "M")}+ deep`);
  const w = all[0];
  set("pWide", w ? fmtGap(w.spread).replace("+", "") : "–");
  set("pWideSub", w ? `${w.s.ticker}: ${w.lo.symbol} vs ${w.hi.symbol}` : "–");
  const med = median(all.map(x => x.spread));
  set("pMedian", med == null ? "–" : fmtGap(med).replace("+", ""));
  set("pMedianSub", "Median across these stocks");
  const over = all.filter(x => x.spread >= 0.01).length;
  set("pOver", over);
  set("pOverSub", all.length ? `${Math.round(over / all.length * 100)}% of stocks compared` : "–");
  $("spreadRows").innerHTML = list.length ? list.map(x => `<tr>
      <td><a class="ticker plain" href="/?s=${encodeURIComponent(x.s.ticker)}">${x.s.logo ? `<img src="${esc(x.s.logo)}" alt="" width="30" height="30" loading="lazy" onerror="this.remove()">` : ""}<span class="proto"><b class="asset">${esc(x.s.ticker)}</b><span>${esc(x.s.name)}</span></span></a></td>
      <td class="r"><span class="gap ${x.spread >= 0.01 ? "premium" : x.spread >= FAIR ? "warn" : "fair"}"><span class="num">${fmtGap(x.spread).replace("+", "")}</span></span></td>
      <td>${side(x.lo)}</td>
      <td>${side(x.hi)}</td>
      <td class="r num">${fmtUsd(x.depth)}</td>
      <td class="r">${bell("s_" + x.s.ticker.replace(/\./g, "-"), `Telegram alert when ${x.s.ticker}'s spread widens`)}</td>
    </tr>`).join("") : `<tr><td colspan="6" class="empty">No stock trades in two markets this deep right now.</td></tr>`;
  set("count", `${list.length} stocks`);
}

/* ---------- chains page ---------- */
function renderChains(){
  const V = state.stocks.flatMap(s => s.versions.map(v => ({...v, ticker: s.ticker, stale: s.stale})));
  $("chainGrid").innerHTML = state.chains.map(c => {
    const vs = V.filter(v => v.chain === c.id && v.onchain != null);
    const deep = vs.filter(v => v.gap != null && !v.thin);
    const track = median(deep.map(v => Math.abs(v.gap)));
    const issuers = [...new Set(vs.map(v => issuerOf(v.issuer).short || issuerOf(v.issuer).name))];
    const top = vs.slice().sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0)).slice(0, 4);
    return `<article class="panel chaincard">
      <header><span class="chaintag c-${esc(c.id)}">${esc(c.name)}</span><span class="muted">${esc(issuers.join(" · "))}</span></header>
      <dl>
        <div><dt>Stocks trading</dt><dd class="num">${vs.length}</dd></div>
        <div><dt>24h volume</dt><dd class="num">${fmtUsd(vs.reduce((t, v) => t + (v.volume24h || 0), 0))}</dd></div>
        <div><dt>Market depth</dt><dd class="num">${fmtUsd(vs.reduce((t, v) => t + (v.liquidity || 0), 0))}</dd></div>
        <div><dt>Typical gap</dt><dd class="num">${track == null ? "–" : "±" + (track * 100).toFixed(2) + "%"}</dd></div>
      </dl>
      <p class="toplabel">Most traded</p>
      <ul class="toplist">${top.map(v => `<li><a href="/?s=${encodeURIComponent(v.ticker)}"><b class="num">${esc(v.symbol)}</b><span class="num">${fmtUsd(v.volume24h)}</span></a></li>`).join("")}</ul>
    </article>`;
  }).join("");
  $("matrixHead").innerHTML = `<tr><th>Issuer</th>${state.chains.map(c => `<th class="r">${esc(c.name)}</th>`).join("")}</tr>`;
  $("matrixRows").innerHTML = state.issuers.map(i => `<tr><th scope="row">${esc(i.name)}</th>${state.chains.map(c => {
    const vs = V.filter(v => v.issuer === i.id && v.chain === c.id && v.onchain != null);
    return `<td class="r">${vs.length ? `<b class="num">${vs.length}</b><small class="sub2">${fmtUsd(vs.reduce((t, v) => t + (v.volume24h || 0), 0))}</small>` : '<span class="muted">–</span>'}</td>`;
  }).join("")}</tr>`).join("");
}

function render(){
  renderTape();
  if ($("mkt")) renderMarket();
  if ($("issuers")) renderIssuers();
  if ($("spreadRows")) renderSpreads();
  if ($("chainGrid")) renderChains();
  if (!$("rows")) return;
  if (state.deep){   // /?s=TSLA (links from alerts and other pages) opens that stock, whatever the filters
    const i = filtered().sort((a, b) => (b.volume24h ?? -1) - (a.volume24h ?? -1)).findIndex(r => r.ticker === state.deep);
    if (i >= 0){ state.open = state.deep; state.limit = Math.max(PAGE, Math.ceil((i + 1) / PAGE) * PAGE); }
  }
  pickSpot(); renderSpot(); renderChips(); renderGauge(); renderTable();
  if (state.deep && state.open){ $("rows").querySelector("tr.detail")?.scrollIntoView({block: "center"}); }
  state.deep = null;
}

/* ---------- events ---------- */
if ($("rows")){
  document.addEventListener("click", e => {
    const sp = e.target.closest("[data-spot]");
    if (sp){ spot.i = +sp.dataset.spot; renderSpot(); spotTick(); return; }
    const chip = e.target.closest(".chip[data-chain]");
    if (chip){
      state.chain = chip.dataset.chain; state.limit = PAGE;
      document.querySelectorAll(".chip[data-chain]").forEach(x => x.setAttribute("aria-pressed", x === chip ? "true" : "false"));
      renderTable(); return;
    }
    const s = e.target.closest("th button[data-sort]");
    if (s){
      const k = s.dataset.sort;
      if (state.sort === k) state.dir *= -1; else { state.sort = k; state.dir = k === "ticker" ? 1 : -1; }
      renderTable(); return;
    }
    if (e.target.closest("#showMore")){ state.limit += PAGE; renderTable(); return; }
    const tr = e.target.closest("tr.srow");
    if (tr && !e.target.closest("a")){
      state.open = state.open === tr.dataset.sym ? null : tr.dataset.sym;
      renderTable();
      if (state.open) $("rows").querySelector(`tr.srow[data-sym="${CSS.escape(state.open)}"] .ticker`)?.focus();
    }
  });
  let rz; window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(fitDetail, 150); });
  $("multi").addEventListener("change", e => { state.multi = e.target.checked; state.limit = PAGE; renderTable(); });
  $("q").addEventListener("input", e => { state.q = e.target.value; state.limit = PAGE; renderTable(); });
}

if ($("spreadRows")){
  $("q").addEventListener("input", e => { state.q = e.target.value; renderSpreads(); });
  $("minDepth").addEventListener("change", renderSpreads);
}
const deep = new URLSearchParams(location.search).get("s");
if (deep && /^[A-Za-z0-9.]{1,12}$/.test(deep)) state.deep = deep.toUpperCase();

if ($("issuers")) loadPegScores();
load().then(spotTick);
setInterval(() => { if (!document.hidden) load(); }, 120000);
})();
