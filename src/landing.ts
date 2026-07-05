// Single-file HTML landing served from GET / when the client accepts text/html.
// Agents hitting / with any other Accept header keep getting the JSON discovery
// doc (see app.ts) — this file is browser-facing only.

export function landingHtml(opts: { origin: string; price: string; network: string; configured?: boolean }): string {
  const { origin, price, network, configured = true } = opts;
  const curlCmd = `curl -i "${origin}/bounties?language=typescript&minAmount=100"`;
  // When no wallet is configured, the paid endpoint is disabled (503). Don't sell a pay CTA that can't take money.
  const notice = configured
    ? ""
    : `<p class="sub" style="color:var(--accent)">This deployment isn't accepting payments yet — the paid endpoint is disabled until a wallet is configured.</p>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>x402 Bounty Radar — Real, funded GitHub bounties. Scam-filtered.</title>
<meta name="description" content="Paid API for real, funded GitHub bounties — scam-farm clones filtered out, competition scored. ${price} per call in USDC via x402. No API key, no KYC.">
<meta property="og:title" content="x402 Bounty Radar">
<meta property="og:description" content="Real, funded GitHub bounties. Scam-filtered, competition-scored. ${price} per call in USDC via x402 — no API key, no KYC.">
<meta property="og:type" content="website">
<meta property="og:url" content="${origin}/">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="x402 Bounty Radar">
<meta name="twitter:description" content="Real, funded GitHub bounties. Scam-filtered, competition-scored. ${price} per call in USDC via x402.">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%230a0a0a'/%3E%3Ccircle cx='16' cy='16' r='10' fill='none' stroke='%23006bff' stroke-width='2'/%3E%3Ccircle cx='16' cy='16' r='3' fill='%23006bff'/%3E%3C/svg%3E">
<style>
@font-face{font-family:Geist;src:url(https://unpkg.com/geist@latest/dist/fonts/geist-sans/Geist-Regular.woff2) format("woff2");font-weight:400;font-display:swap}
@font-face{font-family:Geist;src:url(https://unpkg.com/geist@latest/dist/fonts/geist-sans/Geist-SemiBold.woff2) format("woff2");font-weight:600;font-display:swap}
@font-face{font-family:"Geist Mono";src:url(https://unpkg.com/geist@latest/dist/fonts/geist-mono/GeistMono-Regular.woff2) format("woff2");font-weight:400;font-display:swap}
:root{
  --bg:#0a0a0a;--surface:#171717;--border:#2e2e2e;--accent:#006bff;--accent-hover:#0059d1;
  --text:#ededed;--muted:#8f8f8f;
}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--text);font:400 16px/1.6 Geist,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
a:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
main{max-width:720px;margin:0 auto;padding:96px 24px 64px}
h1{font-weight:600;font-size:clamp(1.75rem,5vw,2.5rem);line-height:1.15;letter-spacing:-.02em}
.sub{color:var(--muted);font-size:1.125rem;margin-top:16px;max-width:56ch}
.sub strong{color:var(--text);font-weight:600}
section{margin-top:64px}
h2{font-weight:600;font-size:1.125rem;margin-bottom:16px}
p{color:var(--muted)}
code,pre{font-family:"Geist Mono",ui-monospace,monospace;font-size:.875rem}
.terminal{margin-top:32px;background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden}
.terminal-bar{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--border);color:var(--muted);font-size:.75rem;font-family:"Geist Mono",ui-monospace,monospace}
.terminal pre{padding:16px;overflow-x:auto;white-space:pre;line-height:1.7}
.terminal .c{color:var(--muted)}
.copy{background:var(--accent);color:#fff;border:0;border-radius:6px;padding:6px 12px;font:600 .8125rem Geist,system-ui,sans-serif;cursor:pointer;transition:background .15s ease}
.copy:hover{background:var(--accent-hover)}
.schema{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px;overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:.9375rem}
th,td{text-align:left;padding:8px 12px;border-bottom:1px solid var(--border)}
th{color:var(--muted);font-weight:600;font-size:.8125rem}
td code{color:var(--text)}
td{color:var(--muted)}
ol{color:var(--muted);padding-left:24px;display:grid;gap:8px}
ol code{color:var(--text)}
footer{margin-top:96px;padding-top:24px;border-top:1px solid var(--border);color:var(--muted);font-size:.875rem;display:flex;gap:16px;flex-wrap:wrap}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style>
</head>
<body>
<main>
  <h1>Real, funded GitHub bounties. Scam-filtered, competition-scored.</h1>
  <p class="sub"><strong>${price} per call in USDC via x402</strong> — no API key, no KYC. One HTTP request, one micropayment, ranked bounties back.</p>
  ${notice}

  <div class="terminal">
    <div class="terminal-bar">
      <span>GET /bounties</span>
      <button class="copy" id="copy" type="button" aria-label="Copy curl command to clipboard">Copy curl</button>
    </div>
    <pre id="cmd">${curlCmd}
<span class="c"># → HTTP 402 with x402 payment requirements.
# An x402 client (e.g. x402-fetch) pays ${price} USDC on ${network} and gets the JSON.</span></pre>
  </div>

  <section>
    <h2>Why this exists</h2>
    <p>The discoverable bounty landscape is mostly noise: throwaway accounts cloning famous repos with fake bounty issues and no real escrow, and well-scoped bounties that already have 5+ agent PRs within hours. This API filters the scam farms, scores the competition, and ranks what's left: lowest competition &rarr; highest amount &rarr; freshest.</p>
  </section>

  <section>
    <h2>Response shape</h2>
    <p style="margin-bottom:16px">Exactly what a paid call returns (example values):</p>
    <div class="schema"><pre>{
  "count": 1,
  "bounties": [
    {
      "repo": "owner/project",
      "number": 1234,
      "title": "Implement TypeScript SDK",
      "url": "https://github.com/owner/project/issues/1234",
      "createdAt": "2026-06-10T12:00:00Z",
      "ageDays": 6,
      "comments": 2,
      "labels": ["bounty", "$250"],
      "amountUsd": 250,
      "competition": "low",
      "trust": "likely_real",
      "scamReasons": []
    }
  ]
}</pre></div>
  </section>

  <section>
    <h2>Query params</h2>
    <table>
      <thead><tr><th scope="col">param</th><th scope="col">meaning</th></tr></thead>
      <tbody>
        <tr><td><code>language</code></td><td>filter by language, e.g. <code>typescript</code></td></tr>
        <tr><td><code>minAmount</code></td><td>min USD bounty value</td></tr>
        <tr><td><code>maxAgeDays</code></td><td>freshness cap in days</td></tr>
        <tr><td><code>includeSuspect</code></td><td><code>true</code> to include scam-suspect listings</td></tr>
        <tr><td><code>limit</code></td><td>max results (&le;50)</td></tr>
      </tbody>
    </table>
  </section>

  <section>
    <h2>How payment works</h2>
    <ol>
      <li>Call <code>/bounties</code> — the server answers <code>402</code> with machine-readable payment requirements.</li>
      <li>An x402-aware client (e.g. <code>x402-fetch</code>) signs a ${price} USDC payment on ${network} and retries.</li>
      <li>You get the JSON. No account, no key, no KYC — the payment is the auth.</li>
    </ol>
  </section>

  <section>
    <h2>Free endpoints</h2>
    <p><code>GET /</code> returns a machine-readable discovery doc (this page is only served to browsers). <code>GET /health</code> for liveness. An MCP server for agent use ships in this repo under <code>packages/mcp-server</code>.</p>
  </section>

  <footer>
    <span>x402-bounty-radar</span>
    <a href="https://x402.org">x402 protocol</a>
  </footer>
</main>
<script>
document.getElementById("copy").addEventListener("click",function(){
  navigator.clipboard.writeText(${JSON.stringify(curlCmd)}).then(()=>{
    this.textContent="Copied";setTimeout(()=>{this.textContent="Copy curl"},1500);
  });
});
</script>
</body>
</html>`;
}
