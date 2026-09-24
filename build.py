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
for k in ("accent", "accent2", "up", "down", "ink", "bg"):
    css.append(f"  --{k}-rgb:{rgb(C[k])};")
for k, v in F.items():
    css.append(f'  --f-{k}:"{v}";')
css.append("}")
open(os.path.join(ROOT, "brand.css"), "w").write("/* Written by build.py from brand.json. Edit brand.json instead. */\n" + "\n".join(css) + "\n")
FONTS_URL = "https://fonts.googleapis.com/css2?" + "&".join(
    "family=" + F[k].replace(" ", "+") + ":wght@" + w for k, w in (("display", "500;600;700"), ("body", "400;500;600"), ("mono", "400;500;600"))) + "&display=swap"

# ---------- logo mark: a price line swinging around its dashed peg ----------
LOGO = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <rect width="64" height="64" rx="14" fill="{C['panel2']}"/>
  <rect x=".75" y=".75" width="62.5" height="62.5" rx="13.25" fill="none" stroke="{C['line']}" stroke-width="1.5"/>
  <path d="M9 32h46" stroke="{C['accent2']}" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 6.2"/>
  <path d="M9 40c5 0 6-19 12-19s7 22 13 22 6-15 11-15c3.5 0 5 4 6.5 4" fill="none" stroke="{C['accent']}" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="52" cy="32" r="4.4" fill="{C['accent']}"/>
</svg>
"""
open(os.path.join(ROOT, "assets", "logo-mark.svg"), "w").write(LOGO)
# A drawn logo in brand.json ("logo": "/assets/logo.png") replaces the generated mark everywhere.
LOGO_SRC = B.get("logo") or "/assets/logo-mark.svg"
ICON = '<link rel="icon" type="image/png" href="/assets/favicon.png">' if B.get("logo") else '<link rel="icon" type="image/svg+xml" href="/assets/logo-mark.svg">'

# ---------- page shell ----------
HEAD = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{{{{site}}}}{path}">
<link rel="icon" type="image/svg+xml" href="/assets/logo-mark.svg">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{{{{site}}}}{path}">
<meta property="og:image" content="{{{{site}}}}{ogimg}">
<meta name="twitter:image" content="{{{{site}}}}{ogimg}">
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

NAV_ITEMS = [("/", "Stocks"), ("/spreads", "Spreads"), ("/ranking", "Ranking"), ("/weekend", "Weekend"), ("/chains", "Chains"), ("/alerts", "Alerts"), ("/learn", "Learn")]


def nav(path):
    links = "\n".join('      <a href="' + h + '"' + (' aria-current="page"' if h == path else '') + '>' + t + '</a>' for h, t in NAV_ITEMS)
    return f"""  <nav class="nav" aria-label="Main">
    <a class="logo" href="/" aria-label="{{{{name}}}} home"><img src="{LOGO_SRC}" alt="" width="36" height="36"><span class="word">{{{{w1}}}}<b>{{{{w2}}}}</b></span></a>
    <div class="navlinks">
{links}
    </div>
    <div class="navright">{NAV_X}<div class="source" id="source"><span class="dot" id="dot"></span><span id="sourceText">Loading data…</span></div></div>
  </nav>
  <div class="mobilenav" aria-label="Sections">
{links.replace("      <a", "    <a")}
  </div>
