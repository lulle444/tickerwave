// Every stock token on every chain with share price and on-chain price, cached briefly at Vercel's CDN
// so every visitor shares one upstream request a minute.
const {board} = require("../lib/board");

module.exports = async function handler(req, res){
  try {
    const data = await board();
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
    res.status(200).json({updatedAt: new Date().toISOString(), ...data});
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({error: String(e.message || e)});
  }
};
