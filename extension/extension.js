"use strict";
const vscode = require("vscode");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

let bundledServerPath = "";

function config() {
  return vscode.workspace.getConfiguration("nekomata");
}

function expandHome(filePath) {
  return filePath.startsWith("~")
    ? path.join(os.homedir(), filePath.slice(1))
    : filePath;
}

function serverScriptPath() {
  const override = config().get("serverScript");
  return override ? expandHome(override) : bundledServerPath;
}

function ping(port) {
  return new Promise((resolve) => {
    const request = http.get(
      { host: "127.0.0.1", port, path: "/data", timeout: 1000 },
      (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      },
    );
    request.on("error", () => resolve(false));
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
  });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fetchData(port) {
  return new Promise((resolve, reject) => {
    const request = http.get(
      { host: "127.0.0.1", port, path: "/data", timeout: 1500 },
      (response) => {
        let body = "";
        response.on("data", (chunk) => { body += chunk; });
        response.on("end", () => {
          try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
        });
      },
    );
    request.on("error", reject);
    request.on("timeout", () => {
      request.destroy();
      reject(new Error("timeout"));
    });
  });
}

async function ensureServer() {
  const port = config().get("port");
  if (await ping(port)) return port;
  const python = config().get("pythonPath") || "python3";
  const script = serverScriptPath();
  const child = spawn(python, [script, "--port", String(port)], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  for (let attempt = 0; attempt < 20; attempt++) {
    await delay(400);
    if (await ping(port)) return port;
  }
  throw new Error(
    `Nekomata server did not start (tried: ${python} ${script} --port ${port}). ` +
    `Is Python 3 on your PATH? Set nekomata.pythonPath if not.`,
  );
}

function cafeHtml(port) {
  const origin = `http://127.0.0.1:${port}`;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; frame-src ${origin} http://localhost:${port}; connect-src ${origin}; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: #2b211d; }
  iframe { border: 0; width: 100%; height: 100%; display: block; }
</style>
</head>
<body>
<iframe id="cafe" src="${origin}/"></iframe>
<script>
  // Watchdog. The iframe's content process can be evicted or crash while the
  // server stays healthy, leaving a blank panel that only a manual webview
  // reload fixed. So liveness is measured on the IFRAME (it acks every render),
  // not on the server — plus a server ping to recover from restarts/sleep.
  const cafe = document.getElementById("cafe");
  const STALE_MS = 10000;
  const RELOAD_COOLDOWN_MS = 15000;
  let lastAliveAt = Date.now();
  let lastReloadAt = Date.now();
  let pushesSinceAlive = 0;

  function reviveCafe(reason) {
    if (Date.now() - lastReloadAt < RELOAD_COOLDOWN_MS) return;
    lastReloadAt = Date.now();
    lastAliveAt = Date.now();
    pushesSinceAlive = 0;
    cafe.src = "${origin}/?revive=" + Date.now() + "&why=" + reason;
  }

  // Relay data pushed by the extension host into the cafe iframe.
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message) return;
    if (message.type === "catCafeAlive") {
      lastAliveAt = Date.now();
      pushesSinceAlive = 0;
      return;
    }
    if (message.type === "catCafeData" && cafe.contentWindow) {
      pushesSinceAlive++;
      cafe.contentWindow.postMessage(message, "${origin}");
    }
  });

  setInterval(async () => {
    // only judge staleness when we've actually been feeding it frames
    if (pushesSinceAlive >= 5 && Date.now() - lastAliveAt > STALE_MS) {
      reviveCafe("stale");
      return;
    }
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 2000);
      const response = await fetch("${origin}/data",
        {cache: "no-store", signal: controller.signal});
      if (!response.ok) throw new Error("bad status");
    } catch (error) {
      // server unreachable (restart / sleep-wake): once it answers again the
      // staleness check above brings the frame back
    }
  }, 3000);

  // coming back into view is the moment a discarded frame is most likely dead
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && pushesSinceAlive >= 5
        && Date.now() - lastAliveAt > STALE_MS)
      reviveCafe("visible");
  });
</script>
</body>
</html>`;
}

function messageHtml(text) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<style>
  html, body { margin: 0; height: 100%; background: #0d0d0d; color: #898781;
    font: 13px/1.5 system-ui, sans-serif; display: flex;
    align-items: center; justify-content: center; }
</style>
</head>
<body><div>${text}</div></body>
</html>`;
}

class NekomataViewProvider {
  async resolveWebviewView(webviewView) {
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = messageHtml("🐱 opening the cafe…");
    const port = config().get("port");
    try {
      await ensureServer();
      webviewView.webview.html = cafeHtml(port);
    } catch (error) {
      webviewView.webview.html = messageHtml(String(error.message || error));
    }
    // Push data from the extension host (Node timers are never throttled,
    // unlike timers/rAF inside the webview iframe). The wrapper relays each
    // snapshot into the iframe via postMessage.
    const pusher = setInterval(async () => {
      try {
        const data = await fetchData(port);
        webviewView.webview.postMessage({ type: "catCafeData", data });
      } catch (error) {
        // server down — the keepalive below respawns it
      }
    }, 1000);
    // Keepalive: if the server process dies while the view is open, respawn it.
    // The in-webview watchdog then revives the iframe once the port answers.
    const keepalive = setInterval(() => {
      ensureServer().catch(() => {});
    }, 15000);
    webviewView.onDidDispose(() => {
      clearInterval(pusher);
      clearInterval(keepalive);
    });
  }
}

function activate(context) {
  bundledServerPath = context.asAbsolutePath("fleet_dashboard.py");
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "nekomata.view",
      new NekomataViewProvider(),
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("nekomata.open", () =>
      vscode.commands.executeCommand("nekomata.view.focus"),
    ),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