"""


X_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>'
X_LINK = (f'\n        <a class="social" href="https://x.com/{B["x"]}" target="_blank" rel="noopener me" aria-label="{{{{name}}}} on X">{X_SVG}@{B["x"]}</a>' if B["x"] else "")
NAV_X = (f'<a class="navx" href="https://x.com/{B["x"]}" target="_blank" rel="noopener me" aria-label="Follow {{{{name}}}} on X" title="@{B["x"]} on X">{X_SVG}</a>' if B["x"] else "")

FOOT = """
  <footer class="sitefoot">
    <div class="footgrid">
      <div class="footbrand">
        <a class="logo" href="/" aria-label="{{name}} home"><img src="LOGO_SRC" alt="" width="26" height="26"><span class="word">{{w1}}<b>{{w2}}</b></span></a>
        <p>{{tagline}} Independent, read-only and free. Live on-chain data, no paid placements.</p>""" + X_LINK + """
      </div>
      <nav aria-label="Product"><h4>Product</h4><a href="/">Stock tokens</a><a href="/spreads">Spreads</a><a href="/ranking">Peg ranking</a><a href="/weekend">Weekend signal</a><a href="/chains">Chains and issuers</a><a href="/alerts">Alerts</a></nav>
      <nav aria-label="Learn"><h4>Learn</h4><a href="/learn">Stock tokens explained</a><a href="/learn#checklist">Before you trade</a><a href="/#how">How we calculate</a></nav>
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


HEAD = HEAD.replace('<link rel="icon" type="image/svg+xml" href="/assets/logo-mark.svg">', ICON)
FOOT = FOOT.replace('src="LOGO_SRC"', f'src="{LOGO_SRC}"')

# Louise's 3D renders as page headers: text on the dark left, art on the right (see .bannerart in styles.css).
PH = '<header class="pagehead">'
def banner(file):
    return (f'<header class="pagehead banner"><picture class="bannerart"><source srcset="/assets/{file}.webp" type="image/webp">'
            f'<img src="/assets/{file}.jpg" alt="" width="1800" height="600" fetchpriority="high"></picture>')

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
      <h1>Is your stock token <em>worth the stock?</em></h1>
      <p class="lede">Tesla, Nvidia and hundreds more now trade as tokens on Robinhood Chain, Solana, Ethereum and beyond. Each one should track its real share, but not all of them do. {{name}} checks every version against the share price, all day, and shows which tokens hold their peg and which drift.</p>
      <div class="ctas">
        <a class="btn primary" href="#board">See which tokens drift</a>
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
    <div><small>Off peg right now</small><strong id="gOff">–</strong><span id="gOffSub">&nbsp;</span></div>
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
    <div class="sectionhead"><div><p class="eyebrow">Where they trade</p><h2 id="chainsH">Chains and issuers</h2><p class="sub">Each issuer holds the real shares and mints tokens against them. The same stock can exist in several versions, with different rules for who can mint, redeem and hold them. The peg score shows how close each issuer’s tokens stayed to the share over the past week, counting markets over $10k.</p></div></div>
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
      <details><summary>What does “holding its peg” mean?</summary><p>A stock token is meant to be worth exactly the share it stands for. When its on-chain price matches the share price (times its share ratio), it holds its peg. When it trades above or below, it has drifted. {{name}} saves every token’s distance from its share once an hour while the US market trades, so you can see which tokens and issuers hold their peg over time, not just right now.</p></details>
      <details><summary>Why can the same stock have different prices?</summary><p>Each version trades in its own markets on its own chain. Arbitrage pulls them toward the share price, but fees, market depth and who is allowed to mint and redeem leave small gaps. When the US market is closed, tokens keep trading while the share price stands still.</p></details>
      <details><summary>Is {{name}} free?</summary><p>Yes. No sign-up, no wallet connection and no fee. {{name}} is read-only and never touches your funds.</p></details>
      <details><summary>Can I buy tokens here?</summary><p>No. We link to the market each price comes from, so you can check it yourself. Many stock tokens are not available to US persons or in some countries, so check the issuer’s rules before you trade.</p></details>
    </div>
  </section>
"""

ABOUT = pagehead("About {{name}}", "Same stock. A clearer view.",
  "{{name}} compares tokenized stocks across blockchains and issuers, so you can see which version of a stock tracks the real share best and where it trades.").replace(PH, banner("banner"), 1) + """
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

BELL_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>'
BOT = B.get("telegram") or ""

