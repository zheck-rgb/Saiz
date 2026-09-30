const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const chalk = require('chalk');
const { login } = require('ws3-fca');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'bot_data.json');

// ============================================================
// 💾 DATA — LAHAT NG SETTINGS
// ============================================================
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const defaultData = {
      adminId: "",
      session: "",
      hamolReplies: [
        "uy andyan ka pa ba", "sumagot ka naman", "wag kang magtago",
        "bakit tahimik ka dyan", "hinihintay kita", "andito ka lang ba"
      ],
      trollReplies: [
        "buti naman sumagot ka", "akala ko wala ka na", "dito ka lang pala",
        "hindi ka makakatakas sakin", "wag ka na magtago ha"
      ],
      suffixes: ["", " noh", " ha", " 🤭", " 💀"],
      delayMin: 5000,
      delayMax: 9000,
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
        "Wala kang laban sakin, tanggapin mo na!",
        "Akala ko kung sino, duwag lang pala!",
        "Hindi ka makakaalis dito, akin ka lang!",
        "Wag ka nang magtago, nakikita kita!",
        "Akin ka lang, walang makakakuha sayo!",
        "Talo ka na, sumuko ka na lang!"
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
let botStatus = { online: false };

// ============================================================
// 🔧 HELPERS
// ============================================================
function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randomDelay() {
  return Math.floor(Math.random() * (botData.delayMax - botData.delayMin + 1)) + botData.delayMin;
}
function getUptime() {
  const s = Math.floor((Date.now() - startTime) / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
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
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}mins`;
}

// ============================================================
// 🔒 NO SPAM — SEND ONE AT A TIME
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

async function lockTargetFn(threadID, targetID) {
  lockedTarget = { threadID, targetID, waiting: false };
  const msg = rand(botData.hamolReplies) + rand(botData.suffixes);
  await sendOneMessage(msg, threadID);
  console.log(chalk.red.bold(`🔒 LOCKED → ${targetID}`));
}

async function waitThenNext() {
  if (!lockedTarget || lockedTarget.waiting) return;
  lockedTarget.waiting = true;
  
  setTimeout(async () => {
    if (!lockedTarget) return;
    lockedTarget.waiting = false;
    const msg = rand(botData.hamolReplies) + rand(botData.suffixes);
    await sendOneMessage(msg, lockedTarget.threadID);
    waitThenNext();
  }, randomDelay());
}

async function onTargetReply(msgBody) {
  if (!lockedTarget) return;
  const reply = rand(botData.trollReplies) + rand(botData.suffixes);
  await sendOneMessage(reply, lockedTarget.threadID);
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
  stopLockFn();
  activeThreads.delete(threadID);
  
  const countStart = Date.now();
  console.log(chalk.cyan(`🔢 BILANG ${botData.countFrom}-${botData.countTo} — GC: ${threadID}`));
  
  for (let i = botData.countFrom; i <= botData.countTo; i++) {
    if (!isCounting[threadID]) {
      console.log(chalk.yellow(`🛑 BILANG TINIGIL SA ${i}`));
      return;
    }
    await new Promise(res => setTimeout(res, botData.countDelay));
    await new Promise(res => api.sendMessage(String(i), threadID, () => res()));
    process.stdout.write(`\r🔢 ${i}/${botData.countTo}`);
  }
  
  if (isCounting[threadID]) {
    const duration = formatDuration(Date.now() - countStart);
    const randomReason = rand(botData.reasonList);
    
    const resibo = `
═══════════════════════
   ✅ RESIBO [${botData.receiptTitle}]
═══════════════════════
   MULA: ${botData.countFrom}
   HANGGANG: ${botData.countTo}
   BILANG: ${duration}
   REASON: ${randomReason}
   ORAS: ${getTime()}
═══════════════════════
✅ RESIBO — BILANG TAPOS NA!
💀 SAIZEN COUNT SYSTEM
`.trim();
    
    await new Promise(res => setTimeout(res, 800));
    await new Promise(res => api.sendMessage(resibo, threadID, () => res()));
    console.log(chalk.green(`\n✅ RESIBO NAIPASA — ${getTime()}`));
  }
  
  isCounting[threadID] = false;
}

// ============================================================
// 🚀 MABILIS NA LOGIN — PINABILIS KO NA! ⚡
// ============================================================
function connectBot() {
  if (!botData.session || !botData.adminId) return;
  if (isLoggingIn) return;
  isLoggingIn = true;

  // ⚡ KONTI LANG — MABILIS MAG-LOAD
  const agents = [
    "Mozilla/5.0 (Linux; Android 14; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36"
  ];

  login({
    appState: JSON.parse(botData.session),
    userAgent: rand(agents),
    forceLogin: false,
    logLevel: "silent",
    timeout: 15000 // ⚡ 15s timeout — hindi maghihintay ng matagal
  }, async (err, apiObj) => {
    if (err) {
      reconnectCount++;
      console.log(chalk.red(`🔴 Login failed — Subok ulit...`));
      
      if (isFatalErr(err)) {
        isLoggingIn = false;
        setTimeout(connectBot, 15000); // ⚡ 15s lang
        return;
      }
      
      isLoggingIn = false;
      setTimeout(connectBot, 3000); // ⚡ 3s lang — mabilis na subok ulit!
      return;
    }

    api = apiObj;
    userID = await api.getCurrentUserID();
    reconnectCount = 0;
    isLoggingIn = false;
    botStatus.online = true;
    startTime = Date.now();
    console.log(chalk.green(`✅ ONLINE — MABILIS NA LOGIN! ID: ${userID} 🩸`));

    api.setOptions({
      listenEvents: true,
      selfListen: false,
      online: true,
      autoMarkRead: false,
      autoMarkDelivery: false
    });

    api.listenMqtt((listenErr, event) => {
      if (listenErr) {
        botStatus.online = false;
        console.log(chalk.red("🔴 Reconnecting..."));
        setTimeout(connectBot, 3000); // ⚡ 3s lang
        return;
      }
      if (!event || event.senderID === userID) return;

      const tid = event.threadID;
      const sid = event.senderID;
      const msg = event.body ? event.body.trim() : "";
      const mid = event.messageID;

      // 🔢 BILANG — I-TYPE MO LANG: 1
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

      // ✅ LOCK TARGET
      if (msg.startsWith(".. @") && sid === botData.adminId) {
        const targetID = msg.slice(4).trim();
        if (!targetID) return;
        activeThreads.delete(tid);
        stopLockFn(tid);
        lockTargetFn(tid, targetID);
        waitThenNext();
        api.setMessageReaction("🩸", mid, () => {}, true);
        api.sendMessage(`🔒 LOCKED — NO SPAM ✅\n📍 Target: ${targetID}`, tid);
        return;
      }

      // ✅ STOP LAHAT
      if (msg === ".stop" && sid === botData.adminId) {
        stopLockFn(tid);
        api.setMessageReaction("🩸", mid, () => {}, true);
        api.sendMessage("🛑 TIGIL — LAHAT TUMIGIL 🩸", tid);
        return;
      }

      if (isCounting[tid]) return;
      if (lockedTarget && lockedTarget.threadID === tid && lockedTarget.targetID === sid) {
        onTargetReply(msg);
        return;
      }
      if (!lockedTarget && activeThreads.has(tid) && sid !== botData.adminId && !isSending) {
        const reply = rand(botData.trollReplies) + rand(botData.suffixes);
        sendOneMessage(reply, tid);
      }
    });
  });
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
    uptime: botStatus.online ? getUptime() : null,
    adminId: botData.adminId,
    hasSession: !!botData.session,
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
  res.json({ success: true, message: "✅ Saved — Mabilis na Login!" });
});

app.post('/api/session', (req, res) => {
  try {
    JSON.parse(req.body.session);
    botData.session = req.body.session;
    saveData(botData);
    res.json({ success: true, message: "✅ Session Saved!" });
    setTimeout(connectBot, 2000);
  } catch {
    res.status(400).json({ success: false, message: "❌ Invalid Session JSON" });
  }
});

app.post('/api/restart', (req, res) => {
  lockedTarget = null;
  isCounting = {};
  activeThreads.clear();
  setTimeout(connectBot, 1500);
  res.json({ success: true, message: "🔄 Restarting — Mabilis na!" });
});

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>SAIZEN — Mabilis na Login ✅</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    *{margin:0;padding:0;box-sizing:border-box;font-family:system-ui,-apple-system,sans-serif}
    body{background:#0a0a0a;color:#fff;padding:20px;max-width:900px;margin:0 auto}
    h1{color:#22c55e}
    .stat{background:#121212;padding:15px;border-radius:10px;margin:10px 0;border-left:4px solid #22c55e}
    .on{color:#22c55e;font-weight:bold}
    .off{color:#ef4444;font-weight:bold}
    .card{background:#121212;padding:20px;border-radius:12px;margin:15px 0;border:1px solid #222}
    input,textarea{width:100%;background:#1e1e1e;border:1px solid #333;padding:12px;border-radius:8px;color:#fff;margin:5px 0;font-size:14px}
    button{background:#22c55e;border:none;padding:12px 20px;border-radius:8px;color:#fff;font-weight:bold;cursor:pointer;margin:5px 5px 5px 0;font-size:15px}
    button:hover{background:#16a34a}
    button.sec{background:#333}
    .cmd{background:#1e1e1e;padding:10px;border-radius:6px;font-family:monospace;color:#facc15;margin:5px 0}
    label{display:block;margin:12px 0 4px;font-weight:600;color:#ddd}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .ok{color:#22c55e;margin-top:10px}
    .warn{color:#facc15}
    .resibo-preview{background:#1a1a2e;padding:15px;border-radius:8px;font-family:monospace;white-space:pre-line;color:#ffd700;margin:10px 0}
  </style>
</head>
<body>
  <h1>✅ MABILIS NA LOGIN — SAIZEN BOT</h1>
  <p style="color:#888;margin:10px 0 20px">I-type <strong>1</strong> → bilang 1-50 → resibo — mabilis na mag-o-online!</p>

  <div class="stat">
    <strong>STATUS: </strong><span id="status">Checking...</span>
    <div style="margin-top:8px;font-size:13px;color:#888">
      Uptime: <span id="uptime">-</span> | Counting: <span id="counting">-</span>
    </div>
  </div>

  <div class="card">
    <h3>🔑 C3C Session</h3>
    <textarea id="sessionInput" rows="5" placeholder='Paste C3C/AppState JSON here'></textarea>
    <button onclick="saveSession()">💾 SAVE SESSION</button>
    <div id="sessionMsg" class="ok"></div>
  </div>

  <div class="card">
    <h3>👑 Admin ID</h3>
    <input id="adminInput" placeholder="615xxxxxxxxx">
    <button onclick="saveAdmin()">💾 SAVE ADMIN</button>
  </div>

  <div class="card">
    <h3>🔢 RESIBO SETTINGS</h3>
    <div class="resibo-preview">
═══════════════════════
   ✅ RESIBO [<span id="prevTitle">SAIZEN OWNS YOU</span>]
═══════════════════════
   MULA: <span id="prevFrom">1</span>
   HANGGANG: <span id="prevTo">50</span>
   BILANG: <span id="prevDur">3s bawat isa</span>
   REASON: <span id="prevReason">...</span>
   ORAS: <span id="prevTime">...</span>
═══════════════════════
✅ RESIBO — BILANG TAPOS NA!
💀 SAIZEN COUNT SYSTEM
    </div>
    
    <label>Trigger Command</label>
    <input id="countStartNum" value="1">
    <label>Resibo Title</label>
    <input id="receiptTitle" value="SAIZEN OWNS YOU">
    <div class="grid">
      <div><label>Mula sa</label><input type="number" id="countFrom" value="1"></div>
      <div><label>Hanggang sa</label><input type="number" id="countTo" value="50"></div>
    </div>
    <label>Delay bawat bilang (ms) — 3000 = 3 segundo</label>
    <input type="number" id="countDelay" value="3000">
    <label>Random Reasons</label>
    <textarea id="reasonList" rows="5">Akala mo makakatakas ka sakin? Wala kang takas!
Duwag pala nagtatago pa, lumabas ka dyan!
Hindi ka makakatakas, hawak kita dito!
Sa dulo tayo pa rin, wag ka nang lumaban!
Wala kang laban sakin, tanggapin mo na!</textarea>
    <button onclick="saveCountSettings()">💾 SAVE RESIBO</button>
  </div>

  <div class="card">
    <h3>💀 TROLL REPLIES</h3>
    <label>Hamol Messages</label>
    <textarea id="hamolInput" rows="4"></textarea>
    <label>Reply Messages</label>
    <textarea id="trollInput" rows="4"></textarea>
    <label>Suffixes</label>
    <textarea id="suffixInput" rows="3"></textarea>
    <div class="grid">
      <div><label>Min Delay (ms)</label><input type="number" id="dMin" value="5000"></div>
      <div><label>Max Delay (ms)</label><input type="number" id="dMax" value="9000"></div>
    </div>
    <button onclick="saveTrollSettings()">💾 SAVE TROLL</button>
  </div>

  <div class="card">
    <h3>📝 COMMANDS SA GC</h3>
    <div class="cmd">1</div>
    <p>→ 🔢 Bilang 1-50 → Resibo</p>
    <div class="cmd">.</div>
    <p>→ ✅ Auto-Reply ON</p>
    <div class="cmd">.. @ID</div>
    <p>→ 🔒 LOCK Target</p>
    <div class="cmd">.stop</div>
    <p>→ 🛑 Tigil Lahat</p>
    <button class="sec" onclick="restart()">🔄 RESTART BOT</button>
  </div>

<script>
async function load(){
  const [s,se] = await Promise.all([fetch('/api/status'),fetch('/api/settings')]);
  const st=await s.json(),se=await se.json();
  document.getElementById('status').innerHTML=st.online?'<span class="on">✅ ONLINE — Mabilis na!</span>':'<span class="off">❌ OFFLINE</span>';
  document.getElementById('uptime').textContent=st.uptime||'-';
  document.getElementById('counting').textContent=st.counting.length?st.counting.join(', '):'Wala';
  
  document.getElementById('adminInput').value=se.adminId||'';
  document.getElementById('countStartNum').value=se.countStartNum;
  document.getElementById('receiptTitle').value=se.receiptTitle;
  document.getElementById('countFrom').value=se.countFrom;
  document.getElementById('countTo').value=se.countTo;
  document.getElementById('countDelay').value=se.countDelay;
  document.getElementById('reasonList').value=se.reasonList.join('\\n');
  document.getElementById('hamolInput').value=se.hamolReplies.join('\\n');
  document.getElementById('trollInput').value=se.trollReplies.join('\\n');
  document.getElementById('suffixInput').value=se.suffixes.join('\\n');
  document.getElementById('dMin').value=se.delayMin;
  document.getElementById('dMax').value=se.delayMax;
  
  document.getElementById('prevTitle').textContent=se.receiptTitle;
  document.getElementById('prevFrom').textContent=se.countFrom;
  document.getElementById('prevTo').textContent=se.countTo;
  const rList=se.reasonList;
  document.getElementById('prevReason').textContent=rList[Math.floor(Math.random()*rList.length)];
}
async function saveSession(){
  const r=await fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session:document.getElementById('sessionInput').value})});
  const d=await r.json();document.getElementById('sessionMsg').textContent=d.message;
}
async function saveAdmin(){
  await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({adminId:document.getElementById('adminInput').value})});load();
}
async function saveCountSettings(){
  const reasons=document.getElementById('reasonList').value.split('\\n').filter(x=>x.trim());
  await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    countStartNum:document.getElementById('countStartNum').value.trim(),
    receiptTitle:document.getElementById('receiptTitle').value.trim(),
    countFrom:parseInt(document.getElementById('countFrom').value),
    countTo:parseInt(document.getElementById('countTo').value),
    countDelay:parseInt(document.getElementById('countDelay').value),
    reasonList:reasons
  })});load();alert('✅ Saved!');
}
async function saveTrollSettings(){
  await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    hamolReplies:document.getElementById('hamolInput').value.split('\\n').filter(x=>x),
    trollReplies:document.getElementById('trollInput').value.split('\\n').filter(x=>x),
    suffixes:document.getElementById('suffixInput').value.split('\\n'),
    delayMin:parseInt(document.getElementById('dMin').value),
    delayMax:parseInt(document.getElementById('dMax').value)
  })});load();
}
async function restart(){await fetch('/api/restart',{method:'POST'});setTimeout(load,2000);}
load();setInterval(load,2000); // ⚡ Mabilis na refresh
</script>
</body>
</html>
  `);
});

app.listen(PORT, () => {
  console.log(chalk.green(`\n🚀 DASHBOARD — MABILIS NA LOGIN ✅`));
  console.log(chalk.cyan(`I-type "1" → bilang → resibo — mabilis na mag-o-online!\n`));
  if (botData.session && botData.adminId) connectBot();
});
