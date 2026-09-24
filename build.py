"""Builds every page, brand.css, the logo, sitemap.xml and robots.txt from brand.json.

To rename or recolor the site: edit brand.json, then run  python3 build.py  and commit the result.
Page text says the brand name through {{name}}, so nothing else needs to change.
"""
import json, os

ROOT = os.path.dirname(os.path.abspath(__file__))
B = json.load(open(os.path.join(ROOT, "brand.json"), encoding="utf-8"))
C = B["colors"]
SITE = "https://" + B["domain"]
W1, W2 = B["wordmark"]


def fill(s):
    for k, v in {"name": B["name"], "tagline": B["tagline"], "site": SITE, "w1": W1, "w2": W2}.items():
        s = s.replace("{{" + k + "}}", v)
    return s


def rgb(hexcol):
    h = hexcol.lstrip("#")
    return ",".join(str(int(h[i:i + 2], 16)) for i in (0, 2, 4))


# ---------- brand.css: the only place colors and fonts are set ----------
F = B["fonts"]
css = [":root{"]
for k, v in C.items():
    css.append(f"  --b-{k}:{v};")
for k in ("accent", "accent2", "up", "down", "ink"):
    css.append(f"  --{k}-rgb:{rgb(C[k])};")
for k, v in F.items():
    css.append(f'  --f-{k}:"{v}";')
css.append("}")
open(os.path.join(ROOT, "brand.css"), "w").write("/* Written by build.py from brand.json. Edit brand.json instead. */\n" + "\n".join(css) + "\n")
FONTS_URL = "https://fonts.googleapis.com/css2?" + "&".join(
    "family=" + F[k].replace(" ", "+") + ":wght@" + w for k, w in (("display", "500;600;700"), ("body", "400;500;600"), ("mono", "400;500;600"))) + "&display=swap"

# ---------- logo mark: a wave that turns into a rising price line ----------
LOGO = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <rect width="64" height="64" rx="14" fill="{C['panel2']}"/>
  <rect x=".75" y=".75" width="62.5" height="62.5" rx="13.25" fill="none" stroke="{C['line']}" stroke-width="1.5"/>
  <path d="M9 41c5 0 6-8 11-8s6 8 11 8l8-14 6 6 10-15" fill="none" stroke="{C['accent']}" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
"""
open(os.path.join(ROOT, "assets", "logo-mark.svg"), "w").write(LOGO)

# ---------- page shell ----------
HEAD = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{{site}}{path}">
<link rel="icon" type="image/svg+xml" href="/assets/logo-mark.svg">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{{site}}{path}">
<meta property="og:image" content="{{site}}{ogimg}">
<meta name="twitter:image" content="{{site}}{ogimg}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">{xsite}
<meta name="theme-color" content="{themecolor}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="{fonts}">
<link rel="stylesheet" href="/styles.css">
<link rel="stylesheet" href="/brand.css">{extra}
</head>
<body{attrs}>
<canvas id="bg" aria-hidden="true"></canvas>
<div class="tape" id="tape" aria-label="Live stock-token prices"><div class="tape-track" id="tapeTrack"></div></div>
<div class="wrap">
"""

NAV_ITEMS = [("/", "Stocks"), ("/#chains", "Chains"), ("/#how", "How it works"), ("/about", "About")]


def nav(path):
    links = "\n".join('      <a href="' + h + '"' + (' aria-current="page"' if h == path else '') + '>' + t + '</a>' for h, t in NAV_ITEMS)
    return f"""  <nav class="nav" aria-label="Main">
    <a class="logo" href="/" aria-label="{{{{name}}}} home"><img src="/assets/logo-mark.svg" alt="" width="36" height="36"><span class="word">{{{{w1}}}}<b>{{{{w2}}}}</b></span></a>
    <div class="navlinks">
{links}
    </div>
    <div class="source" id="source"><span class="dot" id="dot"></span><span id="sourceText">Loading data…</span></div>
  </nav>
  <div class="mobilenav" aria-label="Sections">
{links.replace("      <a", "    <a")}
  </div>
"""