SPREADS = pagehead("Spreads", "Same stock. <em>Different price.</em>",
  "When one stock trades as tokens on several chains, the versions rarely cost exactly the same. Here is how far apart the cheapest and the priciest token of each stock are right now, counting only markets deep enough to trade.").replace(PH, banner("banner-spreads"), 1) + """
  <section class="stats panel" aria-label="Key figures">
    <div><small>Stocks compared</small><strong id="pStocks">–</strong><span id="pStocksSub">&nbsp;</span></div>
    <div><small>Widest spread</small><strong id="pWide">–</strong><span id="pWideSub">&nbsp;</span></div>
    <div><small>Typical spread</small><strong id="pMedian">–</strong><span id="pMedianSub">&nbsp;</span></div>
    <div><small>Over 1%</small><strong id="pOver">–</strong><span id="pOverSub">&nbsp;</span></div>
  </section>

  <section class="tablepanel panel" aria-labelledby="spreadH">
    <div class="sectionhead">
      <div><h2 id="spreadH">Cheapest vs. priciest token</h2><p class="mkt" id="mkt">Checking market hours…</p></div>
    </div>
    <div class="controls">
      <label class="field" for="minDepth">Market depth
        <select id="minDepth">
          <option value="10000" selected>$10k+</option>
          <option value="100000">$100k+</option>
          <option value="1000000">$1M+</option>
        </select>
      </label>
      <span class="grow"></span>
      <input type="search" id="q" placeholder="Search ticker or company" aria-label="Search ticker or company">
    </div>
    <div class="tablebox">
      <table>
        <thead><tr>
          <th>Stock</th>
          <th class="r">Spread</th>
          <th>Cheapest</th>
          <th>Priciest</th>
          <th class="r">Thinner side</th>
          <th class="r"><span class="visually-hidden">Alert</span></th>
        </tr></thead>
        <tbody id="spreadRows"><tr><td colspan="6" class="empty">Loading spreads…</td></tr></tbody>
      </table>
    </div>
    <div class="more"><span id="count"></span></div>
  </section>

  <div class="twocol block-sm">
    <div class="panel note-card">
      <p class="eyebrow">Read this first</p>
      <h3>A spread is not free money</h3>
      <p>Buying the cheap token and selling the expensive one means moving money between chains, paying fees on both sides and trusting two issuers. Many tokens can only be minted or redeemed by approved partners, and most are off limits to US persons.</p>
      <p>Spreads also widen when the US market is closed: share prices freeze while tokens keep trading.</p>
    </div>
    <div class="panel note-card">
      <p class="eyebrow">How we calculate</p>
      <h3>Both sides measured against the share</h3>
      <p>Each token’s gap is its on-chain price against the share price × its share ratio, so dividends and splits don’t count as a spread. The spread is the priciest gap minus the cheapest. Markets under $10k are left out.</p>
    </div>
  </div>
"""

CHAINSPAGE = pagehead("Chains", "Where stock tokens <em>trade.</em>",
  "Every chain and issuer we track, side by side: how many stocks trade there, how much changes hands and how closely the tokens follow the real share.").replace(PH, banner("banner-chains"), 1) + """
  <section class="block-sm" aria-label="Chains">
    <div class="chaingrid" id="chainGrid"><p class="muted">Loading chains…</p></div>
  </section>

  <section class="block" aria-labelledby="matrixH">
    <div class="sectionhead"><div><p class="eyebrow">Issuer × chain</p><h2 id="matrixH">Who issues where</h2><p class="sub">Number of stocks with a live market, and their 24h volume.</p></div></div>
    <div class="tablebox"><table class="matrix"><thead id="matrixHead"></thead><tbody id="matrixRows"><tr><td class="empty">Loading…</td></tr></tbody></table></div>
  </section>

  <section class="block" aria-labelledby="issuersH">
    <div class="sectionhead"><div><p class="eyebrow">Issuers</p><h2 id="issuersH">Who holds the shares</h2><p class="sub">Each issuer buys and holds the real shares and mints tokens against them, with its own rules for who can mint, redeem and hold.</p></div></div>
    <div class="issuergrid" id="issuers"></div>
  </section>
"""

