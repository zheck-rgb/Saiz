const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { login } = require('ws3-fca');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'config.json');

// ============================================================
// 💾 CONFIG — IYONG ADMIN ID NA!
// ============================================================
function loadConfig() {
  if (!fs.existsSync(DATA_FILE)) {
    const defaultCfg = {
      adminId: "61594824034922", // ✅ IYONG ID NA!
      session: "",
      replies: [
        "buti naman sumagot ka 🩸",
        "hindi ka makakatakas sakin 💀",
        "talo ka na sumuko ka na lang 😏",
        "akin ka lang 🔥",
        "wala kang laban tanggapin mo na 😈",
        "huli ka na 🗡️",
        "duwag pala lumabas ka dyan 💢",
        "sa dulo tayo pa rin 🖤",
        "wag kang magtago alam kong nandyan ka 👁️",
        "hindi ako aalis hanggat di ka sumasagot ⚡",
        "sumagot ka naman wag ka duwag 🩸",
        "andito lang ako hihintayin ka 💀",
        "bakit ka tumatakbo wala kang pupuntahan 🔥",
        "lumabas ka dyan nakikita kita 😏",
        "alam kong ikaw yan wag ka magtago 🕵️",
        "hindi ka makakatakas kahit saan ka pumunta 🌍"
      ],
      delayMs: 5000
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultCfg, null, 2));
    return defaultCfg;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveConfig(cfg) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(cfg, null, 2));
}

let cfg = loadConfig();
let api = null;
let userID = null;
let isLoggingIn = false;
let activeGCs = new Set();
let isBusy = false;
let status = { online: false, phase: "Naghihintay ng Session...", error: "" };

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ============================================================
// 📤 SAFE SEND — 1 MESSAGE = 1 REPLY, NO SPAM
// ============================================================
function sendReply(text, threadID) {
  return new Promise(resolve => {
    if (isBusy) { resolve(false); return; }
    isBusy = true;
    api.sendMessage(text, threadID, () => {
      isBusy = false;
      console.log(`✅ SENT: ${text.slice(0,35)}...`);
      resolve(true);
    });
  });
}

// ============================================================
// 🚀 LOGIN + AUTO-RECONNECT
// ============================================================
function connectBot() {
  if (!cfg.session || !cfg.adminId) {
    status.phase = "⚠️ Ilagay Session sa Dashboard";
    return;
  }
  if (isLoggingIn) return;
  
  isLoggingIn = true;
  status.phase = "🔌 Kumokonekta sa Facebook...";
  status.error = "";

  try {
    const sessionData = JSON.parse(cfg.session);
    login({
      appState: sessionData,
      userAgent: "Mozilla/5.0 (Linux; Android 14; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
      logLevel: "silent",
      timeout: 20000
    }, async (err, fcaApi) => {
      if (err) {
        status.error = String(err).slice(0, 70);
        const isFatal = status.error.includes("checkpoint") || status.error.includes("confirm") || status.error.includes("blocked");
        status.phase = isFatal ? "⛔ Kailangan ng Confirm — 10s ulit..." : "❌ Nabigo — 3s ulit...";
        isLoggingIn = false;
        setTimeout(connectBot, isFatal ? 10000 : 3000);
        return;
      }

      api = fcaApi;
      userID = await api.getCurrentUserID();
      isLoggingIn = false;
      status.online = true;
      status.phase = "✅ ONLINE — GUMAGANA NA!";
      console.log(`\n🟢 ONLINE NA! ID: ${userID}\n`);

      api.setOptions({
        listenEvents: true,
        selfListen: false,
        online: true,
        autoMarkRead: false,
        autoMarkDelivery: false
      });

      api.listenMqtt((listenErr, event) => {
        if (listenErr) {
          status.online = false;
          status.phase = "🔴 Naputol — Muling kumokonekta...";
          setTimeout(connectBot, 3000);
          return;
        }
        if (!event || event.senderID === userID) return;

        const tid = event.threadID;
        const sid = event.senderID;
        const msg = event.body ? event.body.trim() : "";
        const mid = event.messageID;

        console.log(`📩 [${tid}] ${sid}: "${msg}"`);

        // =====================================================
        // 👑 COMMANDS — IKAW LANG MAKAGAGAWA
        // =====================================================
        
        // ✅ . = AUTO-REPLY ON
        if (msg === "." && sid === cfg.22) {
          activeGCs.add(tid);
          api.setMessageReaction("🩸", mid, () => {}, true);
          console.log(`✅ GC ${tid} — NAKA-ON NA! KAHIT SINO REREPALYAN!`);
          return;
        }

        // ⏹️ .stop = AUTO-REPLY OFF
        if (msg === ".stop" && sid === cfg.adminId) {
          activeGCs.delete(tid);
          api.setMessageReaction("🩸", mid, () => {}, true);
          api.sendMessage("🛑 TIGIL 🩸", tid);
          console.log(`🛑 GC ${tid} — NAKA-OFF NA`);
          return;
        }

        // =====================================================
        // 💬 AUTO-REPLY — KAHIT SINO, 5s DELAY
        // =====================================================
        if (activeGCs.has(tid) && !isBusy) {
          console.log(`💬 REREPALYAN: ${sid}`);
          setTimeout(() => {
            if (!isBusy) sendReply(rand(cfg.replies), tid);
          }, cfg.delayMs);
        }
      });
    });
  } catch (e) {
    status.phase = "❌ Session mali — Kopyahin mula { hanggang }";
    status.error = e.message;
    isLoggingIn = false;
  }
}

