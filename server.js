import crypto from "crypto";
import express from "express";
import {
  MalSession,
  killManagedChrome,
  registerShutdownHandlers,
} from "./src/script.js";

// Load HEADLESS / PORT etc. from .env (optional).
try {
  process.loadEnvFile();
} catch {
  // no .env file present
}

const PORT = Number(process.env.PORT) || 3000;
const IDLE_MS = 15 * 60 * 1000; // close a session after 15 min of inactivity

// One Chrome session per logged-in MAL account. token → entry; loginUsername → token.
const sessions = new Map();
const byUser = new Map();

killManagedChrome(); // clear any Chrome left over from a previous (crashed) run
registerShutdownHandlers(); // closes every session's Chrome on Ctrl+C / termination

// Reap idle sessions so we don't leak Chrome instances.
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of sessions) {
    if (!entry.running && now - entry.lastActive > IDLE_MS) {
      sessions.delete(token);
      byUser.delete(entry.session.loginUsername);
      entry.session.close().catch(() => {});
    }
  }
}, 60 * 1000).unref();

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ───────────────────────────────── Routes ────────────────────────────────

app.get("/", (_req, res) => res.send(loginPage()));

app.post("/login", async (req, res) => {
  const username = (req.body.username || "").trim();
  const password = req.body.password || "";
  if (!username || !password) {
    return res.status(400).send(errorPage("MAL username and password are both required."));
  }

  try {
    // Reuse an existing session for this account, otherwise launch a new one.
    let token = byUser.get(username);
    let entry = token && sessions.get(token);
    if (!entry) {
      const session = new MalSession(username);
      await session.launch();
      token = crypto.randomUUID();
      entry = { session, lastActive: Date.now(), running: false };
      sessions.set(token, entry);
      byUser.set(username, token);
    }
    entry.lastActive = Date.now();

    const result = await entry.session.ensureLoggedIn({ password, allowManual: false });
    if (!result.ok) {
      await entry.session.close();
      sessions.delete(token);
      byUser.delete(username);
      return res.status(401).send(errorPage(`Login failed for "${username}": ${result.error}`));
    }

    return res.send(targetPage(token, username));
  } catch (err) {
    return res.status(500).send(errorPage(`Unexpected error: ${err.message}`));
  }
});

// SSE: streams live progress while sending requests to <target>'s friends.
app.get("/run", async (req, res) => {
  const token = req.query.token;
  const target = (req.query.target || "").trim();
  const entry = sessions.get(token);

  if (!entry) return res.status(404).type("text").send("Invalid or expired session — please log in again.");
  if (!target) return res.status(400).type("text").send("Missing target username.");
  if (entry.running) return res.status(409).type("text").send("A run is already in progress for this account.");

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  entry.running = true;
  entry.lastActive = Date.now();
  const signal = { aborted: false };
  res.on("close", () => { signal.aborted = true; }); // stop if the browser tab closes

  try {
    for await (const ev of entry.session.runFriendRequests(target, signal)) {
      entry.lastActive = Date.now();
      send("progress", ev);
    }
    send("end", { ok: true });
  } catch (err) {
    send("error", { message: err.message });
  } finally {
    entry.running = false;
    entry.lastActive = Date.now();
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`MAL bulk FR server listening on http://localhost:${PORT}`);
  console.log(`HEADLESS=${process.env.HEADLESS || "false"}`);
});