LEARN = pagehead("Learn", "Stock tokens, <em>explained.</em>",
  "What a stock token is, why the same stock can cost different amounts on different chains, and what to check before you trade one.").replace(PH, banner("banner-learn"), 1) + """
  <div class="learn">
    <article class="panel note-card">
      <p class="eyebrow">01 · Basics</p>
      <h3>What is a stock token?</h3>
      <p>A token on a blockchain that follows the price of one share of a real company or fund. An issuer buys the shares and holds them with a custodian, then mints tokens against them. Approved partners can mint new tokens by handing over money, or redeem tokens for money, at the share price.</p>
      <p>Holding a token gives you the price exposure. It usually does not make you a shareholder: no votes, and dividends are handled by the issuer.</p>
    </article>
    <article class="panel note-card">
      <p class="eyebrow">02 · Share ratio</p>
      <h3>Why one token isn’t always one share</h3>
      <p>When a company pays a dividend, many issuers reinvest it by raising the number of shares each token stands for, instead of paying cash. After a year a token might equal 1.005 shares. Splits change the ratio too.</p>
      <p>That is why we compare each token with the share price × its ratio, not the raw share price. Where an issuer doesn’t publish its ratio, we say so next to the token.</p>
    </article>
    <article class="panel note-card">
      <p class="eyebrow">03 · Gaps</p>
      <h3>Why tokens drift from the share</h3>
      <p>Minting and redeeming pull a token back toward the share price, because partners profit from closing a gap. But that takes time and costs fees, so small gaps remain. Thin markets drift more, since one trade moves them.</p>
      <p>Tokens trade around the clock. When the US market is closed the share price stands still, so a gap then shows where traders expect the stock to open.</p>
    </article>
    <article class="panel note-card">
      <p class="eyebrow">04 · Chains</p>
      <h3>Same stock, many versions</h3>
      <p>Robinhood issues on its own chain, xStocks mostly on Solana, Ondo on Ethereum and BNB Chain. Each version trades in its own markets, so their prices differ a little. Our <a href="/spreads">spreads page</a> shows how much.</p>
      <p>Versions from different issuers are not interchangeable: you can’t redeem an xStock with Ondo.</p>
    </article>
  </div>

  <section class="block panel note-card" id="checklist" aria-labelledby="checkH">
    <p class="eyebrow">Before you trade</p>
    <h2 id="checkH" style="font-size:26px">Five checks</h2>
    <ol class="checklist">
      <li><b>Are you allowed to hold it?</b> Most stock tokens are closed to US persons and restricted in some other countries.</li>
      <li><b>Who is the issuer?</b> Read how the shares are held and who can redeem.</li>
      <li><b>How deep is the market?</b> Under $10k, a single trade can move the price by several percent.</li>
      <li><b>Is the US market open?</b> On weekends and holidays the share price is frozen and gaps widen.</li>
      <li><b>What does it cost to get there?</b> Bridging, swaps and network fees can eat a small price advantage.</li>
    </ol>
  </section>
"""

