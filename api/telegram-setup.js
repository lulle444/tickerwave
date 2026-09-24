// One-off after adding TELEGRAM_BOT_TOKEN: points the bot's webhook at this site and sets its command menu.
// Harmless to call again; it only ever registers this site's own webhook.
const B = require("../brand.json");
const {tg, webhookSecret} = require("../lib/telegram");
const {SITE} = require("../lib/alerts");

module.exports = async function handler(req, res){
  try {
    await tg("setWebhook", {url: SITE + "/api/telegram", secret_token: webhookSecret(),
      allowed_updates: ["message", "callback_query"], drop_pending_updates: true});
    await tg("setMyCommands", {commands: [
      {command: "gap", description: "Token vs share price alert, e.g. /gap TSLAx 1"},
      {command: "spread", description: "Cross-chain spread alert, e.g. /spread TSLA 1"},
      {command: "list", description: "See or remove your alerts"},
      {command: "stop", description: "Remove all alerts"},
      {command: "start", description: `How ${B.name} alerts work`},
    ]});
    await tg("setMyDescription", {description: `Alerts for stock tokens on every chain: get a message when a token trades away from its share price, or when the same stock is priced differently across chains. From ${B.name}.`}).catch(() => {});
    const me = await tg("getMe", {});
    res.status(200).json({ok: true, bot: "@" + me.username, webhook: SITE + "/api/telegram"});
  } catch (e) {
    res.status(500).json({ok: false, error: String(e.message || e)});
  }
};
