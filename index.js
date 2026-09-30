const express = require('express');
const login = require('c3c-arrayfying');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Global System State
let system = {
  status: 'OFFLINE',
  adminId: '',
  appstate: null,
  api: null,
  lastError: 'None',
  suffix: '~ LGC Bot', // Default suffix
  replyPool: [
    "Noted on this!",
    "Sige boss, copy that.",
    "Got it! Babalikan kita mamaya.",
    "Hello! Received your message.",
    "Copy! Sandali lang po.",
    "Noted! Nabasang maigi.",
    "On it! Wait lang nang kaunti.",
    "Copy bossing, acknowledged!",
    "Message received, salamat!",
    "Sige po, noted with thanks.",
    "Copy! Understood.",
    "Alright, copy processing!"
  ],
  activeGCs: new Set(),
  userCooldowns: new Map()
};

const loginOptions = {
  userAgent: "Mozilla/5.0 (Linux; Android 13; SM-S918B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/115.0.5790.166 Mobile Safari/537.36"
};

function startBotSession(retryCount = 0) {
  if (!system.appstate) {
    system.status = 'OFFLINE';
    system.lastError = 'No Appstate / Session provided';
    return;
  }

  system.status = 'CONNECTING...';

  login({ appState: system.appstate }, loginOptions, (err, api) => {
    if (err) {
      system.status = 'OFFLINE';
      system.lastError = err.message || JSON.stringify(err);
      
      const nextRetryDelay = retryCount > 3 ? 10000 : 3000;
      setTimeout(() => startBotSession(retryCount + 1), nextRetryDelay);
      return;
    }

    system.api = api;
    system.status = 'ONLINE';
    system.lastError = 'None';

    api.setOptions({
      listenEvents: true,
      selfListen: false,
      markRead: false,
      listenTyping: false
    });

    api.listenMqtt((lErr, event) => {
      if (lErr) {
        system.lastError = lErr.message || 'MQTT Connection Error';
        setTimeout(() => startBotSession(), 3000);
        return;
      }

      if (event.type === 'message' || event.type === 'message_reply') {
        handleIncomingMessage(api, event);
      }
    });
  });
}

async function handleIncomingMessage(api, event) {
  const { threadID, senderID, body, messageID } = event;
  if (!body) return;

  const cleanBody = body.trim().toLowerCase();

  // 1. ADMIN ONLY COMMANDS
  if (senderID === system.adminId) {
    if (cleanBody === 'on') {
      system.activeGCs.add(threadID);
      api.setMessageReaction("🩸", messageID, () => {}, true);
      api.sendMessage("✅ AUTO-REPLY ON", threadID);
      return;
    }

    if (cleanBody === 'off') {
      system.activeGCs.delete(threadID);
      api.setMessageReaction("🩸", messageID, () => {}, true);
      api.sendMessage("🛑 AUTO-REPLY OFF", threadID);
      return;
    }
  }

  // 2. PER-GC AUTO-REPLY EXECUTION
  if (!system.activeGCs.has(threadID)) return;
  if (senderID === api.getCurrentUserID()) return;

  // 3. ANTI-SPAM (1 Reply per Hour per User)
  const cooldownKey = `${senderID}_${threadID}`;
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;

  if (system.userCooldowns.has(cooldownKey)) {
    const lastReplied = system.userCooldowns.get(cooldownKey);
    if (now - lastReplied < ONE_HOUR) return;
  }

  system.userCooldowns.set(cooldownKey, now);

  // 4. FIXED 5-SECOND DELAY & SUFFIX ATTACHMENT
  setTimeout(() => {
    if (system.replyPool.length === 0) return;

    const baseReply = system.replyPool[Math.floor(Math.random() * system.replyPool.length)];
    const finalReply = system.suffix ? `${baseReply}\n\n${system.suffix}` : baseReply;

    api.sendMessage(finalReply, threadID, messageID);
  }, 5000);
}

