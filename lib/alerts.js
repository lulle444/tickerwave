// Alert storage shared by the bot webhook and the scheduled check.
// Two kinds: "gap" watches one token version (e.g. TSLAx on Solana) against the share price;
// "spread" watches the price difference between the cheapest and priciest version of one stock.
const B = require("../brand.json");
const {redis, pipeline} = require("./store");

const SITE = "https://" + B.domain;
const BOT = B.telegram || "";
const K = {
  alerts: "tk:alerts",                 // hash: alert id -> JSON
  chat: c => `tk:chat:${c}`,           // set of alert ids per chat
  ctx: c => `tk:ctx:${c}`,             // what a chat last opened, for a bare "/gap 1"
  lock: "tk:lock",                     // keeps the scheduled check to one run per window
};
const MAX_PER_CHAT = 20;

const pct = v => (v == null || !isFinite(v)) ? "–" : `${(+v).toFixed(2)}%`;
const signed = g => (g > 0 ? "+" : g < 0 ? "−" : "") + Math.abs(g * 100).toFixed(2) + "%";
const usd = v => v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}k` : `$${Math.round(v || 0)}`;
const price = v => "$" + (+v).toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2});
// a version's id, also used in Telegram start links (letters, digits, _ and - only)
const vidOf = v => `${v.symbol}_${v.chain}`.replace(/\./g, "-");

async function listAlerts(chat){
  const ids = await redis("SMEMBERS", K.chat(chat)) || [];
  if (!ids.length) return [];
  const vals = await redis("HMGET", K.alerts, ...ids) || [];
  return vals.filter(Boolean).map(v => JSON.parse(v));
}

async function addAlert(chat, fields, nowHit){
  const existing = await listAlerts(chat);
  const dup = existing.find(a => a.kind === fields.kind && a.key === fields.key && a.thr === fields.thr);
  if (dup) return {alert: dup, dup: true};
  if (existing.length >= MAX_PER_CHAT) return {error: `You can have up to ${MAX_PER_CHAT} alerts. Remove one with /list first.`};
  const alert = {id: Math.random().toString(36).slice(2, 10), chat, ...fields, armed: !nowHit, created: Date.now()};
  await pipeline([["HSET", K.alerts, alert.id, JSON.stringify(alert)], ["SADD", K.chat(chat), alert.id]]);
  return {alert};
}

async function removeAlert(chat, id){
  await pipeline([["HDEL", K.alerts, id], ["SREM", K.chat(chat), id]]);
}

async function removeAll(chat){
  const ids = await redis("SMEMBERS", K.chat(chat)) || [];
  const cmds = [["DEL", K.chat(chat)]];
  if (ids.length) cmds.push(["HDEL", K.alerts, ...ids]);
  await pipeline(cmds);
  return ids.length;
}

module.exports = {K, SITE, BOT, pct, signed, usd, price, vidOf, listAlerts, addAlert, removeAlert, removeAll};
