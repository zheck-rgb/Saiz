const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const chalk = require('chalk');
const { login } = require('ws3-fca');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'bot_data.json');

// ============================================================
// 💾 DEFAULT SETTINGS
// ============================================================
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const defaultData = {
      adminId: "61594616562680", // ✅ IYONG ADMIN ID
      session: "",
      trollReplies: [
        "buti naman sumagot ka 🩸", "hindi ka makakatakas sakin 💀",
        "talo ka na sumuko ka na lang 😏", "akin ka lang 🔥",
        "wala kang laban tanggapin mo na 😈", "huli ka na 🗡️",
        "duwag pala lumabas ka dyan 💢", "sa dulo tayo pa rin 🖤",
        "wag kang magtago alam kong nandyan ka 👁️", "hindi ako aalis hanggat di ka sumasagot ⚡",
        "sumagot ka naman wag kang duwag 🩸", "andito lang ako hihintayin ka magpakailanman 💀",
        "bakit ka tumatakbo wala kang pupuntahan 🔥", "lumabas ka dyan nakikita kita 😏"
      ],
      suffixes: ["🩸", "💀", "😏", "🔥", "😈", "🤌", "💅", "😂", "💢", "👁️", "🗡️", "⚔️", "🔪", "☠️", "🖤", "👑", "⚡", "🌙"],
      delayMin: 5000,  // ⏱️ 5 segundo
      delayMax: 5000,
      countStartNum: "1",
      countFrom: 1,
      countTo: 50,
      countDelay: 3000,
      receiptTitle: "SAIZEN OWNS YOU",
      reasonList: [
        "Akala mo makakatakas ka sakin? Wala kang takas!",
        "Duwag pala nagtatago pa, lumabas ka dyan!",
        "Hindi ka makakatakas, hawak kita dito!",
        "Sa dulo tayo pa rin, wag ka nang lumaban!",
        "Wala kang laban sakin, tanggapin mo na!"
      ]
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 2));
    return defaultData;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let botData = loadData();
let api = null;
let userID = null;
let isLoggingIn = false;
let activeThreads = new Set(); // ✅ Mga GC na NAKA-ON
let isSending = false;
let isCounting = {};
let startTime = Date.now();

// ============================================================
// 📊 STATUS
// ============================================================
let botStatus = {
  online: false,
  phase: "Naghihintay ng setup...",
  lastError: "",
  attempts: 0
};

function updatePhase(text) {
  botStatus.phase = text;
  console.log(chalk.cyan(`📌 ${text}`));
}