// DASHBOARD UI
app.get('/', (req, res) => {
  const html = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LGC Bot Control Center</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #0d1117; color: #c9d1d9; margin: 0; padding: 20px; }
      .container { max-width: 750px; margin: 0 auto; background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 25px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
      h1 { text-align: center; color: #58a6ff; font-size: 24px; margin-bottom: 20px; }
      .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin-bottom: 20px; }
      .card { background: #21262d; border: 1px solid #30363d; padding: 15px; border-radius: 6px; text-align: center; }
      .card-title { font-size: 12px; color: #8b949e; text-transform: uppercase; margin-bottom: 5px; }
      .card-value { font-size: 18px; font-weight: bold; }
      .status-online { color: #3fb950; }
      .status-offline { color: #f85149; }
      .status-connecting { color: #d29922; }
      .form-group { margin-bottom: 15px; }
      label { display: block; margin-bottom: 6px; font-size: 14px; color: #8b949e; font-weight: bold; }
      input, textarea { width: 100%; background: #0d1117; border: 1px solid #30363d; color: #c9d1d9; border-radius: 6px; padding: 10px; font-family: monospace; box-sizing: border-box; }
      textarea { height: 110px; resize: vertical; }
      .btn { width: 100%; padding: 12px; background: #238636; color: #fff; border: none; border-radius: 6px; font-size: 15px; font-weight: bold; cursor: pointer; margin-top: 10px; }
      .btn:hover { background: #2ea043; }
      .btn-danger { background: #da3633; margin-top: 8px; }
      .btn-danger:hover { background: #b62324; }
      .error-box { background: rgba(248,81,73,0.1); border: 1px solid #f85149; color: #f85149; padding: 12px; border-radius: 6px; font-family: monospace; font-size: 13px; margin-bottom: 20px; word-break: break-word; }
      .hint { font-size: 12px; color: #8b949e; margin-top: 4px; display: block; }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>LGC Bot Control Center</h1>

      <div class="grid">
        <div class="card">
          <div class="card-title">Live Status</div>
          <div id="status" class="card-value ${system.status === 'ONLINE' ? 'status-online' : system.status === 'OFFLINE' ? 'status-offline' : 'status-connecting'}">
            ${system.status === 'ONLINE' ? '🟢 ONLINE' : system.status === 'OFFLINE' ? '🔴 Offline' : '🟡 Connecting'}
          </div>
        </div>
        <div class="card">
          <div class="card-title">Active GC Count</div>
          <div id="gcCount" class="card-value" style="color: #58a6ff;">${system.activeGCs.size} GC(s)</div>
        </div>
      </div>

      <div class="form-group">
        <label>Error Box (Eksaktong Dahilan)</label>
        <div id="errorBox" class="error-box">${system.lastError}</div>
      </div>

      <form id="configForm">
        <div class="form-group">
          <label>Admin ID</label>
          <input type="text" id="adminId" value="${system.adminId}" placeholder="I-paste ang Facebook ID mo..." required>
        </div>

        <div class="form-group">
          <label>Suffix Text</label>
          <input type="text" id="suffix" value="${system.suffix}" placeholder="Halimbawa: ~ LGC Auto-Reply Bot">
          <span class="hint">Lalabas sa dulo ng bawat reply ng bot (iwanang blanko kung ayaw mo ng suffix).</span>
        </div>

        <div class="form-group">
          <label>Auto-Reply Messages Pool (1 line = 1 reply)</label>
          <textarea id="replies" placeholder="Ilagay dito ang mga reply, isa bawat linya...">${system.replyPool.join('\n')}</textarea>
          <span class="hint">Pumili ang bot nang random mula sa mga linyang ito.</span>
        </div>

        <div class="form-group">
          <label>Session Input (C3C Appstate JSON)</label>
          <textarea id="appstate" placeholder='Paste Appstate JSON data dito...' required></textarea>
        </div>

        <button type="submit" class="btn">Save & Connect Session</button>
      </form>

      <button id="stopBtn" class="btn btn-danger">Stop Bot</button>
    </div>

    <script>
      document.getElementById('configForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const adminId = document.getElementById('adminId').value.trim();
        const suffix = document.getElementById('suffix').value.trim();
        const repliesRaw = document.getElementById('replies').value.trim();
        const appstateStr = document.getElementById('appstate').value.trim();

        const replyPool = repliesRaw.split('\n').map(r => r.trim()).filter(r => r.length > 0);

        try {
          const appstate = JSON.parse(appstateStr);
          const res = await fetch('/api/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adminId, suffix, replyPool, appstate })
          });
          const data = await res.json();
          alert(data.message);
          location.reload();
        } catch (err) {
          alert('Invalid Appstate JSON Format!');
        }
      });

      document.getElementById('stopBtn').addEventListener('click', async () => {
        const res = await fetch('/api/stop', { method: 'POST' });
        const data = await res.json();
        alert(data.message);
        location.reload();
      });

      setInterval(async () => {
        const res = await fetch('/api/live');
        const data = await res.json();
        
        const statusEl = document.getElementById('status');
        statusEl.innerText = data.status === 'ONLINE' ? '🟢 ONLINE' : data.status === 'OFFLINE' ? '🔴 Offline' : '🟡 Connecting';
        statusEl.className = 'card-value ' + (data.status === 'ONLINE' ? 'status-online' : data.status === 'OFFLINE' ? 'status-offline' : 'status-connecting');
        
        document.getElementById('gcCount').innerText = data.activeGcCount + ' GC(s)';
        document.getElementById('errorBox').innerText = data.lastError;
      }, 3000);
    </script>
  </body>
  </html>
  `;
  res.send(html);
});

// API Routes
app.post('/api/save', (req, res) => {
  const { adminId, suffix, replyPool, appstate } = req.body;
  
  if (system.api) {
    try { system.api.logout(); } catch(e) {}
    system.api = null;
  }

  system.adminId = adminId;
  system.suffix = suffix !== undefined ? suffix : system.suffix;
  if (Array.isArray(replyPool) && replyPool.length > 0) {
    system.replyPool = replyPool;
  }
  system.appstate = appstate;
  
  startBotSession();
  
  res.json({ message: 'Settings, Replies, Suffix, and Session Saved!' });
});

app.post('/api/stop', (req, res) => {
  if (system.api) {
    try { system.api.logout(); } catch(e) {}
    system.api = null;
  }
  system.status = 'OFFLINE';
  system.activeGCs.clear();
  system.lastError = 'Bot stopped manually by admin';
  res.json({ message: 'Bot stopped successfully.' });
});

app.get('/api/live', (req, res) => {
  res.json({
    status: system.status,
    activeGcCount: system.activeGCs.size,
    lastError: system.lastError
  });
});

app.listen(PORT, () => {
  console.log(`[LGC Dashboard] System active at http://localhost:${PORT}`);
});