ALERTS_ON = """
  <div class="twocol block-sm">
    <div class="panel note-card alertcard">
      <p class="eyebrow">Price gap</p>
      <h3>When a token leaves the share price</h3>
      <p>Pick a token, like TSLAx on Solana, and a level. We message you when it trades that far above or below the real share.</p>
      <p class="cmd"><code>/gap TSLAx 1</code></p>
    </div>
    <div class="panel note-card alertcard">
      <p class="eyebrow">Spread</p>
      <h3>When chains disagree</h3>
      <p>Pick a stock and a level. We message you when its cheapest and priciest tokens across chains are that far apart.</p>
      <p class="cmd"><code>/spread TSLA 1</code></p>
    </div>
  </div>
  <section class="block-sm panel note-card alertcta">
    <div>
      <p class="eyebrow">Telegram</p>
      <h2 style="font-size:26px">Free, no sign-up</h2>
      <p>Open the bot, tap Start and send a command, or tap 🔔 next to any token on the <a href="/">stock board</a> or any stock on <a href="/spreads">spreads</a>. We check every 5 minutes while the US market trades. Send /list to see or remove your alerts, and /weekend for the <a href="/weekend">weekend signal</a> every Sunday and Monday.</p>
    </div>
    <a class="btn primary" href="https://t.me/""" + BOT + """" target="_blank" rel="noopener">""" + BELL_SVG + """ Open @""" + BOT + """</a>
  </section>
"""
ALERTS_SOON = """
  <section class="block-sm panel note-card alertcta">
    <div>
      <p class="eyebrow">Coming soon</p>
      <h2 style="font-size:26px">Alerts are almost ready</h2>
      <p>Soon you can get a Telegram message when a token trades away from its share price, or when the same stock is priced differently across chains. Free, no sign-up.</p>
    </div>
  </section>
"""
WEEKEND = pagehead("Weekend signal", "Where tokens say stocks <em>reopen.</em>",
  "From Friday 8 pm to Sunday 8 pm New York time the stock market is shut, but stock tokens keep trading. Their price against Friday’s close is the market’s live guess at where each stock reopens.").replace(PH, banner("banner-weekend"), 1) + """
  <section class="wkstatus panel" id="wkStatus" aria-live="polite">
    <div><p class="eyebrow" id="wkMode">Weekend signal</p><h2 id="wkTitle">Loading…</h2><p id="wkText" class="muted"></p>""" + (f"""<a class="btn small wkbot" href="https://t.me/{BOT}?start=wk" target="_blank" rel="noopener">{BELL_SVG} Get it on Telegram</a>""" if BOT else "") + """</div>
    <div class="wkclock"><small id="wkClockLabel">&nbsp;</small><strong id="wkClock" class="num">–</strong><span id="wkClockAt">&nbsp;</span></div>
  </section>

  <section class="stats panel" aria-label="Key figures">
    <div><small>S&amp;P 500 (SPY)</small><strong id="wIndex">–</strong><span id="wIndexSub">&nbsp;</span></div>
    <div><small>Pointing up</small><strong id="wUp">–</strong><span id="wUpSub">&nbsp;</span></div>
    <div><small>Pointing down</small><strong id="wDown">–</strong><span id="wDownSub">&nbsp;</span></div>
    <div><small>Biggest move</small><strong id="wBig">–</strong><span id="wBigSub">&nbsp;</span></div>
  </section>

  <section class="tablepanel panel" aria-labelledby="wkH">
    <div class="sectionhead">
      <div><h2 id="wkH">Every stock, Friday’s close vs. its tokens</h2><p class="sub" id="wkSub">Counting token markets over $10k with a published share ratio, weighted by depth.</p></div>
    </div>
    <div class="controls">
      <div class="chips" role="group" aria-label="Sort">
        <button class="chip" data-wsort="abs" aria-pressed="true">Biggest moves</button>
        <button class="chip" data-wsort="up" aria-pressed="false">Up</button>
        <button class="chip" data-wsort="down" aria-pressed="false">Down</button>
        <button class="chip" data-wsort="depth" aria-pressed="false">Deepest</button>
      </div>
      <span class="grow"></span>
      <input type="search" id="q" placeholder="Search ticker or company" aria-label="Search ticker or company">
    </div>
    <div class="tablebox">
      <table>
        <thead id="wkHead"></thead>
        <tbody id="wkRows"><tr><td colspan="6" class="empty">Loading…</td></tr></tbody>
      </table>
    </div>
    <div class="more"><span id="count"></span><button class="btn ghost small" id="showMore" hidden>Show more</button></div>
  </section>

  <section class="block" id="wkPastBox" hidden aria-labelledby="wkPastH">
    <div class="sectionhead"><div><p class="eyebrow">Track record</p><h2 id="wkPastH">How past weekends turned out</h2><p class="sub">Direction counts as right when the tokens moved at least 0.25% and the stock opened Monday on the same side of Friday’s close.</p></div></div>
    <div class="tablebox panel"><table><thead><tr><th>Weekend</th><th class="r">Stocks</th><th class="r">Direction right</th><th class="r">Typical miss</th></tr></thead><tbody id="wkPast"></tbody></table></div>
  </section>

  <div class="twocol block-sm">
    <div class="panel note-card">
      <p class="eyebrow">How it works</p>
      <h3>A price that keeps moving while the market sleeps</h3>
      <p>Stock tokens trade around the clock on Robinhood Chain, Solana and Ethereum. Over the weekend the share price stays at Friday’s 8 pm close, so every move in a token is traders pricing in news before the market opens again. We blend each stock’s deep token markets, weighted by how much money sits in them, and save the reading every hour.</p>
      <p>When trading restarts on Sunday at 8 pm New York time, and again after Monday’s opening bell, we record where each stock actually opened, so you can see how good the call was.</p>
    </div>
    <div class="panel note-card">
      <p class="eyebrow">Read this first</p>
      <h3>A signal, not a forecast</h3>
      <p>Weekend token markets are thinner than the stock market, and a few large trades can move them. Treat the numbers as a read on sentiment. Not financial advice.</p>
    </div>
  </div>
"""

