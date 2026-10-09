// Graph Lab desktop shell (Electron).
// - Saves progress to a JSON file in the user's AppData folder (with a backup copy).
// - Compiles learners' C++ with the bundled MinGW g++ and runs it locally with time and output limits.
const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");

let win = null;
const isWin = process.platform === "win32";
const dataDir = () => app.getPath("userData");
const safeId = (id) => { if (!/^[a-z0-9]{1,32}$/i.test(String(id))) throw new Error("bad profile id"); return String(id); };
const progressFile = (id) => path.join(dataDir(), `progress-${safeId(id)}.json`);
const profilesFile = () => path.join(dataDir(), "profiles.json");
function writeSafely(f, json) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  if (fs.existsSync(f)) { try { fs.copyFileSync(f, f + ".bak"); } catch (e) {} }
  fs.writeFileSync(f + ".tmp", json);
  fs.renameSync(f + ".tmp", f);
}

// ---------- compiler ----------
function compiler() {
  const roots = [path.join(process.resourcesPath || "", "mingw"), path.join(__dirname, "..", "mingw")];
  for (const r of roots) {
    const gpp = path.join(r, "bin", isWin ? "g++.exe" : "g++");
    if (fs.existsSync(gpp)) return { gpp, bin: path.join(r, "bin"), bundled: true };
  }
  return { gpp: isWin ? "g++.exe" : "g++", bin: null, bundled: false }; // fall back to a g++ on PATH (e.g. Code::Blocks)
}
function envWith(bin, extra = {}) {
  const env = { ...process.env, ...extra };
  if (bin) {
    const key = Object.keys(env).find((k) => k.toLowerCase() === "path") || "PATH";
    env[key] = bin + path.delimiter + (env[key] || "");
  }
  return env;
}
// stdin is never piped: Electron's main process can freeze if a child's stdin pipe is closed
// right after spawning. Input is passed as a file instead (like an online judge).
function runProc(cmd, args, { cwd, env, inputFile = null, timeout = 4000, maxOut = 200000 } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let out = "", err = "", killed = false, done = false;
    let child;
    let fd = null;
    try {
      fd = inputFile ? fs.openSync(inputFile, "r") : "ignore";
      child = spawn(cmd, args, { cwd, env, windowsHide: true, stdio: [fd, "pipe", "pipe"] });
    } catch (e) { return resolve({ code: -1, stdout: "", stderr: String(e.message || e), timedOut: false, ms: 0, spawnError: true }); }
    finally { if (typeof fd === "number") { try { fs.closeSync(fd); } catch (e) {} } }
    const finish = (code) => { if (done) return; done = true; clearTimeout(timer); resolve({ code, stdout: out, stderr: err, timedOut: killed, ms: Date.now() - t0 }); };
    const timer = setTimeout(() => { killed = true; try { child.kill("SIGKILL"); } catch (e) {} }, timeout);
    child.stdout.on("data", (d) => { if (out.length < maxOut) out += d.toString(); if (out.length >= maxOut) { killed = true; try { child.kill("SIGKILL"); } catch (e) {} } });
    child.stderr.on("data", (d) => { if (err.length < maxOut) err += d.toString(); });
    child.on("error", (e) => { err += String(e.message || e); finish(-1); });
    child.on("close", (code) => finish(code));
  });
}
ipcMain.handle("cpp:info", async () => {
  const c = compiler();
  const r = await runProc(c.gpp, ["--version"], { env: envWith(c.bin), timeout: 10000 });
  return { found: r.code === 0, bundled: c.bundled, version: r.code === 0 ? r.stdout.split(/\r?\n/)[0] : "" };
});
ipcMain.handle("cpp:run", async (_e, job) => {
  const code = String((job && job.code) || "").slice(0, 200000);
  const stdin = String((job && job.stdin) || "").slice(0, 200000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "graphlab-"));
  try {
    fs.writeFileSync(path.join(dir, "main.cpp"), code);
    const c = compiler();
    const exe = path.join(dir, isWin ? "prog.exe" : "prog");
    const header = path.join(__dirname, "graphlab.h");
    const args = ["-std=c++23", "-O0", "-fdiagnostics-color=never", "-include", header, "-o", exe, "main.cpp"];
    if (isWin) args.splice(2, 0, "-static");
    const comp = await runProc(c.gpp, args, { cwd: dir, env: envWith(c.bin), timeout: 60000 });
    if (comp.spawnError || (comp.code !== 0 && /ENOENT|not recognized/i.test(comp.stderr) && !fs.existsSync(c.gpp)))
      return { stage: "setup", message: "Graph Lab couldn't find its C++ compiler. Reinstall Graph Lab, or install g++ (for example with Code::Blocks) and restart." };
    if (comp.code !== 0) return { stage: "compile", errors: comp.stderr };
    const trace = path.join(dir, "trace.jsonl");
    const inFile = path.join(dir, "input.txt"); fs.writeFileSync(inFile, stdin);
    const r = await runProc(exe, [], { cwd: dir, env: envWith(c.bin, { GL_TRACE: trace }), inputFile: inFile, timeout: 4000 });
    let events = [];
    if (fs.existsSync(trace)) {
      const lines = fs.readFileSync(trace, "utf8").split(/\r?\n/).filter(Boolean).slice(0, 6000);
      for (const l of lines) { try { events.push(JSON.parse(l)); } catch (e) {} }
    }
    return { stage: "run", stdout: r.stdout, stderr: r.stderr, exitCode: r.code, timedOut: r.timedOut, ms: r.ms, events };
  } finally {
    setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }, 1500);
  }
});

