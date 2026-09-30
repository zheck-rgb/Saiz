const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const chalk = require('chalk');
const { login } = require('ws3-fca');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'bot_data.json');

// ============================================================
// 💾 DATA STORAGE
// ============================================================
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const defaultData = {
      adminId: "",
      session: "",
      hamolReplies: [
        "uy andyan ka pa ba", "sumagot ka naman wag kang duwag",
        "bakit tahimik ka dyan", "wag kang magtago alam kong nandyan ka",
        "hindi ako aalis hanggat di ka sumasagot", "andito lang ako hinihintay ka"
      ],
      trollReplies: [
        "buti naman sumagot ka", "hindi ka makakatakas sakin",
        "talo ka na sumuko ka na lang", "akin ka lang"
      ],
      suffixes: ["🩸", "💀", "😏", "🔥", "😈", "🤌", "🤭", "💅", "😂", "🤡", "🧐", "😒", "🙄", "😎", "🥴", "🫵", "💢", "👁️", "🗡️", "⚔️", "🔪", "☠️", "💣", "🖤", "🕷️", "🕸️", "🦅", "🐍", "👑", "💎", "⚡", "🌑", "🌙"],
      delayMin: 4000,
      delayMax: 8000,
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
let reconnectCount = 0;
let lockedTarget = null;
let activeThreads = new Set();
let isSending = false;
let isCounting = {};
let startTime = Date.now();

// ============================================================
// 📊 STATUS TRACKER — MAKIKITA LAHAT NG NANGYAYARI
// ============================================================
let botStatus = {
  online: false,
  phase: "Naghihintay ng setup...",
  lastError: "",
  attempts: 0,
  lastUpdate: new Date().toLocaleTimeString()
};

function updatePhase(text) {
  botStatus.phase = text;
  botStatus.lastUpdate = new Date().toLocaleTimeString();
  console.log(chalk.cyan(`📌 [${botStatus.lastUpdate}] ${text}`));
}

// ============================================================
// 🔧 HELPERS
// ============================================================
function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randomDelay() {
  return Math.floor(Math.random() * (botData.delayMax - botData.delayMin + 1)) + botData.delayMin;
}
function getUptime() {
  const s = Math.floor((Date.now() - startTime) / 1000);
  if (s < 60) return `${s} segundo`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minuto`;
  return `${Math.floor(m / 60)} oras ${m % 60} minuto`;
}
function isFatalErr(err) {
  if (!err) return false;
  const m = String(err).toLowerCase();
  return m.includes("checkpoint") || m.includes("confirm") || m.includes("blocked") || m.includes("verify") || m.includes("login approval");
}
function getTime() {
  return new Date().toLocaleString('ph-PH', { timeZone: 'Asia/Manila' });
}
function formatDuration(ms) {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec} segundo`;
  return `${Math.floor(sec / 60)} minuto`;
}

// ============================================================
// 🔒 NO SPAM — ISA LANG BAWAT SEND
// ============================================================
function sendOneMessage(text, threadID) {
  return new Promise((resolve) => {
    if (isSending || isCounting[threadID]) { resolve(false); return; }
    isSending = true;
    api.sendMessage(text, threadID, () => {
      isSending = false;
      resolve(true);
    });
  });
}

// ============================================================
// 🔒 LOCK SYSTEM
// ============================================================
async function lockTargetFn(threadID, targetID) {
  lockedTarget = { threadID, targetID, waiting: false };
  const msg = rand(botData.hamolReplies) + " " + rand(botData.suffixes);
  await sendOneMessage(msg, threadID);
  console.log(chalk.red.bold(`🔒 LOCKED → ${targetID}`));
  waitThenNext();
}

async function waitThenNext() {
  if (!lockedTarget || lockedTarget.waiting) return;
  lockedTarget.waiting = true;
  setTimeout(async () => {
    if (!lockedTarget) return;
    lockedTarget.waiting = false;
    const msg = rand(botData.hamolReplies) + " " + rand(botData.suffixes);
    await sendOneMessage(msg, lockedTarget.threadID);
    waitThenNext();
  }, randomDelay());
}

async function onTargetMsg(msgBody, threadID) {
  if (!lockedTarget) return;
  const reply = rand(botData.trollReplies) + " " + rand(botData.suffixes);
  await sendOneMessage(reply, threadID);
  setTimeout(() => { if (lockedTarget) waitThenNext(); }, randomDelay());
}

function stopLockFn(threadID = null) {
  lockedTarget = null;
  isSending = false;
  if (threadID) isCounting[threadID] = false;
  console.log(chalk.yellow(`🛑 TIGIL — LAHAT TUMIGIL`));
}

// ============================================================
// 🔢 BILANG 1-50 + RESIBO
// ============================================================
async function startCounting(threadID) {
  if (isCounting[threadID]) {
    api.sendMessage("⚠️ NAGBIBILANG PA — HINTAYIN TAPOS!", threadID);
    return;
  }
  isCounting[threadID] = true;
  stopLockFn(threadID);
  activeThreads.delete(threadID);

  const countStart = Date.now();
  console.log(chalk.cyan(`🔢 BILANG ${botData.countFrom}-${botData.countTo} NAGSIMULA`));

  for (let i = botData.countFrom; i <= botData.countTo; i++) {
    if (!isCounting[threadID]) {
      console.log(chalk.yellow(`🛑 BILANG TINIGIL SA ${i}`));
      return;
    }
    await new Promise(res => setTimeout(res, botData.countDelay));
    await new Promise(res => api.sendMessage(String(i), threadID, () => res()));
  }

  if (isCounting[threadID]) {
    const duration = formatDuration(Date.now() - countStart);
    const resibo = `
═══════════════════════
   ✅ RESIBO [${botData.receiptTitle}]
═══════════════════════
   MULA: ${botData.countFrom}
   HANGGANG: ${botData.countTo}
   BILANG: ${duration}
   REASON: ${rand(botData.reasonList)}
   ORAS: ${getTime()}
═══════════════════════
✅ RESIBO — TAPOS NA!
💀 SAIZEN BOT
`.trim();
    await new Promise(res => setTimeout(res, 800));
    await new Promise(res => api.sendMessage(resibo, threadID, () => res()));
    console.log(chalk.green(`✅ RESIBO NAIPASA`));
  }
  isCounting[threadID] = false;
}

// ============================================================
// 🚀 LOGIN — DETALYADONG UPDATE ⚡
// ============================================================
function connectBot() {
  if (!botData.session || !botData.adminId) {
    updatePhase("⚠️ Kulang — Ilagay Admin ID + Session sa Dashboard");
    return;
  }
  if (isLoggingIn) {
    updatePhase("⏰ Kasalukuyang nagkokonekta... Hintayin mo");
    return;
  }

  reconnectCount++;
  botStatus.attempts = reconnectCount;
  updatePhase(`🔌 Pagsubok #${reconnectCount} — Nagkonekta...`);
  isLoggingIn = true;

  const agents = [
    "Mozilla/5.0 (Linux; Android 14; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
  ];

  updatePhase("📤 Pagpapadala ng credentials...");

  login({
    appState: JSON.parse(botData.session),
    userAgent: rand(agents),
    forceLogin: false,
    logLevel: "silent",
    timeout: 20000
  }, async (err, apiObj) => {
    if (err) {
      botStatus.lastError = String(err).slice(0, 80);
      
      if (isFatalErr(err)) {
        updatePhase(`⛔ Kailangan ng kumpirmasyon — Maghintay 10s bago subok ulit`);
        console.log(chalk.red(`❌ Fatal Error: ${botStatus.lastError}`));
        isLoggingIn = false;
        setTimeout(connectBot, 10000);
        return;
      }

      updatePhase(`❌ Nabigo — Subok ulit sa 3 segundo...`);
      console.log(chalk.red(`❌ Nabigo: ${botStatus.lastError}`));
      isLoggingIn = false;
      setTimeout(connectBot, 3000);
      return;
    }

    updatePhase("✅ Konektado — Kinukuha ang impormasyon...");
    api = apiObj;
    
    try {
      userID = await api.getCurrentUserID();
    } catch (e) {
      updatePhase("⚠️ Hindi makuha ang User ID — Subok ulit...");
      isLoggingIn = false;
      setTimeout(connectBot, 3000);
      return;
    }

    reconnectCount = 0;
    isLoggingIn = false;
    botStatus.online = true;
    botStatus.lastError = "";
    startTime = Date.now();
    updatePhase(`🟢 ONLINE — Nakakonekta bilang ID: ${userID}`);
    console.log(chalk.green.bold(`\n✅✅✅ ONLINE NA! ID: ${userID} ✅✅✅\n`));

    api.setOptions({
      listenEvents: true, selfListen: false, online: true,
      autoMarkRead: false, autoMarkDelivery: false
    });

    updatePhase("👂 Nakikinig na sa mga mensahe...");

    api.listenMqtt((listenErr, event) => {
      if (listenErr) {
        botStatus.online = false;
        updatePhase("🔴 Naputol ang koneksyon — Muling kumokonekta...");
        setTimeout(connectBot, 3000);
        return;
      }
      if (!event || event.senderID === userID) return;

      const tid = event.threadID;
      const sid = event.senderID;
      const msg = event.body ? event.body.trim() : "";
      const mid = event.messageID;

      // 🔢 BILANG
      if (msg === botData.countStartNum && sid === botData.adminId) {
        api.setMessageReaction("🔢", mid, () => {}, true);
        startCounting(tid);
        return;
      }

      // ✅ AUTO-REPLY ON
      if (msg === "." && sid === botData.adminId) {
        stopLockFn(tid);
        activeThreads.add(tid);
        api.setMessageReaction("🩸", mid, () => {}, true);
        console.log(chalk.green(`✅ AUTO-REPLY ON — GC: ${tid}`));
        return;
      }

      // 🔒 LOCK TARGET
      if (msg.startsWith(".. @") && sid === botData.adminId) {
        const targetID = msg.slice(4).trim();
        if (!targetID) return;
        activeThreads.delete(tid);
        stopLockFn(tid);
        lockTargetFn(tid, targetID);
        api.setMessageReaction("🩸", mid, () => {}, true);
        api.sendMessage(`🔒 LOCKED ✅\n📍 Target: ${targetID}`, tid);
        return;
      }

      // 🛑 STOP
      if (msg === ".stop" && sid === botData.adminId) {
        stopLockFn(tid);
        api.setMessageReaction("🩸", mid, () => {}, true);
        api.sendMessage("🛑 TIGIL 🩸", tid);
        return;
      }

      if (isCounting[tid]) return;
      if (lockedTarget && lockedTarget.threadID === tid && lockedTarget.targetID === sid) {
        onTargetMsg(msg, tid);
        return;
      }
      if (!lockedTarget && activeThreads.has(tid) && sid !== botData.adminId && !isSending) {
        const reply = rand(botData.trollReplies) + " " + rand(botData.suffixes);
        sendOneMessage(reply, tid);
      }
    });
  });
}

// ============================================================
// 🖥️ DASHBOARD — MAKIKITA LAHAT NG UPDATE ⚡
// ============================================================
const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/status', (req, res) => {
  res.json({
    online: botStatus.online,
    phase: botStatus.phase,
    lastUpdate: botStatus.lastUpdate,
    attempts: botStatus.attempts,
    uptime: botStatus.online ? getUptime() : null,
    adminId: botData.adminId,
    hasSession: !!botData.session,
    lastError: botStatus.lastError,
    lockedTarget: lockedTarget?.targetID || null,
    counting: Object.entries(isCounting).filter(([, v]) => v).map(([k]) => k)
  });
});