ALERTS = pagehead("Alerts", "Hear it <em>first.</em>",
  "Get a Telegram message the moment a stock token trades away from its share price, or when the same stock is priced differently across chains.").replace(PH, banner("banner-alerts"), 1) + (ALERTS_ON if BOT else ALERTS_SOON)

STOCK = """
  <header class="pagehead stockhead">
    <div>
      <p class="eyebrow"><a href="/">Stock tokens</a> / __TICKER__</p>
      <h1><span class="stlogo">__LOGO__</span>__NAME__ <em>on every chain.</em></h1>
      <p class="lede" id="stSummary">__SUMMARY__</p>
    </div>
  </header>

  <section class="stats panel" aria-label="Key figures">
    <div><small>Share price</small><strong id="sRef">–</strong><span id="sRefSub">&nbsp;</span></div>
    <div><small>Token versions</small><strong id="sVersions">–</strong><span id="sVersionsSub">&nbsp;</span></div>
    <div><small>Closest to the share</small><strong id="sBest">–</strong><span id="sBestSub">&nbsp;</span></div>
    <div><small>Spread across chains</small><strong id="sSpread">–</strong><span id="sSpreadSub">&nbsp;</span></div>
  </section>

  <section class="tablepanel panel" aria-labelledby="stH">
    <div class="sectionhead">
      <div><h2 id="stH">Every __TICKER__ token, priced against the share</h2><p class="mkt" id="mkt">Checking market hours…</p></div>
    </div>
    <div class="tablebox">
      <table class="sttable">
        <thead><tr>
          <th>Token</th><th class="hc">Chain</th><th class="r">On chain</th><th class="r">Gap</th><th class="hm">Peg history, 7 days</th><th class="r hm">Depth</th><th class="r hm">24h volume</th><th class="r"><span class="visually-hidden">Links</span></th>
        </tr></thead>
        <tbody id="stRows"><tr><td colspan="8" class="empty">Loading __TICKER__ tokens…</td></tr></tbody>
      </table>
    </div>
    <p class="lbfoot">Gap compares each token with the share price × its share ratio (the shares one token stands for after dividends and splits). Markets under $10k deep are marked thin: a small trade moves their price. The dashed line in the peg history is the share price.</p>
  </section>

  <div class="twocol block-sm">
    <section class="panel note-card" id="stAlert">
      <p class="eyebrow">Alerts</p>
      <h3>Know when __TICKER__ drifts</h3>
      <p>Get a free Telegram message when a __TICKER__ token trades away from the share, or when chains start to disagree on its price.</p>
      <p class="stctas" id="stCtas"></p>
    </section>
    <section class="panel note-card">
      <p class="eyebrow">Before you trade</p>
      <h3>A token is not the share</h3>
      <p>Each version is issued by a different company and held by its own custodian. Check who issues it, whether you can redeem it, and how deep its market is. A token far from the share price in a thin market usually means little liquidity, not a bargain.</p>
      <p><a href="/learn#checklist">Five checks before you trade →</a></p>
    </section>
  </div>

  <section class="block-sm" aria-labelledby="moreH">
    <div class="sectionhead"><div><h2 id="moreH">More stock tokens</h2></div></div>
    <nav class="stmore" aria-label="Other stocks">__MORE__</nav>
  </section>
"""