// ============================================================
// 🖥️ DASHBOARD
// ============================================================
const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/status', (req, res) => {
  res.json({
    online: status.online,
    phase: status.phase,
    error: status.error,
    activeGCs: activeGCs.size
  });
});

app.post('/api/session', (req, res) => {
  try {
    JSON.parse(req.body.session);
    cfg.session = req.body.session;
    saveConfig(cfg);
    res.json({ success: true, message: "✅ Session Saved — Kumokonekta..." });
    setTimeout(connectBot, 1500);
  } catch {
    res.status(400).json({ success: false, message: "❌ Mali — Kopyahin mula { hanggang }" });
  }
});

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SAIZEN BOT — YOUR ID ✅</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box;font-family:system-ui,sans-serif}
    body{background:#0a0a0a;color:#fff;padding:20px;max-width:600px;margin:0 auto}
    h1{color:#22c55e}
    .stat{background:#121212;padding:15px;border-radius:10px;margin:10px 0;border-left:4px solid #22c55e}
    .on{color:#22c55e;font-weight:bold}
    .off{color:#ef4444;font-weight:bold}
    .card{background:#121212;padding:20px;border-radius:12px;margin:15px 0;border:1px solid #222}
    input,textarea{width:100%;background:#1e1e1e;border:1px solid #333;padding:12px;border-radius:8px;color:#fff;margin:5px 0}
    button{background:#22c55e;border:none;padding:12px 20px;border-radius:8px;color:#fff;font-weight:bold;cursor:pointer;margin:5px 5px 5px 0}
    button:hover{background:#16a34a}
    .cmd{background:#1e1e1e;padding:10px;border-radius:6px;font-family:monospace;color:#facc15;margin:5px 0}
    .err{background:#2a1515;padding:10px;border-radius:6px;color:#fca5a5;margin-top:8px;display:none}
  </style>
</head>
<body>
  <h1>✅ SAIZEN BOT — IYONG ID NA!</h1>
  <p style="color:#888;margin:10px 0">Admin ID: <strong>61594824034922</strong></p>

  <div class="stat">
    <strong>STATUS: </strong><span id="st">Checking...</span>
    <div style="margin-top:8px;font-size:13px;color:#aaa" id="ph">—</div>
    <div style="margin-top:5px;font-size:12px;color:#666">Active GC: <span id="gc">0</span></div>
    <div class="err" id="er"></div>
  </div>

  <div class="card">
    <h3>🔑 Session JSON</h3>
    <p style="color:#facc15;font-size:13px;margin:5px 0">Kopyahin mula { hanggang }</p>
    <textarea id="ses" rows="6" placeholder='{"appState":[...]}'></textarea>
    <button onclick="saveSes()">💾 SAVE SESSION</button>
  </div>

  <div class="card">
    <h3>📝 SA GC:</h3>
    <div class="cmd">.</div><p>→ I-type → ON NA! KAHIT SINO REREPALYAN ✅</p>
    <div class="cmd">.stop</div><p>→ Tigil lahat</p>
  </div>

<script>
async function load(){
  const r=await fetch('/api/status');
  const s=await r.json();
  document.getElementById('st').innerHTML=
    s.online?'<span class="on">🟢 ONLINE — GUMAGANA NA!</span>':
    '<span class="off">🔴 Offline</span>';
  document.getElementById('ph').textContent=s.phase;
  document.getElementById('gc').textContent=s.activeGCs;
  const e=document.getElementById('er');
  if(s.error){e.style.display='block';e.textContent='❌ '+s.error;}
  else e.style.display='none';
}
async function saveSes(){
  const r=await fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session:document.getElementById('ses').value})});
  alert((await r.json()).message);
}
load();setInterval(load,1000);
</script>
</body>
</html>
  `);
});

// ============================================================
// ▶️ SIMULA
// ============================================================
app.listen(PORT, () => {
  console.log("🚀 SAIZEN BOT — IYONG ID NA! READY!");
  if (cfg.session) connectBot();
});