// ---------- learners and their progress files ----------
ipcMain.handle("profiles:get", () => {
  try { const d = JSON.parse(fs.readFileSync(profilesFile(), "utf8")); if (Array.isArray(d.profiles)) return d; } catch (e) {}
  // upgrade from 1.0 (single progress.json): keep it as the first learner
  const old = path.join(dataDir(), "progress.json");
  if (fs.existsSync(old)) {
    const id = "p1"; fs.copyFileSync(old, progressFile(id));
    const d = { profiles: [{ id, name: "Learner", avatar: "🐱", createdAt: Date.now() }], last: id };
    writeSafely(profilesFile(), JSON.stringify(d, null, 2)); return d;
  }
  return { profiles: [], last: null };
});
ipcMain.handle("profiles:save", (_e, d) => {
  const clean = { profiles: (d.profiles || []).map((p) => ({ id: safeId(p.id), name: String(p.name || "Learner").slice(0, 24), avatar: String(p.avatar || "🐱").slice(0, 8), createdAt: p.createdAt || Date.now() })), last: d.last ? safeId(d.last) : null };
  writeSafely(profilesFile(), JSON.stringify(clean, null, 2)); return true;
});
ipcMain.handle("profiles:remove", (_e, id) => {
  const f = progressFile(id);
  if (fs.existsSync(f)) fs.renameSync(f, path.join(dataDir(), `removed-${safeId(id)}-${Date.now()}.json`));
  return true;
});
ipcMain.handle("progress:info", (_e, id) => ({ path: progressFile(id) }));
ipcMain.handle("progress:load", (_e, id) => {
  for (const f of [progressFile(id), progressFile(id) + ".bak"]) {
    try { const j = fs.readFileSync(f, "utf8"); JSON.parse(j); return j; } catch (e) {}
  }
  return null;
});
ipcMain.handle("progress:save", (_e, id, json) => {
  JSON.parse(json); // refuse to write anything that isn't valid JSON
  const f = progressFile(id); writeSafely(f, json); return f;
});
ipcMain.handle("progress:export", async (_e, json, name) => {
  const nm = String(name || "").replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "");
  const r = await dialog.showSaveDialog(win, { title: "Export Graph Lab progress", defaultPath: path.join(app.getPath("documents"), `graph-lab-progress${nm ? "-" + nm : ""}.json`), filters: [{ name: "Graph Lab progress", extensions: ["json"] }] });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, json);
  return r.filePath;
});
ipcMain.handle("progress:import", async () => {
  const r = await dialog.showOpenDialog(win, { title: "Import Graph Lab progress", properties: ["openFile"], filters: [{ name: "Graph Lab progress", extensions: ["json"] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  return fs.readFileSync(r.filePaths[0], "utf8").slice(0, 5_000_000);
});

// ---------- window ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 980, minHeight: 640,
    title: "Graph Lab", backgroundColor: "#BCE6EA", autoHideMenuBar: true,
    icon: path.join(__dirname, "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, "index.html"));
  // problem-library links open in the normal browser; the app window never navigates away
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("file:")) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  if (process.env.GRAPHLAB_SELFTEST) require("./selftest")(win, app);
}
app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