RANKING = pagehead("Peg ranking", "Which tokens <em>hold their peg.</em>",
  "Every hour the US market trades we check how far each stock token sits from its real share. Here is every deep market ranked by how closely it has stuck to the share price.") + """
  <section class="stats panel" aria-label="Key figures">
    <div><small>Markets ranked</small><strong id="rkCount">–</strong><span id="rkCountSub">&nbsp;</span></div>
    <div><small>Steady markets</small><strong id="rkFair">–</strong><span id="rkFairSub">&nbsp;</span></div>
    <div><small>Closest to its share</small><strong id="rkBest">–</strong><span id="rkBestSub">&nbsp;</span></div>
    <div><small>Furthest from its share</small><strong id="rkWorst">–</strong><span id="rkWorstSub">&nbsp;</span></div>
  </section>

  <section class="tablepanel panel" aria-labelledby="rkH">
    <div class="sectionhead">
      <div><h2 id="rkH">Every deep market, ranked by peg</h2><p class="sub" id="rkSub">Loading the hourly readings…</p></div>
    </div>
    <div class="controls">
      <div class="chips" role="group" aria-label="Order">
        <button class="chip" data-rsort="best" aria-pressed="true">Best held</button>
        <button class="chip" data-rsort="worst" aria-pressed="false">Worst held</button>
      </div>
      <div class="chips" role="group" aria-label="Chain" id="rkChains"></div>
      <span class="grow"></span>
      <input type="search" id="q" placeholder="Search ticker or company" aria-label="Search ticker or company">
    </div>
    <div class="tablebox">
      <table class="rktable">
        <thead><tr>
          <th class="r">#</th><th>Token</th><th class="r">Typical gap</th><th>Within ±0.5%</th><th class="r hm">Worst hour</th><th class="hm">Last readings</th><th class="r hm">Depth</th>
        </tr></thead>
        <tbody id="rkRows"><tr><td colspan="7" class="empty">Loading the ranking…</td></tr></tbody>
      </table>
    </div>
    <div class="more"><span id="count"></span><button class="btn ghost small" id="showMore" hidden>Show more</button></div>
  </section>

  <div class="twocol block-sm">
    <section class="panel note-card">
      <p class="eyebrow">How we rank</p>
      <h3>Typical gap first</h3>
      <p>For every market over $10k deep with a published share ratio, we take its hourly distance from the share price × its ratio. Markets are ranked by the typical (median) distance, then by how many hours they spent within ±0.5%.</p>
      <p>Weekend hours are left out: while the stock market is shut the share price is frozen, so a gap then is a guess about Monday, not a missed peg. That lives on the <a href="/weekend">weekend signal</a>.</p>
    </section>
    <section class="panel note-card">
      <p class="eyebrow">What it means</p>
      <h3>A tight peg is a working arbitrage</h3>
      <p>A token stays close to its share when someone can mint and redeem it against the real stock. When that link is slow, costly or closed, the token drifts. A market that often sits far from its share is one to trade with care.</p>
      <p><a href="/learn">Stock tokens explained →</a></p>
    </section>
  </div>
"""

