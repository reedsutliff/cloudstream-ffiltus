// GET /api/track/<phrase>[/<profile>]
// Renders the web UI for viewing synced watch history

module.exports = async function handler(req, res) {
  const slug = req.query.slug || [];
  const phrase = Array.isArray(slug) ? slug[0] || "" : slug;
  const activeProfile = Array.isArray(slug) && slug.length > 1 ? slug.slice(1).join("/") : "";

  const html = renderPage(phrase, activeProfile);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(html);
};

function renderPage(phrase, activeProfile) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CloudSync — ${phrase || "Track Watch History"}</title>
<style>
  :root {
    --bg: #0d1117;
    --surface: #161b22;
    --border: #30363d;
    --text: #e6edf3;
    --text-dim: #8b949e;
    --accent: #58a6ff;
    --green: #3fb950;
    --orange: #d29922;
    --font: 'SF Mono', 'Cascadia Code', 'JetBrains Mono', 'Consolas', monospace;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--font);
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 2rem 1rem;
  }
  .container { width: 100%; max-width: 720px; }
  h1 { font-size: 1.4rem; font-weight: 600; margin-bottom: 0.25rem; }
  h1 span { color: var(--accent); }
  .subtitle { color: var(--text-dim); font-size: 0.85rem; margin-bottom: 2rem; }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1.5rem;
    margin-bottom: 1rem;
  }
  .card h2 { font-size: 1rem; color: var(--accent); margin-bottom: 1rem; }
  .phrase-box {
    background: #0d1117;
    border: 2px solid var(--accent);
    border-radius: 8px;
    padding: 1.25rem;
    text-align: center;
    font-size: 1.35rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    word-break: break-all;
    cursor: pointer;
    transition: border-color 0.15s;
    margin-bottom: 1rem;
  }
  .phrase-box:hover { border-color: var(--green); }
  .phrase-hint { font-size: 0.75rem; color: var(--text-dim); text-align: center; margin-bottom: 1.5rem; }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 1.2rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text);
    font-family: var(--font);
    font-size: 0.85rem;
    cursor: pointer;
    transition: all 0.15s;
  }
  .btn:hover { border-color: var(--accent); background: #1c2330; }
  .btn-primary { background: var(--accent); color: #0d1117; font-weight: 600; border-color: var(--accent); }
  .btn-primary:hover { background: #79b8ff; }
  .btn-green { border-color: var(--green); color: var(--green); }
  .btn-green:hover { background: rgba(63,185,80,0.1); }
  .btn-row { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 1rem; }
  input[type="text"] { width: 100%; padding: 0.7rem 0.9rem; background: #0d1117; border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-family: var(--font); font-size: 0.9rem; outline: none; transition: border-color 0.15s; }
  input[type="text"]:focus { border-color: var(--accent); }
  .entry { display: flex; align-items: center; gap: 0.75rem; padding: 0.6rem 0; border-bottom: 1px solid var(--border); }
  .entry:last-child { border-bottom: none; }
  .entry-type { width: 2rem; height: 2rem; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700; flex-shrink: 0; }
  .entry-type.movie { background: #1f3a5f; color: var(--accent); }
  .entry-type.show { background: #1f3f2a; color: var(--green); }
  .entry-info { flex: 1; min-width: 0; }
  .entry-title { font-size: 0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .entry-meta { font-size: 0.72rem; color: var(--text-dim); }
  .entry-time { font-size: 0.7rem; color: var(--text-dim); white-space: nowrap; }
  .profile-chip { display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.35rem 0.7rem; border: 1px solid var(--border); border-radius: 20px; font-size: 0.8rem; cursor: pointer; transition: all 0.15s; }
  .profile-chip:hover, .profile-chip.active { border-color: var(--accent); background: rgba(88,166,255,0.1); }
  .profile-chip .count { background: var(--border); border-radius: 10px; padding: 0 0.4rem; font-size: 0.65rem; line-height: 1.3; }
  .profile-chips { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 1rem; }
  .empty { text-align: center; padding: 2rem 0; color: var(--text-dim); }
  .empty .icon { font-size: 2rem; margin-bottom: 0.5rem; }
  .toast { position: fixed; bottom: 1.5rem; left: 50%; transform: translateX(-50%); background: var(--surface); border: 1px solid var(--green); border-radius: 6px; padding: 0.6rem 1.2rem; font-size: 0.85rem; color: var(--green); opacity: 0; transition: opacity 0.3s; pointer-events: none; z-index: 100; }
  .toast.show { opacity: 1; }
  @media (max-width: 480px) { body { padding: 1rem 0.5rem; } .phrase-box { font-size: 1.1rem; padding: 1rem; } }
</style>
</head>
<body>
<div class="container" id="app">
  <h1>CloudSync <span>⟡</span></h1>
  <div class="subtitle">Cross-device watch history for CloudStream</div>

  <div id="landing-view" ${phrase ? 'style="display:none"' : ""}>
    <div class="card">
      <h2>Start Syncing</h2>
      <p style="color:var(--text-dim);font-size:0.82rem;margin-bottom:1rem;">
        Generate a unique tracking phrase. Share it with your devices to sync watch history — no accounts needed.
      </p>
      <button class="btn btn-primary" onclick="genPhrase()">⟳ Generate Tracking Phrase</button>
      <div class="btn-row">
        <button class="btn" onclick="window.location.href='/track/'+prompt('Enter your tracking phrase:')">I Have a Phrase</button>
      </div>
    </div>
    <div class="card">
      <h2>How It Works</h2>
      <div style="color:var(--text-dim);font-size:0.82rem;line-height:1.6;">
        <p><strong style="color:var(--text);">1.</strong> Open CloudStream → Sync settings → generate a phrase</p>
        <p><strong style="color:var(--text);">2.</strong> App syncs your watch history to the cloud automatically</p>
        <p><strong style="color:var(--text);">3.</strong> On another device, enter the same phrase and select your profile</p>
        <p><strong style="color:var(--text);">4.</strong> CloudStream profiles sync independently within the same group</p>
      </div>
    </div>
  </div>

  <div id="track-view" ${phrase ? "" : 'style="display:none"'}>
    <div class="phrase-box" id="phrase-display" onclick="copyPhrase()" title="Click to copy">${phrase || "—"}</div>
    <div class="phrase-hint" id="phrase-hint">click to copy</div>

    <div class="card" id="profiles-card" style="display:none">
      <h2>Profiles</h2>
      <div class="profile-chips" id="profile-list"></div>
      <div class="btn-row">
        <button class="btn btn-green" onclick="addProfile()">+ Add Profile</button>
      </div>
    </div>

    <div class="card">
      <h2 id="history-heading">Watch History</h2>
      <div id="history-list">
        <div class="empty"><div class="icon">📺</div><p id="history-empty-text">${phrase ? "Loading..." : "Create a phrase to get started"}</p></div>
      </div>
    </div>
  </div>
</div>
<div class="toast" id="toast"></div>

<script>
const PHRASE = ${JSON.stringify(phrase)};
const API = "/api/sync/";
let activeProfile = ${JSON.stringify(activeProfile)};
let data = null;

if (PHRASE) fetchData();

async function fetchData() {
  const emptyText = document.getElementById("history-empty-text");
  try {
    const url = API + encodeURIComponent(PHRASE) + (activeProfile ? "/" + encodeURIComponent(activeProfile) : "");
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 404) setEmpty("Phrase not found — sync from CloudStream first.");
      else setEmpty("Error: " + res.status);
      return;
    }
    data = await res.json();
    renderProfiles();
    renderHistory();
  } catch (e) { setEmpty("Network error: " + e.message); }
}

function renderProfiles() {
  const card = document.getElementById("profiles-card");
  const list = document.getElementById("profile-list");
  if (!data.profiles || Object.keys(data.profiles).length === 0) { card.style.display = "none"; return; }
  card.style.display = "block";
  list.innerHTML = Object.keys(data.profiles).map(name => {
    const count = data.profiles[name].history?.length || 0;
    return '<span class="profile-chip' + (activeProfile === name ? " active" : "") + '" onclick="switchProfile(' + JSON.stringify(name) + ')">' + esc(name) + ' <span class="count">' + count + '</span></span>';
  }).join("");
}

function renderHistory() {
  const list = document.getElementById("history-list");
  const heading = document.getElementById("history-heading");
  const profile = activeProfile ? data.profiles?.[activeProfile] : null;
  const items = [];
  if (profile && profile.history) items.push(...profile.history.map(e => ({ ...e, _profile: "" })));
  else if (data.profiles) {
    for (const [n, p] of Object.entries(data.profiles))
      if (p.history) items.push(...p.history.map(e => ({ ...e, _profile: n })));
  }
  if (items.length === 0) { setEmpty(activeProfile ? "No history for " + activeProfile + " yet." : "No history synced yet."); return; }
  items.sort((a, b) => (b.updatedAt||0) - (a.updatedAt||0));
  heading.textContent = activeProfile ? activeProfile + "'s Watch History" : "All Watch History";
  list.innerHTML = items.map(e => {
    const isMovie = e.season === undefined || e.season === null;
    const meta = isMovie ? (e.timestamp ? fmtTime(e.timestamp) : "") : "S"+String(e.season||0).padStart(2,"0")+" E"+String(e.episode||0).padStart(2,"0")+(e.timestamp ? " \u00b7 "+fmtTime(e.timestamp) : "");
    const tag = e._profile ? '<span style="color:var(--accent);font-size:0.65rem;margin-left:0.3rem">['+esc(e._profile)+']</span>' : "";
    return '<div class="entry"><div class="entry-type '+(isMovie?"movie":"show")+'">'+(isMovie?"\u{1F3AC}":"\u{1F4FA}")+'</div><div class="entry-info"><div class="entry-title">'+esc(e.title)+tag+'</div><div class="entry-meta">'+meta+'</div></div><div class="entry-time">'+timeSince(e.updatedAt)+'</div></div>';
  }).join("");
}

function setEmpty(m) { document.getElementById("history-list").innerHTML = '<div class="empty"><div class="icon">📺</div><p>'+esc(m)+'</p></div>'; document.getElementById("history-heading").textContent = "Watch History"; }

async function switchProfile(n) { activeProfile = n; window.history.pushState({},"","/track/"+encodeURIComponent(PHRASE)+"/"+encodeURIComponent(n)); await fetchData(); }

async function addProfile() { const n = prompt("Profile name:"); if (!n||!n.trim()) return; activeProfile = n.trim(); await fetchData(); }

async function genPhrase() { try { const r = await fetch("/api/generate",{method:"POST"}); const d = await r.json(); if (d.phrase) window.location.href = "/track/"+encodeURIComponent(d.phrase); } catch(e) { alert(e.message); } }

function copyPhrase() { const t = document.getElementById("phrase-display").textContent; if (!t||t==="—") return; navigator.clipboard.writeText(t).then(() => { const h = document.getElementById("phrase-hint"); h.textContent = "\u2713 copied!"; setTimeout(()=>{h.textContent="click to copy"},2000); }); }

function esc(s) { if(typeof s!=="string") s=String(s||""); const d=document.createElement("div"); d.textContent=s; return d.innerHTML; }
function fmtTime(s) { const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=Math.floor(s%60); if(h>0) return h+"h "+m+"m"; if(m>0) return m+"m "+sec+"s"; return sec+"s"; }
function timeSince(t) { const s=Math.floor((Date.now()-t)/1000); if(s<60) return "now"; if(s<3600) return Math.floor(s/60)+"m"; if(s<86400) return Math.floor(s/3600)+"h"; return Math.floor(s/86400)+"d"; }
</script>
</body>
</html>`;
}