X_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>'
X_LINK = (f'\n        <a class="social" href="https://x.com/{B["x"]}" target="_blank" rel="noopener me" aria-label="{{{{name}}}} on X">{X_SVG}@{B["x"]}</a>' if B["x"] else "")

FOOT = """
  <footer class="sitefoot">
    <div class="footgrid">
      <div class="footbrand">
        <a class="logo" href="/" aria-label="{{name}} home"><img src="/assets/logo-mark.svg" alt="" width="26" height="26"><span class="word">{{w1}}<b>{{w2}}</b></span></a>
        <p>{{tagline}} Independent, read-only and free. Live on-chain data, no paid placements.</p>""" + X_LINK + """
      </div>
      <nav aria-label="Product"><h4>Product</h4><a href="/">Stock tokens</a><a href="/#chains">Chains and issuers</a><a href="/#how">How it works</a></nav>
      <nav aria-label="Company"><h4>Company</h4><a href="/about">About</a><a href="/about#disclaimer">Disclaimer</a></nav>
    </div>
    <div class="footbase">
      <span>© 2026 {{name}}. Not financial advice. Stock tokens are not the shares themselves.</span>
      <span id="updated"></span>
    </div>
  </footer>
</div>
<script src="/{script}"></script>
<script src="/backdrop.js"></script>
<script>window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };</script>
<script defer src="/_vercel/insights/script.js"></script>
</body>
</html>
"""


def pagehead(eyebrow, h1, sub):
    return f"""
  <header class="pagehead">
    <div>
      <p class="eyebrow">{eyebrow}</p>
      <h1>{h1}</h1>
      <p class="lede">{sub}</p>
    </div>
  </header>
"""