OG = {"/": "/api/og?p=home", "/spreads": "/api/og?p=spreads", "/weekend": "/api/og?p=weekend", "/ranking": "/api/og?p=ranking"}
PAGES = [
  ("index.html", "/", "{{name}} · Stock tokens on every chain", "{desc}", "", HOME, "board.js"),
  ("spreads.html", "/spreads", "Spreads · {{name}}", "The same stock, priced differently across chains: the cheapest and priciest token of every stock, live.", "", SPREADS, "board.js"),
  ("weekend.html", "/weekend", "Weekend signal · {{name}}", "The stock market closes for the weekend, stock tokens don’t. See where tokens say every stock reopens on Monday, live from Friday night.", "", WEEKEND, "board.js"),
  ("ranking.html", "/ranking", "Peg ranking · {{name}}", "Which stock tokens hold their peg: every deep market ranked by how closely it tracks its real share, from hourly readings.", "", RANKING, "board.js"),
  ("chains.html", "/chains", "Chains · {{name}}", "Robinhood Chain, Solana, Ethereum and BNB Chain compared: stock tokens, volume and how closely they track the share.", "", CHAINSPAGE, "board.js"),
  ("alerts.html", "/alerts", "Alerts · {{name}}", "Free Telegram alerts when a stock token trades away from its share price or chains disagree.", "", ALERTS, "board.js"),
  ("learn.html", "/learn", "Learn · {{name}}", "Stock tokens explained: share ratios, price gaps, chains and five checks before you trade.", "", LEARN, "board.js"),
  ("about.html", "/about", "About · {{name}}", "What {{name}} is, where its data comes from, and the disclaimer.", "", ABOUT, "board.js"),
  ("templates/stock.html", "/stock/__SLUG__", "__TITLE__", "__DESC__", ' data-ticker="__TICKER__"', STOCK, "board.js"),
  ("404.html", "/404", "Page not found · {{name}}", "This page doesn’t exist. Compare stock tokens across every chain instead.", "", NOTFOUND, "board.js"),
]

xsite = f'\n<meta name="twitter:site" content="@{B["x"]}">' if B["x"] else ""
for fn, path, title, desc, attrs, body, script in PAGES:
    desc = desc.replace("{desc}", B["description"])
    attrs += f' data-bot="{BOT}"' if BOT else ""
    extra = ""
    if path == "/":
        same = f',"sameAs":["https://x.com/{B["x"]}"]' if B["x"] else ""
        extra = '\n<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"{{name}}","url":"{{site}}/","logo":"{{site}}/assets/apple-touch-icon.png"' + same + '},{"@type":"WebSite","name":"{{name}}","url":"{{site}}/"}]}</script>'
    html = HEAD.format(title=title, desc=desc, path="" if path == "/" else path, attrs=attrs, ogimg=OG.get(path, "/api/og?p=stock&amp;t=__SLUG__" if path.startswith("/stock/") else "/api/og?p=home"),
                       extra=extra, xsite=xsite, themecolor=C["bg"], fonts=FONTS_URL) + nav(path) + body + FOOT.replace("{script}", script)
    html = fill(html)
    if fn == "404.html":
        html = html.replace(f'<link rel="canonical" href="{SITE}/404">', '<meta name="robots" content="noindex">')
    assert "{{" not in html and "{site}" not in html, (fn, html[html.index("{{"):html.index("{{") + 40])
    os.makedirs(os.path.dirname(os.path.join(ROOT, fn)), exist_ok=True)
    open(os.path.join(ROOT, fn), "w", encoding="utf-8").write(html)
    print(fn, len(html))

open(os.path.join(ROOT, "sitemap.xml"), "w").write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + "".join(f"  <url><loc>{SITE}{p}</loc></url>\n" for _, p, *_ in PAGES if p != "/404" and not p.startswith("/stock/")) + "</urlset>\n")
open(os.path.join(ROOT, "robots.txt"), "w").write(f"User-agent: *\nAllow: /\nDisallow: /templates/\n\nSitemap: {SITE}/sitemap.xml\nSitemap: {SITE}/sitemap-stocks.xml\n")
