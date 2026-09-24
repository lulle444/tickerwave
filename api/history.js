// Peg history for the site: /api/history?v=TSLAx_solana (one token) or /api/history?p=issuers&days=7 (peg score per issuer).
const H = require("../lib/history");

module.exports = async function handler(req, res){
  const q = req.query || {};
  try {
    if (q.v){
      if (!/^[A-Za-z0-9-]{1,16}_[a-z]{2,12}$/.test(String(q.v))) return res.status(400).json({error: "bad token id"});
      res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=3600");
      return res.status(200).json({v: q.v, points: await H.token(String(q.v))});
    }
    const days = Math.min(90, Math.max(1, parseInt(q.days, 10) || 7));
    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=3600");
    res.status(200).json(await H.issuers(days));
  } catch (e) {
    console.error("history:", e);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({error: "history unavailable", points: [], issuers: []});
  }
};
