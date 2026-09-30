const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const chalk = require('chalk');
const { login } = require('ws3-fca');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'bot_data.json');

// ============================================================
// 💾 DATA
// ============================================================
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const defaultData = {
      adminId: "61594616562680", // ✅ DEFAULT ADMIN ID MO
      session: "",
      hamolReplies: [
        "uy andyan ka pa ba", "sumagot ka naman wag kang duwag",
        "bakit tahimik ka dyan", "wag kang magtago alam kong nandyan ka",
        "hindi ako aalis hanggat di ka sumasagot", "andito lang ako hinihintay ka"
      ],
      trollReplies: [
        "buti naman sumagot ka 🩸", "hindi ka makakatakas sakin 💀",
        "talo ka na sumuko ka na lang 😏", "akin ka lang 🔥",
        "wala kang laban tanggapin mo na 😈", "huli ka na 🗡️",
        "duwag pala lumabas ka dyan 💢", "sa dulo tayo pa rin 🖤"
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
// 📊 STATUS
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
  return m.includes("checkpoint") || m.includes("confirm") || m.includes("blocked") || m.includes("verify");
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
// 📤 SEND MESSAGE — SAFE
// ============================================================
function sendOneMessage(text, threadID) {
  return new Promise((resolve) => {
    if (isSending || isCounting[threadID]) { 
      console.log("⏳ Busy — hindi magpapadala");
      resolve(false); 
      return; 
    }
    isSending = true;
    api.sendMessage(text, threadID, (err) => {
      isSending = false;
      if (err) {
        console.log("❌ Send error:", String(err).slice(0, 60));
        resolve(false);
      } else {
        console.log("✅ NAIKIRIM:", text.slice(0, 30) + "...");
        resolve(true);
      }
    });
  });
}

// ============================================================
// 🔒 LOCK SYSTEM
// ============================================================
async function lockTargetFn(threadID, targetID) {
  lockedTarget = { threadID, targetID, waiting: false };
  console.log(`🔒 LOCKED → ${targetID} sa GC ${threadID}`);
  const msg = rand(botData.hamolReplies) + " " + rand(botData.suffixes);
  await sendOneMessage(msg, threadID);
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

async function onTargetMsg(sid, tid) {
  if (!lockedTarget) return;
  if (lockedTarget.targetID !== sid) return;
  const reply = rand(botData.trollReplies) + " " + rand(botData.suffixes);
  await sendOneMessage(reply, tid);
  setTimeout(() => { if (lockedTarget) waitThenNext(); }, randomDelay());
}

function stopLockFn(threadID = null) {
  lockedTarget = null;
  isSending = false;
  if (threadID) isCounting[threadID] = false;
  console.log(chalk.yellow(`🛑 TIGIL`));
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
  console.log(chalk.cyan(`🔢 BILANG ${botData.countFrom}-${botData.countTo}`));

  for (let i = botData.countFrom; i <= botData.countTo; i++) {
    if (!isCounting[threadID]) return;
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
  }
  isCounting[threadID] = false;
}

// ============================================================
// 🚀 LOGIN
// ============================================================
function connectBot() {
  if (!botData.session || !botData.adminId) {
    updatePhase("⚠️ Ilagay Admin ID + Session");
    return;
  }
  if (isLoggingIn) return;

  reconnectCount++;
  botStatus.attempts = reconnectCount;
  updatePhase(`🔌 Pagsubok #${reconnectCount} — Nagkonekta...`);
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
          updatePhase(`⛔ Kailangan ng Confirm — Subok ulit 10s`);
          isLoggingIn = false;
          setTimeout(connectBot, 10000);
          return;
        }
        updatePhase(`❌ Nabigo — Subok ulit 3s`);
        isLoggingIn = false;
        setTimeout(connectBot, 3000);
        return;
      }

      api = apiObj;
      userID = await api.getCurrentUserID();
      reconnectCount = 0;
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

        console.log(`📩 [${tid}] ${sid}: "${msg}"`); // ✅ MAKIKITA MO LAHAT NG MENSAHE SA LOG

        // =====================================================
        // ✅ MGA COMMANDS — AYOS NA!
        // =====================================================
        
        // 🔢 BILANG
        if (msg === botData.countStartNum && sid === botData.adminId) {
          api.setMessageReaction("🔢", mid, () => {}, true);
          startCounting(tid);
          return;
        }

        // ✅ AUTO-REPLY ON — TYPING LANG "."
        if (msg === "." && sid === botData.adminId) {
          stopLockFn(tid);
          activeThreads.add(tid);
          api.setMessageReaction("🩸", mid, () => {}, true);
          console.log(`✅ AUTO-REPLY ACTIVE SA GC: ${tid}`);
          return;
        }

        // 🔒 LOCK TARGET — FORMAT: .. @ID
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

        // =====================================================
        // ✅ AUTO-REPLY LOGIC
        // =====================================================
        if (isCounting[tid]) return; // Wag sumagot habang nagbibilang

        // Kung may LOCKED TARGET — sumagot lang sa kanya
        if (lockedTarget && lockedTarget.threadID === tid) {
          if (lockedTarget.targetID === sid) {
            console.log(`🎯 LOCKED TARGET nag-message — REREPALYAN!`);
            onTargetMsg(sid, tid);
          }
          return;
        }

        // Kung ACTIVE GC — sumagot sa LAHAT maliban Admin
        if (activeThreads.has(tid) && sid !== botData.adminId && !isSending) {
          console.log(`💬 AUTO-REPLY sa ${sid}`);
          const reply = rand(botData.trollReplies) + " " + rand(botData.suffixes);
          sendOneMessage(reply, tid);
        }
      });
    });
  } catch (e) {
    updatePhase(`❌ Session Error: Format mali`);
    console.log(chalk.red("❌ Session parse error:", e.message));
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

app.post('/api/settings', (req, res) => {
  const d = req.body;
  if (d.adminId) botData.adminId = d.adminId;
  saveData(botData);
  res.json({ success: true });
});

app.post('/api/restart', (req, res) => {
  lockedTarget = null;
  isCounting = {};
  activeThreads.clear();
  setTimeout(connectBot, 1000);
  res.json({ success: true });
});

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>SAIZEN BOT — AYOS NA ✅</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    *{margin:0;padding:0;box-sizing:border-box;font-family:system-ui,sans-serif}
    body{background:#0a0a0a;color:#fff;padding:20px;max-width:900px;margin:0 auto}
    h1{color:#22c55e}
    .stat{background:#121212;padding:15px;border-radius:10px;margin:10px 0;border-left:4px solid #22c55e}
    .on{color:#22c55e;font-weight:bold}
    .off{color:#ef4444;font-weight:bold}
    .warn{color:#facc15;font-weight:bold}
    .card{background:#121212;padding:20px;border-radius:12px;margin:15px 0;border:1px solid #222}
    input,textarea{width:100%;background:#1e1e1e;border:1px solid #333;padding:12px;border-radius:8px;color:#fff;margin:5px 0}
    button{background:#22c55e;border:none;padding:12px 20px;border-radius:8px;color:#fff;font-weight:bold;cursor:pointer;margin:5px 5px 5px 0}
    button:hover{background:#16a34a}
    button.sec{background:#333}
    .cmd{background:#1e1e1e;padding:10px;border-radius:6px;font-family:monospace;color:#facc15;margin:5px 0}
    label{display:block;margin:12px 0 4px;font-weight:600;color:#ddd}
    .err{background:#2a1515;padding:10px;border-radius:6px;color:#fca5a5;margin-top:8px;display:none}
  </style>
</head>
<body>
  <h1>✅ SAIZEN BOT — NAG-REPLY NA!</h1>
  <p style="color:#888;margin:10px 0 20px">Naka-log + Naka-reply na ✅</p>

  <div class="stat">
    <strong>STATUS: </strong><span id="st">Checking...</span>
    <div style="margin-top:5px;font-size:13px;color:#aaa" id="ph">—</div>
    <div style="margin-top:5px;font-size:12px;color:#666">
      Subok: <span id="at">0</span> | Uptime: <span id="up">-</span>
    </div>
    <div class="err" id="er"></div>
  </div>

  <div class="card">
    <h3>🔑 Session JSON</h3>
    <textarea id="ses" rows="6" placeholder='{"appState":[...]}'></textarea>
    <button onclick="ses()">💾 SAVE SESSION</button>
  </div>

  <div class="card">
    <h3>👑 Admin ID</h3>
    <input id="ad" value="61594616562680">
    <button onclick="adm()">💾 SAVE ADMIN</button>
  </div>

  <div class="card">
    <h3>📝 GAMITIN SA GC:</h3>
    <div class="cmd">.</div><p>→ I-type ito para mag-ON ang Auto-Reply</p>
    <div class="cmd">.. @ID</div><p>→ I-lock ang target — sya lang rereplyan</p>
    <div class="cmd">1</div><p>→ Bilang 1-50 + Resibo</p>
    <div class="cmd">.stop</div><p>→ Tigil lahat</p>
    <button class="sec" onclick="rest()">🔄 RESTART</button>
  </div>

<script>
async function ld(){
  const r=await fetch('/api/status');
  const s=await r.json();
  document.getElementById('st').innerHTML=
    s.online?'<span class="on">🟢 ONLINE — GUMAGANA NA!</span>':
    (s.phase.includes("Ilagay")?'<span class="warn">🟡 Ilagay Session</span>':
    '<span class="off">🔴 Offline</span>');
  document.getElementById('ph').textContent=s.phase;
  document.getElementById('at').textContent=s.attempts;
  document.getElementById('up').textContent=s.uptime||'-';
  const e=document.getElementById('er');
  if(s.lastError){e.style.display='block';e.textContent='❌ '+s.lastError;}
  else e.style.display='none';
}
async function ses(){
  const r=await fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session:document.getElementById('ses').value})});
  alert((await r.json()).message);
}
async function adm(){
  await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({adminId:document.getElementById('ad').value})});
  alert('✅ Admin Saved!');
}
async function rest(){await fetch('/api/restart',{method:'POST'});}
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
  console.log(chalk.green(`\n🚀 SAIZEN BOT — GUMAGANA NA! ✅`));
  if (botData.session && botData.adminId) {
    connectBot();
  } else {
    console.log(chalk.yellow(`⚠️ Ilagay Session sa Dashboard`));
  }
});
