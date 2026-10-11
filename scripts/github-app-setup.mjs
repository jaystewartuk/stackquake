#!/usr/bin/env node
// node scripts/github-app-setup.mjs <staging|production>
//
// Creates the environment's GitHub App with GitHub's manifest flow (docs/DECISIONS.md, M5) and
// stores its credentials as Worker secrets without showing them: a local server is the manifest's
// redirect, redeems the one-time code itself and pipes the result into `wrangler secret bulk`.
// Open the printed URL in a browser signed in to the GitHub account that should own the app.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";

const env = process.argv[2];
if (env !== "staging" && env !== "production") {
  console.error("usage: node scripts/github-app-setup.mjs <staging|production>");
  process.exit(2);
}
const origin = env === "production" ? "https://stackquake.com" : "https://staging.stackquake.com";
const port = 8787 + (env === "production" ? 11 : 12);
const state = randomBytes(16).toString("hex");

const manifest = {
  name: env === "production" ? "Stackquake" : "Stackquake Staging",
  url: origin,
  description: "Reads your repo's manifests (package.json, Dockerfile, wrangler.toml…) so Stackquake can watch the services and packages your stack depends on. Read-only.",
  hook_attributes: { url: `${origin}/github/webhook`, active: true },
  redirect_url: `http://127.0.0.1:${port}/callback`,
  callback_urls: [`${origin}/app/github/callback`],
  setup_url: `${origin}/app/github/connect`,
  setup_on_update: true,
  public: env === "production",
  default_permissions: { contents: "read", metadata: "read" },
  default_events: ["push"],
  request_oauth_on_install: false,
};

const esc = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const startPage = `<!doctype html><meta charset="utf-8"><title>Create GitHub App</title>
<form id="f" method="post" action="https://github.com/settings/apps/new?state=${state}">
<input type="hidden" name="manifest" value="${esc(JSON.stringify(manifest))}">
<button>Create ${esc(manifest.name)} on GitHub</button></form>
<script>document.getElementById("f").submit()</script>`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(startPage);
    return;
  }
  if (url.pathname !== "/callback") return void res.writeHead(404).end();
  const code = url.searchParams.get("code");
  if (!code || url.searchParams.get("state") !== state) return void res.writeHead(400).end("Bad state");
  const r = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: "POST",
    headers: { accept: "application/vnd.github+json", "user-agent": "stackquake-setup" },
  });
  if (!r.ok) {
    console.error(`GitHub ${r.status} redeeming the manifest code`);
    res.writeHead(502).end("GitHub refused the code; see the terminal.");
    return finish(1);
  }
  const app = await r.json();
  if (!app.pem || !app.client_secret || !app.webhook_secret) {
    console.error("GitHub's answer lacks pem, client_secret or webhook_secret");
    res.writeHead(502).end("Incomplete answer from GitHub; see the terminal.");
    return finish(1);
  }
  const secrets = {
    GITHUB_APP_SLUG: app.slug,
    GITHUB_APP_CLIENT_ID: app.client_id,
    GITHUB_APP_CLIENT_SECRET: app.client_secret,
    GITHUB_APP_PRIVATE_KEY: app.pem,
    GITHUB_WEBHOOK_SECRET: app.webhook_secret,
  };
  const args = ["wrangler", "secret", "bulk", ...(env === "staging" ? ["--env", "staging"] : [])];
  const put = spawnSync("npx", args, { input: JSON.stringify(secrets), stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, CI: "1" } });
  const ok = put.status === 0;
  if (!ok) console.error(`wrangler secret bulk failed:\n${put.stderr}`);
  console.log(JSON.stringify({ env, app: app.slug, id: app.id, client_id: app.client_id, secrets: ok ? Object.keys(secrets) : [], html_url: app.html_url }));
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end(ok ? `${app.slug} created and its secrets stored. You can close this tab.` : "Created, but storing the secrets failed; see the terminal.");
  finish(ok ? 0 : 1);
});

function finish(code) {
  setTimeout(() => process.exit(code), 200);
}

server.listen(port, "127.0.0.1", () => console.log(`Open http://127.0.0.1:${port}/ to create the ${env} GitHub App.`));
setTimeout(() => {
  console.error("Timed out after 10 minutes.");
  process.exit(1);
}, 600_000).unref();
