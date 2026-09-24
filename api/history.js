// Peg history for the site: /api/history?v=TSLAx_solana (one token), ?p=issuers&days=7 (peg score per issuer)
// ?p=weekend (the weekend signal and how past weekends turned out), ?p=ranking&days=7 (every deep market's peg score)
// or ?p=report&w=2026-09-25 (the weekly peg report; without w, the latest, live while the week trades).
const H = require("../lib/history");
const W = require("../lib/weekend");
const R = require("../lib/report");
const B = require("../brand.json");
const {currentBoard} = require("../lib/board");

module.exports = async function handler(req, res){
  const q = req.query || {};
  try {
    if (q.v){
      if (!/^[A-Za-z0-9-]{1,16}_[a-z]{2,12}$/.test(String(q.v))) return res.status(400).json({error: "bad token id"});
      res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=3600");
      return res.status(200).json({v: q.v, points: await H.token(String(q.v))});
    }
    if (q.p === "weekend"){
      res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
      return res.status(200).json(await W.view());
    }
    if (q.p === "report"){
      const want = /^\d{4}-\d{2}-\d{2}$/.test(String(q.w || "")) ? String(q.w) : null;
      res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=3600");
      return res.status(200).json(await R.view(await currentBoard("https://" + B.domain), want));
    }
    if (q.p === "ranking"){
      const days = Math.min(30, Math.max(1, parseInt(q.days, 10) || 7));
      res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=3600");
      return res.status(200).json(await H.ranking(await currentBoard("https://" + B.domain), days));
    }
    const days = Math.min(90, Math.max(1, parseInt(q.days, 10) || 7));
    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=3600");
    res.status(200).json(await H.issuers(days));
  } catch (e) {
    console.error("history:", e);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({error: "history unavailable", points: [], issuers: [], tokens: []});
  }
};
