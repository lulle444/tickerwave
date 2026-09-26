// What a holder actually owns with each issuer's tokens, as the issuers' own documents state it.
// Shown as "What you own" on every stock page. Only what the sources say: re-check them before changing a line,
// and bump CHECKED when you do.
const CHECKED = "2026-09-26";

const RIGHTS = {
  robinhood: {
    form: "Tokenized debt security",
    issuer: "Robinhood Assets (Jersey) Limited, Jersey. Not a regulated firm.",
    held: "Alpaca Securities, a US broker, is broker and custodian.",
    proof: "Security Agent Services AG in Zug is security and verification agent.",
    dividends: "Dividends and splits change an on-chain share multiplier, so one token can stand for more or less than one share.",
    mint: "Only its authorized participant, Bitstamp, can mint directly, from Monday 02:00 to Saturday 02:00 CET. Redeeming costs 0.05%, free in the first 90 days.",
    closed: "Not for US persons or UK residents.",
    rights: "No legal or beneficial rights in the share.",
    sources: [
      {label: "Robinhood Chain docs", url: "https://docs.robinhood.com/chain/stock-tokens/"},
      {label: "Service providers", url: "https://docs.robinhood.com/rhj/service-providers"},
    ],
  },
  xstocks: {
    form: "Tracker certificate",
    issuer: "Backed Assets, through a bankruptcy-remote issuing company.",
    held: "Backed 1:1 by shares in segregated custody accounts, with an independent security agent.",
    proof: "Public proof of reserves on the xStocks DeFi portal.",
    dividends: "Reinvested into more of the share, so one token grows past one share over time.",
    mint: "Eligible clients can mint and redeem directly, retail included after KYC. $5,000 minimum, on US market business days.",
    closed: "Not offered in the US.",
    rights: "Price exposure only, no voting or other shareholder rights.",
    sources: [
      {label: "xStocks FAQ", url: "https://docs.xstocks.fi/docs/frequently-asked-questions"},
      {label: "Proof of reserves", url: "https://defi.xstocks.fi"},
    ],
  },
  ondo: {
    form: "Tokenized stock, fully backed by the share plus any cash in transit",
    issuer: "Ondo Global Markets (BVI) Limited, British Virgin Islands.",
    held: "US-registered broker-dealers or US-chartered national trust companies.",
    proof: "An independent verification agent reports on the backing every business day, with monthly reconciliations and annual audits.",
    dividends: "Reinvested, net of withholding tax, so one token can stand for more than one share.",
    mint: "Only onboarded holders who passed KYC can buy or redeem directly, and onboarding is open to institutions only for now.",
    closed: "Only for eligible non-US persons.",
    rights: "No voting, information or other shareholder rights.",
    sources: [
      {label: "Ondo docs", url: "https://docs.ondo.finance/ondo-global-markets/overview"},
      {label: "Ondo Stocks", url: "https://ondo.finance/ondo-stocks"},
    ],
  },
};

module.exports = {RIGHTS, CHECKED};