HOME = """
  <header class="hero" id="top">
    <div>
      <p class="eyebrow">Stock tokens · Every chain</p>
      <h1>One stock. <em>Every chain.</em></h1>
      <p class="lede">Tesla, Nvidia and hundreds more now trade as tokens on Robinhood Chain, Solana, Ethereum and beyond. {{name}} lines up every version side by side, so you can see which one tracks the real share best and where the market is deepest.</p>
      <div class="ctas">
        <a class="btn primary" href="#board">Compare stock tokens</a>
        <a class="btn ghost" href="#how">How it works</a>
      </div>
      <p class="trust">Live prices from the chains · No sign-up · Independent</p>
    </div>
    <aside class="spot panel" id="spot" aria-live="polite" aria-label="One stock across chains">
      <div class="spothead"><div><p class="eyebrow">Spotlight</p><h3 id="spotName">Loading…</h3></div><div class="spotref"><small>Share price</small><strong id="spotRef">–</strong></div></div>
      <ul class="spotrows" id="spotRows"></ul>
      <p class="spotfoot"><span>Centre line = the real share. Bars show each token’s premium or discount.</span><span class="spotnav" id="spotNav" role="group" aria-label="Pick a stock"></span></p>
    </aside>
  </header>

  <section class="stats panel" aria-label="Key figures">
    <div><small>Stocks</small><strong id="gStocks">–</strong><span id="gStocksSub">&nbsp;</span></div>
    <div><small>Token versions</small><strong id="gVersions">–</strong><span id="gVersionsSub">&nbsp;</span></div>
    <div><small>Traded on chain, 24h</small><strong id="gVolume">–</strong><span id="gVolumeSub">&nbsp;</span></div>
    <div><small>Closest to the share</small><strong id="gBest">–</strong><span id="gBestSub">&nbsp;</span></div>
  </section>

  <section class="tablepanel panel" id="board" aria-labelledby="boardH">
    <div class="sectionhead">
      <div><h2 id="boardH">Every stock, every version</h2><p class="mkt" id="mkt">Checking market hours…</p></div>
    </div>
    <div class="controls">
      <div class="chips" role="group" aria-label="Chain" id="chainChips">
        <button class="chip" data-chain="all" aria-pressed="true">All chains</button>
      </div>
      <label class="field check" for="multi"><input type="checkbox" id="multi"> On 2+ chains</label>
      <span class="grow"></span>
      <input type="search" id="q" placeholder="Search ticker or company" aria-label="Search ticker or company">
    </div>
    <div class="tablebox">
      <table>
        <thead><tr>
          <th><button data-sort="ticker">Stock</button></th>
          <th class="r"><button data-sort="ref">Share price</button></th>
          <th><button data-sort="count">Versions</button></th>
          <th class="r"><button data-sort="bestGap">Closest version</button></th>
          <th class="r"><button data-sort="liquidity">Market depth</button></th>
          <th class="r"><button data-sort="volume24h">24h volume</button></th>
        </tr></thead>
        <tbody id="rows"><tr><td colspan="6" class="empty">Loading stock tokens…</td></tr></tbody>
      </table>
    </div>
    <div class="more"><span id="count"></span><button class="btn ghost small" id="showMore" hidden>Show more</button></div>
  </section>

  <section class="block" id="chains" aria-labelledby="chainsH">
    <div class="sectionhead"><div><p class="eyebrow">Where they trade</p><h2 id="chainsH">Chains and issuers</h2><p class="sub">Each issuer holds the real shares and mints tokens against them. The same stock can exist in several versions, with different rules for who can mint, redeem and hold them.</p></div></div>
    <div class="issuergrid" id="issuers"></div>
  </section>

  <section class="block" id="how" aria-labelledby="howH">
    <div class="sectionhead"><div><p class="eyebrow">How it works</p><h2 id="howH">Two prices, one gap</h2></div></div>
    <ol class="steps">
      <li class="panel"><span class="stepnum">01</span><h3>The share</h3><p>We take the live bid and ask for the real share, adjusted for each token’s share ratio after dividends and splits.</p></li>
      <li class="panel"><span class="stepnum">02</span><h3>The token</h3><p>For every version on every chain we read the price in its deepest on-chain market, plus how much money sits in it and what traded in the last 24 hours.</p></li>
      <li class="panel"><span class="stepnum">03</span><h3>The gap</h3><p>On-chain price divided by the share price, minus one. Within ±0.5% counts as fair. Thin markets are flagged, because one small trade can move them.</p></li>
    </ol>
  </section>

  <section class="block faq" id="faq" aria-labelledby="faqH">
    <div class="sectionhead"><div><p class="eyebrow">FAQ</p><h2 id="faqH">Questions, answered</h2></div></div>
    <div class="faqlist panel">
      <details><summary>What is a stock token?</summary><p>A token on a blockchain that tracks one share of a real company. The issuer buys and holds the shares, and lets approved partners mint and redeem tokens against them. Holding the token gives you the price exposure, not shareholder rights such as voting.</p></details>
      <details><summary>Why can the same stock have different prices?</summary><p>Each version trades in its own markets on its own chain. Arbitrage pulls them toward the share price, but fees, market depth and who is allowed to mint and redeem leave small gaps. When the US market is closed, tokens keep trading while the share price stands still.</p></details>
      <details><summary>Is {{name}} free?</summary><p>Yes. No sign-up, no wallet connection and no fee. {{name}} is read-only and never touches your funds.</p></details>
      <details><summary>Can I buy tokens here?</summary><p>No. We link to the market each price comes from, so you can check it yourself. Many stock tokens are not available to US persons or in some countries, so check the issuer’s rules before you trade.</p></details>
    </div>
  </section>
"""

