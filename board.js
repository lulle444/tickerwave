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
  set("gVolume", fmtUsd(V.reduce((t, v) => t + (v.volume24h || 0), 0)));
  const byChain = {};
  for (const v of V) byChain[v.chain] = (byChain[v.chain] || 0) + (v.volume24h || 0);
  const lead = Object.entries(byChain).sort((a, b) => b[1] - a[1])[0];
  set("gVolumeSub", lead ? `Most on ${chainName(lead[0])}` : "On DEX markets");
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
    return `<article class="glass issuer">
      <p class="eyebrow">${esc(chains.join(" · "))}</p>
      <h3>${esc(i.name)}</h3>
      <p>${esc(i.about || "")}</p>
      <dl><div><dt>Stocks</dt><dd class="num">${V.length}</dd></div><div><dt>24h volume</dt><dd class="num">${fmtUsd(V.reduce((t, v) => t + (v.volume24h || 0), 0))}</dd></div></dl>
      ${i.url ? `<a class="trade" href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.name)} website ↗</a>` : ""}
    </article>`;
  }).join("");
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
      <td class="r num">${fmtPrice(v.onchain)}${v.multiplier && Math.abs(v.multiplier - 1) > 1e-6 ? `<small class="sub2">${v.multiplier.toFixed(4)} shares</small>` : ""}</td>
      <td class="r">${gapPill(v, s.stale)}</td>
      <td class="r num hm">${fmtUsd(v.liquidity)}${v.thin && v.onchain != null ? '<small class="sub2 warn">thin</small>' : ""}</td>
      <td class="r num hm">${fmtUsd(v.volume24h)}</td>
      <td class="r">${v.url ? `<a class="trade" href="${esc(v.url)}" target="_blank" rel="noopener" aria-label="View the ${esc(v.symbol)} market">Market ↗</a>` : ""}</td>
    </tr>`).join("");
  return `<tr class="detail"><td colspan="6"><div class="lbdetail">
    <table class="lbsub"><thead><tr><th>Token</th><th>Chain</th><th class="r">On chain</th><th class="r">Gap</th><th class="r hm">Depth</th><th class="r hm">24h volume</th><th class="r"><span class="visually-hidden">Link</span></th></tr></thead><tbody>${rows}</tbody></table>
    <p class="lbfoot">Gap compares each token with the share price × its share ratio. Depth and volume are for the token’s markets on that chain.</p>
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
  document.querySelectorAll("th button[data-sort]").forEach(b => {
    const on = b.dataset.sort === state.sort;
    b.closest("th").setAttribute("aria-sort", on ? (state.dir > 0 ? "ascending" : "descending") : "none");
    b.textContent = b.textContent.replace(/ [↓↑]$/, "") + (on ? (state.dir < 0 ? " ↓" : " ↑") : "");
  });
}

function render(){
  if (!$("rows")) return;
  renderChips(); renderGauge(); renderMarket(); renderTable(); renderIssuers();
}

/* ---------- events ---------- */
if ($("rows")){
  document.addEventListener("click", e => {
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

load();
setInterval(() => { if (!document.hidden) load(); }, 120000);
})();
