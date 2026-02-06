// server.js — Express API + optional static frontend (Windows + Git Bash compatible)
import express from "express";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.BIND || process.env.HOST || "0.0.0.0";

// JSON body parsing for API
app.use(express.json());

// ——— API routes (so they are never overridden by static or SPA fallback) ———
// List of API paths for discoverability
app.get("/api/routes", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.json({
    routes: [
      { path: "/api/health", method: "GET", description: "Health check; returns status and token_set" },
      { path: "/api/run-cli", method: "GET", description: "Run OpenClaw gateway CLI (gateway --allow-unconfigured); returns output or error" },
      { path: "/api/run-cli", method: "POST", description: "Same as GET; accepts optional JSON body" },
      { path: "/api/routes", method: "GET", description: "List API routes" },
    ],
  });
});

app.get("/api/health", (req, res) => {
  console.log("[openclaw] GET /api/health");
  res.setHeader("Content-Type", "application/json");
  res.json({
    status: "EDON Claw Gateway is alive!",
    token_set: !!process.env.OPENCLAW_GATEWAY_TOKEN,
  });
});

function handleRunCli(req, res) {
  const distPath = path.resolve(__dirname, "dist", "index.js");
  const cli = spawn("node", [distPath, "gateway", "--allow-unconfigured"], {
    cwd: __dirname,
    shell: false,
    env: { ...process.env },
  });

  let output = "";
  let errorOutput = "";

  cli.stdout.on("data", (data) => (output += data.toString()));
  cli.stderr.on("data", (data) => (errorOutput += data.toString()));

  cli.on("close", (code, signal) => {
    res.setHeader("Content-Type", "application/json");
    if (signal) {
      return res.status(500).json({ error: `CLI terminated with signal ${signal}`, details: errorOutput });
    }
    if (code !== 0) {
      const alreadyRunning =
        /already running|gateway already running|Port .+ is already in use|lock timeout/i.test(errorOutput);
      if (alreadyRunning) {
        return res.status(200).json({
          output: errorOutput,
          message: "Gateway is already running; no new process started.",
          already_running: true,
        });
      }
      return res.status(500).json({ error: `CLI exited with code ${code}`, details: errorOutput });
    }
    res.json({ output });
  });

  cli.on("error", (err) => {
    res.setHeader("Content-Type", "application/json");
    res.status(500).json({ error: "Failed to start CLI", details: String(err.message) });
  });
}

app.get("/api/run-cli", handleRunCli);
app.post("/api/run-cli", handleRunCli);

// ——— Static frontend (Vite build output) ———
const staticDir = path.resolve(__dirname, "dist", "control-ui");
app.use(express.static(staticDir));

// ——— SPA fallback: serve index.html for non-API GET requests (Express 5 / path-to-regexp 8 safe)
app.use((req, res, next) => {
  if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
  const indexFile = path.join(staticDir, "index.html");
  res.sendFile(indexFile, (err) => {
    if (err) next();
  });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`[openclaw] HTTP server listening on ${HOST}:${PORT}`);
});

server.on("error", (err) => {
  console.error("[openclaw] server error:", err);
  process.exitCode = 1;
});

process.on("uncaughtException", (err) => {
  console.error("[openclaw] uncaughtException:", err);
  process.exitCode = 1;
});