// ───────────────────────────────── Views ─────────────────────────────────

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const layout = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: system-ui, sans-serif; background:#0f1117; color:#e6e6e6; margin:0; padding:2rem; }
  .card { max-width:680px; margin:2rem auto; background:#171a23; border:1px solid #262b38; border-radius:12px; padding:1.5rem 1.75rem; }
  h1 { font-size:1.25rem; margin:0 0 1rem; }
  label { display:block; font-size:.85rem; margin:.75rem 0 .25rem; color:#9aa4b2; }
  input { width:100%; box-sizing:border-box; padding:.6rem .7rem; border-radius:8px; border:1px solid #2c3242; background:#0f1117; color:#e6e6e6; font-size:1rem; }
  button { margin-top:1.1rem; padding:.6rem 1.1rem; border:0; border-radius:8px; background:#3b82f6; color:#fff; font-size:1rem; cursor:pointer; }
  button:disabled { opacity:.5; cursor:default; }
  .err { background:#3b1418; border:1px solid #7f1d22; color:#fecaca; padding:.8rem 1rem; border-radius:8px; }
  .bar { height:14px; background:#0f1117; border:1px solid #2c3242; border-radius:7px; overflow:hidden; margin:1rem 0 .5rem; }
  .bar > div { height:100%; width:0; background:#22c55e; transition:width .2s; }
  #log { font-family:ui-monospace,monospace; font-size:.8rem; white-space:pre-wrap; background:#0f1117; border:1px solid #2c3242; border-radius:8px; padding:.75rem; height:280px; overflow:auto; margin-top:.5rem; }
  a { color:#60a5fa; }
  .muted { color:#9aa4b2; font-size:.85rem; }
</style></head><body><div class="card">${body}</div></body></html>`;

function loginPage() {
  return layout(
    "MAL Bulk FR — Login",
    `<h1>MAL Bulk Friend Request — Login</h1>
     <p class="muted">Log in with the MAL account that will <b>send</b> the requests.</p>
     <form method="post" action="/login">
       <label for="u">MAL username</label>
       <input id="u" name="username" autocomplete="username" required />
       <label for="p">MAL password</label>
       <input id="p" name="password" type="password" autocomplete="current-password" required />
       <button type="submit">Log in</button>
     </form>`
  );
}

function errorPage(message) {
  return layout(
    "MAL Bulk FR — Error",
    `<h1>Something went wrong</h1>
     <p class="err">${escapeHtml(message)}</p>
     <p><a href="/">← Back to login</a></p>`
  );
}

function targetPage(token, loginUsername) {
  return layout(
    "MAL Bulk FR — Send",
    `<h1>Logged in as ${escapeHtml(loginUsername)}</h1>
     <p class="muted">Enter the MAL username whose <b>friends</b> should each receive a friend request.</p>
     <label for="t">Target username</label>
     <input id="t" placeholder="e.g. Ashhk" />
     <button id="go">Send friend requests</button>
     <div class="bar"><div id="fill"></div></div>
     <div id="count" class="muted"></div>
     <div id="log"></div>
     <script>
       const token = ${JSON.stringify(token)};
       const $ = (id) => document.getElementById(id);
       function add(line, color) {
         const el = document.createElement("div");
         if (color) el.style.color = color;
         el.textContent = line;
         $("log").appendChild(el);
         $("log").scrollTop = $("log").scrollHeight;
       }
       const COLORS = { sent:"#22c55e","already-friends":"#a78bfa", pending:"#eab308", invalid:"#f87171", disabled:"#f87171", error:"#f87171", "no-button":"#9aa4b2", "send-failed":"#f87171", unknown:"#9aa4b2" };
       $("go").onclick = () => {
         const target = $("t").value.trim();
         if (!target) { add("Enter a target username first.", "#f87171"); return; }
         $("go").disabled = true; $("t").disabled = true;
         add("Starting for " + target + " ...", "#60a5fa");
         const es = new EventSource("/run?token=" + encodeURIComponent(token) + "&target=" + encodeURIComponent(target));
         es.addEventListener("progress", (e) => {
           const ev = JSON.parse(e.data);
           if (ev.type === "start") { add("Found " + ev.total + " friends of " + target + "."); $("count").textContent = "0 / " + ev.total; }
           else if (ev.type === "visiting") { add("→ visiting (" + (ev.done + 1) + "/" + ev.total + "): " + ev.url, "#9aa4b2"); }
           else if (ev.type === "completed") {
             add("✓ (" + ev.done + "/" + ev.total + ") " + ev.status, COLORS[ev.status] || "#e6e6e6");
             $("count").textContent = ev.done + " / " + ev.total;
             $("fill").style.width = (ev.total ? (ev.done / ev.total * 100) : 0) + "%";
           }
           else if (ev.type === "aborted") { add("Aborted.", "#eab308"); }
           else if (ev.type === "done") { add("All done — " + ev.total + " processed.", "#22c55e"); }
         });
         es.addEventListener("end", () => { es.close(); $("go").disabled = false; $("t").disabled = false; add("Connection closed.", "#9aa4b2"); });
         es.addEventListener("error", (e) => {
           try { add("Error: " + JSON.parse(e.data).message, "#f87171"); } catch { add("Stream error / disconnected.", "#f87171"); }
           es.close(); $("go").disabled = false; $("t").disabled = false;
         });
       };
     </script>`
  );
}