app.get('/api/settings', (req, res) => {
  res.json({
    adminId: botData.adminId,
    hamolReplies: botData.hamolReplies,
    trollReplies: botData.trollReplies,
    suffixes: botData.suffixes,
    delayMin: botData.delayMin,
    delayMax: botData.delayMax,
    countStartNum: botData.countStartNum,
    countFrom: botData.countFrom,
    countTo: botData.countTo,
    countDelay: botData.countDelay,
    receiptTitle: botData.receiptTitle,
    reasonList: botData.reasonList
  });
});

app.post('/api/settings', (req, res) => {
  const d = req.body;
  if (d.adminId) botData.adminId = d.adminId;
  if (d.hamolReplies) botData.hamolReplies = d.hamolReplies;
  if (d.trollReplies) botData.trollReplies = d.trollReplies;
  if (d.suffixes) botData.suffixes = d.suffixes;
  if (d.delayMin) botData.delayMin = d.delayMin;
  if (d.delayMax) botData.delayMax = d.delayMax;
  if (d.countStartNum) botData.countStartNum = d.countStartNum;
  if (d.countFrom) botData.countFrom = d.countFrom;
  if (d.countTo) botData.countTo = d.countTo;
  if (d.countDelay) botData.countDelay = d.countDelay;
  if (d.receiptTitle) botData.receiptTitle = d.receiptTitle;
  if (d.reasonList) botData.reasonList = d.reasonList;
  saveData(botData);
  res.json({ success: true, message: "✅ Saved!" });
});

