#!/usr/bin/env node
"use strict";

/**
 * Minimal HTTP server on 8080 for Fly.io: responds to /health and / so fly-proxy
 * gets a valid HTTP response. Proxies all other paths to the OpenClaw gateway (18789).
 * Run with: node scripts/fly-health-server.js
 */

const http = require("http");
const { spawn } = require("child_process");

const HEALTH_PORT = Number(process.env.PORT) || 8080;
const GATEWAY_PORT = 18789;

const healthServer = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/health/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }
  if (req.url === "/" || req.url === "") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("EDON Claw Gateway running");
    return;
  }
  // Proxy to gateway
  const opts = {
    hostname: "127.0.0.1",
    port: GATEWAY_PORT,
    path: req.url,
    method: req.method,
    headers: req.headers,
  };
  const proxy = http.request(opts, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxy.on("error", (err) => {
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end(`Bad Gateway: ${err.message}`);
  });
  req.pipe(proxy);
});

healthServer.listen(HEALTH_PORT, "0.0.0.0", () => {
  console.log(`[fly-health] listening on 0.0.0.0:${HEALTH_PORT}`);
});

// Spawn gateway on 18789 (so 8080 is free for this server)
const env = { ...process.env, OPENCLAW_GATEWAY_PORT: String(GATEWAY_PORT), OPENCLAW_GATEWAY_BIND: "loopback" };
const gateway = spawn("node", ["dist/index.js", "gateway", "run", "--allow-unconfigured", "--port", String(GATEWAY_PORT), "--bind", "loopback"], {
  cwd: process.cwd(),
  env,
  stdio: "inherit",
});
gateway.on("error", (err) => {
  console.error("[fly-health] gateway spawn error:", err);
  process.exit(1);
});
gateway.on("exit", (code, signal) => {
  console.error("[fly-health] gateway exited", { code, signal });
  process.exit(code !== 0 && code != null ? code : 1);
});