// ============================================================
// 🔧 HELPERS
// ============================================================
function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function getUptime() {
  const s = Math.floor((Date.now() - startTime) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
function isFatalErr(err) {
  if (!err) return false;
  const m = String(err).toLowerCase();
  return m.includes("checkpoint") || m.includes("confirm") || m.includes("blocked") || m.includes("verify");
}
function getTime() {
  return new Date().toLocaleString('ph-PH', { timeZone: 'Asia/Manila' });
}

// ============================================================
// 📤 SAFE SEND — 5s Delay
// ============================================================
function sendOneMessage(text, threadID) {
  return new Promise((resolve) => {
    if (isSending || isCounting[threadID]) { resolve(false); return; }
    isSending = true;
    api.sendMessage(text, threadID, (err) => {
      isSending = false;
      if (err) {
        console.log("❌ Error:", String(err).slice(0, 50));
        resolve(false);
      } else {
        console.log("✅ NAIKIRIM:", text.slice(0, 35));
        resolve(true);
      }
    });
  });
}

// ============================================================
// 🔢 BILANG 1-50 + RESIBO
// ============================================================
async function startCounting(threadID) {
  if (isCounting[threadID]) return;
  isCounting[threadID] = true;
  activeThreads.delete(threadID); // ✅ Patay muna ang auto-reply habang nagbibilang

  for (let i = botData.countFrom; i <= botData.countTo; i++) {
    if (!isCounting[threadID]) return;
    await new Promise(res => setTimeout(res, botData.countDelay));
    await new Promise(res => api.sendMessage(String(i), threadID, () => res()));
  }

  if (isCounting[threadID]) {
    const resibo = `
═══════════════════════
   ✅ RESIBO [${botData.receiptTitle}]
═══════════════════════
   MULA: ${botData.countFrom}
   HANGGANG: ${botData.countTo}
   ORAS: ${getTime()}
═══════════════════════
✅ TAPOS NA!
💀 SAIZEN BOT
`.trim();
    await new Promise(res => setTimeout(res, 800));
    await new Promise(res => api.sendMessage(resibo, threadID, () => res()));
  }
  isCounting[threadID] = false;
}

// ============================================================
// 🚀 LOGIN
// ============================================================
function connectBot() {
  if (!botData.session || !botData.adminId) {
    updatePhase("⚠️ Ilagay Session + Admin ID");
    return;
  }
  if (isLoggingIn) return;

  botStatus.attempts++;
  updatePhase(`🔌 Pagsubok #${botStatus.attempts}...`);
  isLoggingIn = true;

  const agents = [
    "Mozilla/5.0 (Linux; Android 14; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36"
  ];

  try {
    const sessionData = JSON.parse(botData.session);
    login({
      appState: sessionData,
      userAgent: rand(agents),
      forceLogin: false,
      logLevel: "silent",
      timeout: 20000
    }, async (err, apiObj) => {
      if (err) {
        botStatus.lastError = String(err).slice(0, 80);
        if (isFatalErr(err)) {
          updatePhase("⛔ Kailangan ng Confirm — 10s ulit");
          isLoggingIn = false;
          setTimeout(connectBot, 10000);
          return;
        }
        updatePhase("❌ Nabigo — 3s ulit");
        isLoggingIn = false;
        setTimeout(connectBot, 3000);
        return;
      }

      api = apiObj;
      userID = await api.getCurrentUserID();
      isLoggingIn = false;
      botStatus.online = true;
      botStatus.lastError = "";
      startTime = Date.now();
      updatePhase(`🟢 ONLINE — ID: ${userID}`);
      console.log(chalk.green.bold(`✅✅✅ ONLINE: ${userID} ✅✅✅`));

      api.setOptions({
        listenEvents: true, selfListen: false, online: true,
        autoMarkRead: false, autoMarkDelivery: false
      });

      api.listenMqtt((listenErr, event) => {
        if (listenErr) {
          botStatus.online = false;
          updatePhase("🔴 Naputol — Muling kumokonekta...");
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
        // ✅ COMMANDS
        // =====================================================

        // 🔢 BILANG
        if (msg === botData.countStartNum && sid === botData.adminId) {
          api.setMessageReaction("🔢", mid, () => {}, true);
          startCounting(tid);
          return;
        }

        // ✅ I-TYPE MO LANG "." → AAKTIBO ANG GC → KAHIT SINO REREPALYAN!
        if (msg === "." && sid === botData.adminId) {
          activeThreads.add(tid); // ✅ ILAGAY SA ACTIVE
          api.setMessageReaction("🩸", mid, () => {}, true);
          console.log(`✅ GC ${tid} — NAKA-ON NA! KAHIT SINO REREPALYAN NA!`);
          return;
        }

        // 🛑 TIGIL — .stop
        if (msg === ".stop" && sid === botData.adminId) {
          activeThreads.delete(tid);
          isCounting[tid] = false;
          api.setMessageReaction("🩸", mid, () => {}, true);
          api.sendMessage("🛑 TIGIL 🩸", tid);
          console.log(`🛑 GC ${tid} — NAKA-OFF NA`);
          return;
        }

        // =====================================================
        // ✅ AUTO-REPLY — KAHIT SINO!
        // =====================================================
        if (isCounting[tid]) return; // Wag sumagot habang nagbibilang

        // ✅ KUNG NAKA-ON ANG GC — KAHIT SINO REREPALYAN!
        if (activeThreads.has(tid) && !isSending) {
          console.log(`💬 REREPALYAN: ${sid}`);
          const reply = rand(botData.trollReplies) + " " + rand(botData.suffixes);
          sendOneMessage(reply, tid);
        }
      });
    });
  } catch (e) {
    updatePhase("❌ Session mali — Kopyahin mula { hanggang }");
    console.log(chalk.red("Session Error:", e.message));
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
    online: botStatus.online,
    phase: botStatus.phase,
    attempts: botStatus.attempts,
    uptime: botStatus.online ? getUptime() : null,
    activeGCs: activeThreads.size,
    lastError: botStatus.lastError
  });
});

app.post('/api/session', (req, res) => {
  try {
    JSON.parse(req.body.session);
    botData.session = req.body.session;
    saveData(botData);
    res.json({ success: true, message: "✅ Session Saved — Kumokonekta..." });
    setTimeout(connectBot, 1000);
  } catch {
    res.status(400).json({ success: false, message: "❌ Mali — Kopyahin mula { hanggang }" });
  }
});

app.post('/api/restart', (req, res) => {
  activeThreads.clear();
  isCounting = {};
  setTimeout(connectBot, 1000);
  res.json({ success: true });
});

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>SAIZEN BOT — KAHIT SINO ✅</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    *{margin:0;padding:0;box-sizing:border-box;font-family:system-ui,sans-serif}
    body{background:#0a0a0a;color:#fff;padding:20px;max-width:900px;margin:0 auto}
    h1{color:#22c55e}
    .stat{background:#121212;padding:15px;border-radius:10px;margin:10px 0;border-left:4px solid #22c55e}
    .on{color:#22c55e;font-weight:bold}
    .off{color:#ef4444;font-weight:bold}
    .card{background:#121212;padding:20px;border-radius:12px;margin:15px 0;border:1px solid #222}
    input,textarea{width:100%;background:#1e1e1e;border:1px solid #333;padding:12px;border-radius:8px;color:#fff;margin:5px 0}
    button{background:#22c55e;border:none;padding:12px 20px;border-radius:8px;color:#fff;font-weight:bold;cursor:pointer;margin:5px 5px 5px 0}
    button:hover{background:#16a34a}
    .cmd{background:#1e1e1e;padding:10px;border-radius:6px;font-family:monospace;color:#facc15;margin:5px 0}
  </style>
</head>
<body>
  <h1>✅ SAIZEN BOT — KAHIT SINO REREPALYAN!</h1>
  <p style="color:#888;margin:10px 0 20px">I-type mo lang "." sa GC → ACTIVE NA!</p>

  <div class="stat">
    <strong>STATUS: </strong><span id="st">Checking...</span>
    <div style="margin-top:5px;font-size:13px;color:#aaa" id="ph">—</div>
    <div style="margin-top:5px;font-size:12px;color:#666">
      Active GC: <span id="gc">0</span> | Uptime: <span id="up">-</span>
    </div>
  </div>

  <div class="card">
    <h3>🔑 Session JSON</h3>
    <textarea id="ses" rows="6" placeholder='{"appState":[...]}'></textarea>
    <button onclick="ses()">💾 SAVE SESSION</button>
  </div>

  <div class="card">
    <h3>📝 SA GAMITIN SA GC:</h3>
    <div class="cmd">.</div><p>→ I-type ito → NAKA-ON NA! KAHIT SINO REREPALYAN ✅</p>
    <div class="cmd">1</div><p>→ Bilang 1-50 + Resibo</p>
    <div class="cmd">.stop</div><p>→ Tigil lahat</p>
  </div>

<script>
async function ld(){
  const r=await fetch('/api/status');
  const s=await r.json();
  document.getElementById('st').innerHTML=
    s.online?'<span class="on">🟢 ONLINE — GUMAGANA NA!</span>':
    '<span class="off">🔴 Offline</span>';
  document.getElementById('ph').textContent=s.phase;
  document.getElementById('gc').textContent=s.activeGCs;
  document.getElementById('up').textContent=s.uptime||'-';
}
async function ses(){
  const r=await fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session:document.getElementById('ses').value})});
  alert((await r.json()).message);
}
ld();setInterval(ld,1000);
</script>
</body>
</html>
  `);
});

// ============================================================
// ▶️ SIMULA
// ============================================================
app.listen(PORT, () => {
  console.log(chalk.green(`\n🚀 SAIZEN BOT — KAHIT SINO REREPALYAN! ✅`));
  if (botData.session) connectBot();
});