ABOUT = pagehead("About {{name}}", "Same stock. A clearer view.",
  "{{name}} compares tokenized stocks across blockchains and issuers, so you can see which version of a stock tracks the real share best and where it trades.") + """
  <section class="block" aria-labelledby="princH">
    <div class="sectionhead"><div><p class="eyebrow">What we stand for</p><h2 id="princH">Three principles</h2></div></div>
    <div class="steps">
      <article class="panel"><span class="stepnum">01</span><h3>Independent</h3><p>No issuer or exchange pays for a place in the table. The order follows the column you sort by, nothing else.</p></article>
      <article class="panel"><span class="stepnum">02</span><h3>Transparent</h3><p>Every price links back to the public market it came from, and the method is written out on the front page.</p></article>
      <article class="panel"><span class="stepnum">03</span><h3>Non-custodial</h3><p>{{name}} is read-only. No wallet connection, no deposits, no sign-up.</p></article>
    </div>
  </section>

  <div class="twocol block">
    <div class="panel note-card">
      <p class="eyebrow">Data</p>
      <h3>Where the numbers come from</h3>
      <p>Token lists and share ratios come from each issuer’s public data. On-chain prices, market depth and volume come from DexScreener, which indexes the exchanges on each chain. Share prices come from live quotes for the underlying stock.</p>
    </div>
    <div class="panel note-card">
      <p class="eyebrow">Business model</p>
      <h3>How {{name}} stays free</h3>
      <p>{{name}} is free and has no paid placements. If we add sponsored spots later, they’ll be clearly labelled and kept outside the table.</p>
    </div>
  </div>

  <section class="block panel note-card" id="disclaimer" aria-labelledby="discH">
    <p class="eyebrow">Disclaimer</p>
    <h2 id="discH" style="font-size:22px">Not financial advice</h2>
    <p>{{name}} provides information for general educational purposes only. Nothing on this site is financial, investment, tax or legal advice, or a recommendation to buy or sell any asset.</p>
    <p>Stock tokens are not the shares themselves. They carry issuer, custody, smart-contract and liquidity risk, may not give shareholder rights, and are restricted in many countries including the United States. Prices come from third parties and can be delayed or wrong.</p>
    <p>{{name}} is independent and is not affiliated with Robinhood, Backed, Kraken, Ondo, DexScreener or any issuer or exchange listed. Always do your own research before you trade.</p>
  </section>
"""

NOTFOUND = pagehead("Page not found", "This ticker isn’t listed.",
  "The link may be old or mistyped. Every stock token we track is one tap away.") + """
  <div class="panel note-card block-sm">
    <p class="eyebrow">Where to next</p>
    <div class="cta-row" style="display:flex;flex-wrap:wrap;gap:10px">
      <a class="btn primary" href="/">All stock tokens</a>
      <a class="btn ghost" href="/about">About</a>
    </div>
  </div>
"""

OG = {"/": "/api/og?p=home"}
PAGES = [
  ("index.html", "/", "{{name}} · Stock tokens on every chain", "{desc}", "", HOME, "board.js"),
  ("about.html", "/about", "About · {{name}}", "What {{name}} is, where its data comes from, and the disclaimer.", "", ABOUT, "board.js"),
  ("404.html", "/404", "Page not found · {{name}}", "This page doesn’t exist. Compare stock tokens across every chain instead.", "", NOTFOUND, "board.js"),
]

xsite = f'\n<meta name="twitter:site" content="@{B["x"]}">' if B["x"] else ""
for fn, path, title, desc, attrs, body, script in PAGES:
    desc = desc.replace("{desc}", B["description"])
    extra = ""
    if path == "/":
        same = f',"sameAs":["https://x.com/{B["x"]}"]' if B["x"] else ""
        extra = '\n<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"{{name}}","url":"{{site}}/","logo":"{{site}}/assets/apple-touch-icon.png"' + same + '},{"@type":"WebSite","name":"{{name}}","url":"{{site}}/"}]}</script>'
    html = HEAD.format(title=title, desc=desc, path="" if path == "/" else path, attrs=attrs, ogimg=OG.get(path, "/api/og?p=home"),
                       extra=extra, xsite=xsite, themecolor=C["bg"], fonts=FONTS_URL) + nav(path) + body + FOOT.replace("{script}", script)
    html = fill(html)
    if fn == "404.html":
        html = html.replace(f'<link rel="canonical" href="{SITE}/404">', '<meta name="robots" content="noindex">')
    assert "{{" not in html, (fn, html[html.index("{{"):html.index("{{") + 40])
    open(os.path.join(ROOT, fn), "w", encoding="utf-8").write(html)
    print(fn, len(html))

open(os.path.join(ROOT, "sitemap.xml"), "w").write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + "".join(f"  <url><loc>{SITE}{p}</loc></url>\n" for p in ("/", "/about")) + "</urlset>\n")
open(os.path.join(ROOT, "robots.txt"), "w").write(f"User-agent: *\nAllow: /\n\nSitemap: {SITE}/sitemap.xml\n")