app.post('/api/session', (req, res) => {
  try {
    JSON.parse(req.body.session);
    botData.session = req.body.session;
    saveData(botData);
    res.json({ success: true, message: "✅ Session Saved — Sinimulan ang pagkonekta..." });
    setTimeout(connectBot, 1000);
  } catch {
    res.status(400).json({ success: false, message: "❌ Mali ang format — Kopyahin nang BUO mula { hanggang }" });
  }
});

app.post('/api/restart', (req, res) => {
  lockedTarget = null;
  isCounting = {};
  activeThreads.clear();
  botStatus.phase = "🔄 Muling sinimulan...";
  setTimeout(connectBot, 1000);
  res.json({ success: true, message: "🔄 Restarting..." });
});

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>SAIZEN BOT — LIVE STATUS 📡</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    *{margin:0;padding:0;box-sizing:border-box;font-family:system-ui,-apple-system,sans-serif}
    body{background:#0a0a0a;color:#fff;padding:20px;max-width:900px;margin:0 auto}
    h1{color:#22c55e}
    .status-card{background:#121212;padding:15px;border-radius:10px;margin:10px 0;border-left:4px solid #22c55e}
    .phase{font-size:16px;font-weight:bold;margin:5px 0}
    .time{color:#888;font-size:12px}
    .on{color:#22c55e}
    .off{color:#ef4444}
    .warn{color:#facc15}
    .card{background:#121212;padding:20px;border-radius:12px;margin:15px 0;border:1px solid #222}
    input,textarea{width:100%;background:#1e1e1e;border:1px solid #333;padding:12px;border-radius:8px;color:#fff;margin:5px 0}
    button{background:#22c55e;border:none;padding:12px 20px;border-radius:8px;color:#fff;font-weight:bold;cursor:pointer;margin:5px 5px 5px 0}
    button:hover{background:#16a34a}
    button.sec{background:#333}
    .cmd{background:#1e1e1e;padding:10px;border-radius:6px;font-family:monospace;color:#facc15;margin:5px 0}
    label{display:block;margin:12px 0 4px;font-weight:600;color:#ddd}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .error{background:#2a1515;padding:10px;border-radius:6px;color:#fca5a5;margin-top:8px;font-size:13px}
  </style>
</head>
<body>
  <h1>✅ SAIZEN BOT — LIVE STATUS 📡</h1>
  <p style="color:#888;margin:10px 0 20px">Nakikita mo ang lahat ng nangyayari sa real-time</p>

  <!-- LIVE STATUS -->
  <div class="status-card">
    <div><strong>STATUS:</strong> <span id="statusText">Checking...</span></div>
    <div class="phase" id="phaseText">—</div>
    <div class="time">Huling update: <span id="lastUpdate">—</span> | Subok: <span id="attempts">0</span></div>
    <div style="margin-top:5px;font-size:13px;color:#888">
      Uptime: <span id="uptime">-</span> | Locked: <span id="locked">-</span>
    </div>
    <div id="errorBox" class="error" style="display:none"></div>
  </div>

  <div class="card">
    <h3>🔑 C3C Session JSON</h3>
    <p style="color:#facc15;font-size:13px;margin:5px 0">⚠️ Kopyahin nang BUO — mula { hanggang }</p>
    <textarea id="sessionInput" rows="6" placeholder='{"appState":[...]}'></textarea>
    <button onclick="saveSession()">💾 SAVE SESSION</button>
    <div id="sessionMsg" style="margin-top:10px"></div>
  </div>

  <div class="card">
    <h3>👑 Admin ID</h3>
    <input id="adminInput" placeholder="615xxxxxxxxx">
    <button onclick="saveAdmin()">💾 SAVE ADMIN</button>
  </div>

  <div class="card">
    <h3>📝 COMMANDS SA GC</h3>
    <div class="cmd">1</div><p>→ Bilang 1-50 + Resibo</p>
    <div class="cmd">.</div><p>→ Auto-Reply ON</p>
    <div class="cmd">.. @ID</div><p>→ Lock Target</p>
    <div class="cmd">.stop</div><p>→ Tigil Lahat</p>
    <button class="sec" onclick="restart()">🔄 RESTART BOT</button>
  </div>

<script>
async function load(){
  const res = await fetch('/api/status');
  const s = await res.json();
  
  // Status
  document.getElementById('statusText').innerHTML = 
    s.online ? '<span class="on">🟢 ONLINE</span>' : 
    (s.phase.includes("Kailangan") || s.phase.includes("Ilagay") ? 
     '<span class="warn">🟡 Nakaantay</span>' : 
     '<span class="off">🔴 Offline</span>');
  
  // Phase message
  document.getElementById('phaseText').textContent = s.phase;
  document.getElementById('lastUpdate').textContent = s.lastUpdate;
  document.getElementById('attempts').textContent = s.attempts;
  document.getElementById('uptime').textContent = s.uptime || '-';
  document.getElementById('locked').textContent = s.lockedTarget || '-';
  
  // Error display
  const errorBox = document.getElementById('errorBox');
  if(s.lastError){
    errorBox.style.display = 'block';
    errorBox.textContent = '❌ ' + s.lastError;
  } else {
    errorBox.style.display = 'none';
  }
}

async function saveSession(){
  const r = await fetch('/api/session',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({session:document.getElementById('sessionInput').value})
  });
  const d = await r.json();
  document.getElementById('sessionMsg').textContent = d.message;
}

async function saveAdmin(){
  await fetch('/api/settings',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({adminId:document.getElementById('adminInput').value})
  });
}

async function restart(){
  await fetch('/api/restart',{method:'POST'});
}

load();
setInterval(load, 1000); // ⚡ 1 SECOND — LIVE UPDATE
</script>
</body>
</html>
  `);
});

// ============================================================
// ▶️ SIMULA
// ============================================================
app.listen(PORT, () => {
  console.log(chalk.green(`\n🚀 SAIZEN BOT — LIVE STATUS ACTIVE 📡`));
  if (botData.session && botData.adminId) {
    connectBot();
  } else {
    console.log(chalk.yellow(`⚠️ Ilagay Admin ID + BUONG Session sa Dashboard`));
  }
});
