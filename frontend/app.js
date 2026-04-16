/* ─── PDFCRACK.EXE — Frontend Application Logic ─────────────────────────
   Handles: matrix canvas, drag-drop, SSE streaming, stage transitions,
   Markov matrix visualizer, telemetry bars, clock
   ──────────────────────────────────────────────────────────────────────── */

const API_BASE = 'http://localhost:3001';

// ── State ─────────────────────────────────────────────────────────────────
let state = {
    file: null,
    sessionId: null,
    currentAttempts: 0,
    maxAttempts: 500000,
    wordlistCount: 0,
    cracking: false,
    found: false,
    startTs: null,
};

// ── DOM refs ──────────────────────────────────────────────────────────────
const dropZone        = document.getElementById('drop-zone');
const fileInput       = document.getElementById('file-input');
const fileInfoBar     = document.getElementById('file-info-bar');
const fileNameEl      = document.getElementById('file-name');
const fileSizeEl      = document.getElementById('file-size');
const btnClear        = document.getElementById('btn-clear');
const btnCrack        = document.getElementById('btn-crack');
const clockEl         = document.getElementById('clock');

// ── Clock ─────────────────────────────────────────────────────────────────
function updateClock() {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString('en-GB', { hour12: false });
}
updateClock();
setInterval(updateClock, 1000);

// ── Matrix Canvas (background animation) ──────────────────────────────────
(function initMatrix() {
    const canvas = document.getElementById('matrix-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const cols = Math.floor(canvas.width / 16);
    const drops = Array(cols).fill(1);
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%^&*()_+={}|<>?';

    function draw() {
        ctx.fillStyle = 'rgba(9,15,19,0.06)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#00ff88';
        ctx.font = '13px JetBrains Mono, monospace';

        for (let i = 0; i < drops.length; i++) {
            const char = chars[Math.floor(Math.random() * chars.length)];
            ctx.fillText(char, i * 16, drops[i] * 16);
            if (drops[i] * 16 > canvas.height && Math.random() > 0.975) {
                drops[i] = 0;
            }
            drops[i]++;
        }
    }

    setInterval(draw, 60);

    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    });
})();

// ── Markov Matrix Visualizer ──────────────────────────────────────────────
(function buildMarkovMatrix() {
    const container = document.getElementById('matrix-display');
    const chars = 'abcdefghij'.split('');
    const all = ['', ...chars];

    // Header row
    all.forEach((c, i) => {
        const cell = document.createElement('div');
        cell.className = 'mx-cell hdr';
        cell.textContent = c.toUpperCase();
        cell.dataset.col = i;
        container.appendChild(cell);
    });

    // Data rows
    chars.forEach((rowChar, ri) => {
        const rowLabel = document.createElement('div');
        rowLabel.className = 'mx-cell hdr';
        rowLabel.textContent = rowChar.toUpperCase();
        container.appendChild(rowLabel);

        chars.forEach((colChar, ci) => {
            const cell = document.createElement('div');
            const prob = Math.random();
            cell.className = `mx-cell ${prob > 0.7 ? 'high' : prob > 0.4 ? 'med' : prob > 0.15 ? 'low' : 'zero'}`;
            cell.dataset.row = ri;
            cell.dataset.col = ci + 1;
            container.appendChild(cell);
        });
    });

    // Animate randomly
    setInterval(() => {
        const cells = container.querySelectorAll('[data-row]');
        const target = cells[Math.floor(Math.random() * cells.length)];
        if (!target) return;
        const p = Math.random();
        target.className = `mx-cell ${p > 0.7 ? 'high' : p > 0.4 ? 'med' : p > 0.15 ? 'low' : 'zero'}`;
    }, 300);
})();

// Highlight an active column in the matrix when a password is being tested
function highlightMatrixChar(ch) {
    const container = document.getElementById('matrix-display');
    const chars = 'abcdefghij';
    const idx = chars.indexOf(ch.toLowerCase());
    if (idx < 0) return;
    container.querySelectorAll('.mx-cell').forEach(c => c.classList.remove('active-col'));
    container.querySelectorAll(`[data-col="${idx + 1}"]`).forEach(c => c.classList.add('active-col'));
}

// ── Drag & Drop ───────────────────────────────────────────────────────────
dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) setFile(file);
});
dropZone.addEventListener('click', e => {
    if (e.target.classList.contains('file-label') || e.target === fileInput) return;
    fileInput.click();
});
fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) setFile(fileInput.files[0]);
});
btnClear.addEventListener('click', clearFile);
btnCrack.addEventListener('click', startCrack);

function setFile(file) {
    if (!file.name.endsWith('.pdf') && file.type !== 'application/pdf') {
        alert('[!] Only PDF files are supported.');
        return;
    }
    state.file = file;
    fileNameEl.textContent = file.name;
    fileSizeEl.textContent = formatBytes(file.size);
    fileInfoBar.style.display = 'flex';
    btnCrack.disabled = false;
    resetStages();
}

function clearFile() {
    state.file = null;
    fileInput.value = '';
    fileInfoBar.style.display = 'none';
    btnCrack.disabled = true;
    resetStages();
}

function formatBytes(b) {
    if (b < 1024) return `${b} B`;
    if (b < 1024*1024) return `${(b/1024).toFixed(1)} KB`;
    return `${(b/1024/1024).toFixed(2)} MB`;
}

// ── Stage helpers ─────────────────────────────────────────────────────────
function setStageStatus(n, status) {
    const el = document.getElementById(`s${n}-status`);
    if (!el) return;
    el.className = `stage-status ${status}`;
    el.textContent = status.toUpperCase();
    const stage = document.getElementById(`stage-0${n}`);
    if (stage) {
        stage.className = `stage ${status === 'running' ? 'active' : status === 'done' || status === 'fail' ? 'done' : ''}`;
        if (status === 'fail') stage.className = 'stage error-state';
    }
}

function setStageBody(n, html) {
    const el = document.getElementById(`stage-0${n}-body`);
    if (el) el.innerHTML = html;
}

function resetStages() {
    [1,2,3,4,5].forEach(n => {
        setStageStatus(n, 'idle');
    });
    setStageBody(1, '<div class="stage-placeholder">Awaiting target PDF...</div>');
    setStageBody(2, '<div class="stage-placeholder">Loading character transition probabilities...</div>');
    setStageBody(3, `
        <div class="bf-stats" id="bf-stats" style="display:none;"></div>
        <div class="current-pwd-row" id="current-pwd-row" style="display:none;"></div>
        <div class="pwd-feed" id="pwd-feed"></div>
        <div class="stage-placeholder" id="s3-placeholder">Engine on standby...</div>
    `);
    setStageBody(4, '<div class="stage-placeholder">Awaiting result...</div>');
    setStageBody(5, '<div class="stage-placeholder">Export locked...</div>');

    // Reset telemetry
    setBarProgress(0, 0);
    setBarLoad(0);
    setBarWordlist(0, 0);
    setTelemCard('tc-tested', '0');
    setTelemCard('tc-rate', '—');
    setTelemCard('tc-phase', 'IDLE');
    setTelemCard('tc-session', '—');
    state.currentAttempts = 0;
    state.found = false;
    state.startTs = null;
}

// ── Telemetry helpers ─────────────────────────────────────────────────────
function setBarProgress(attempts, max) {
    const pct = max > 0 ? Math.min(100, Math.round(attempts / max * 100)) : 0;
    document.getElementById('bar-progress').style.width = pct + '%';
    document.getElementById('bar-progress-val').textContent = pct + '%';
}
function setBarLoad(pct) {
    document.getElementById('bar-load').style.width = pct + '%';
    document.getElementById('bar-load-val').textContent = pct + '%';
}
function setBarWordlist(attempts, wlTotal) {
    const pct = wlTotal > 0 ? Math.min(100, Math.round(attempts / wlTotal * 100)) : 0;
    document.getElementById('bar-wl').style.width = pct + '%';
    document.getElementById('bar-wl-val').textContent = pct + '%';
}
function setTelemCard(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

// ── Password feed ─────────────────────────────────────────────────────────
const pwdBuffer = [];
let renderQueued = false;
function appendToPwdFeed(pwd, ts) {
    pwdBuffer.push({ pwd, ts });
    if (!renderQueued) {
        renderQueued = true;
        requestAnimationFrame(() => {
            renderQueued = false;
            const feed = document.getElementById('pwd-feed');
            if (!feed) return;
            // Only keep last 6
            while (pwdBuffer.length > 6) pwdBuffer.shift();
            const lines = pwdBuffer.map(item => `
                <div class="pwd-feed-line">
                    <span class="pwd-ts">[${item.ts}]</span>
                    <span class="pwd-attempt">${htmlEscape(item.pwd)}</span>
                </div>`).join('');
            feed.innerHTML = lines;
            feed.scrollTop = feed.scrollHeight;
        });
    }
}

function htmlEscape(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Start Attack ──────────────────────────────────────────────────────────
async function startCrack() {
    if (!state.file || state.cracking) return;
    state.cracking = true;
    state.startTs = Date.now();
    pwdBuffer.length = 0;

    btnCrack.disabled = true;
    btnCrack.className = 'btn-primary running';
    btnCrack.innerHTML = '<span class="btn-arrow">▶</span> ATTACK IN PROGRESS...';

    resetStages();

    const formData = new FormData();
    formData.append('pdf', state.file);

    let es;
    try {
        // Use fetch to POST, then get SSE stream from the response
        const response = await fetch(`${API_BASE}/api/crack`, {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Server error');
        }

        // Read SSE stream from response body
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split('\n\n');
            buffer = parts.pop(); // keep incomplete chunk
            for (const chunk of parts) {
                processSSEChunk(chunk);
            }
        }

    } catch (err) {
        alert(`[!] Connection error: ${err.message}\n\nMake sure the server is running:\n  cd server && npm start`);
    } finally {
        state.cracking = false;
        btnCrack.className = 'btn-primary';
        btnCrack.innerHTML = '<span class="btn-arrow">&gt;</span> INITIATE ATTACK';
        btnCrack.disabled = !state.file;
    }
}

// ── SSE Parser ────────────────────────────────────────────────────────────
function processSSEChunk(chunk) {
    let eventType = 'message';
    let dataStr = '';

    for (const line of chunk.split('\n')) {
        if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
            dataStr = line.slice(6).trim();
        }
    }

    if (!dataStr) return;

    let data;
    try { data = JSON.parse(dataStr); } catch { return; }

    handleSSEEvent(eventType, data);
}

// ── SSE Event Handler ─────────────────────────────────────────────────────
function handleSSEEvent(type, data) {
    switch (type) {
        case 'session':
            state.sessionId = data.sessionId;
            setTelemCard('tc-session', data.sessionId.slice(-8).toUpperCase());
            break;

        case 'init':
            setStageStatus(1, 'done');
            if (!data.encrypted) {
                setStageBody(1, `
                    <div class="init-info">
                        <div class="init-row"><span class="init-label">STATUS</span><span class="init-val red">NOT ENCRYPTED</span></div>
                        <div class="init-row"><span class="init-label">FILE</span><span class="init-val">${htmlEscape(data.filename || '—')}</span></div>
                        <div class="init-row"><span class="init-label">SIZE</span><span class="init-val">${formatBytes(data.bufferSize || 0)}</span></div>
                    </div>
                `);
            } else {
                setStageBody(1, `
                    <div class="init-info">
                        <div class="init-row"><span class="init-label">ENCRYPTION</span><span class="init-val green">DETECTED ✓</span></div>
                        <div class="init-row"><span class="init-label">FILE</span><span class="init-val">${htmlEscape(data.filename || '—')}</span></div>
                        <div class="init-row"><span class="init-label">SIZE</span><span class="init-val">${formatBytes(data.bufferSize || 0)}</span></div>
                        <div class="init-row"><span class="init-label">ATTACK MODE</span><span class="init-val green">AES / RC4</span></div>
                    </div>
                `);
                setStageStatus(2, 'running');
            }
            break;

        case 'not_encrypted':
            setStageBody(1, `<div class="stage-placeholder" style="color:var(--error)">[!] ${data.message}</div>`);
            setStageStatus(1, 'fail');
            break;

        case 'wordlist_loaded':
            state.wordlistCount = data.count;
            setStageStatus(2, 'done');
            setStageBody(2, `
                <div class="init-info">
                    <div class="init-row"><span class="init-label">WORDLIST ENTRIES</span><span class="init-val green">${data.count.toLocaleString()}</span></div>
                    <div class="init-row"><span class="init-label">MARKOV CHARS</span><span class="init-val green">86 symbols</span></div>
                    <div class="init-row"><span class="init-label">WEIGHT MODEL</span><span class="init-val green">LOADED ✓</span></div>
                    <div class="init-row"><span class="init-label">STRATEGY</span><span class="init-val">DICT → NEURAL</span></div>
                </div>
            `);
            setStageStatus(3, 'running');
            // Show brute-force UI
            setStageBody(3, `
                <div class="bf-stats" id="bf-stats">
                    <div class="stat-box"><div class="stat-label">ATTEMPTS</div><div class="stat-val" id="stat-attempts">0</div></div>
                    <div class="stat-box"><div class="stat-label">RATE</div><div class="stat-val" id="stat-rate">— p/s</div></div>
                    <div class="stat-box"><div class="stat-label">ELAPSED</div><div class="stat-val" id="stat-elapsed">0.0s</div></div>
                    <div class="stat-box"><div class="stat-label">PHASE</div><div class="stat-val" id="stat-phase">DICT</div></div>
                </div>
                <div class="current-pwd-row" id="current-pwd-row">
                    <span class="cpwd-label">&gt; TESTING:</span>
                    <span class="cpwd-val" id="current-pwd">...</span>
                </div>
                <div class="pwd-feed" id="pwd-feed"></div>
            `);
            break;

        case 'progress': {
            state.currentAttempts = data.attempts;
            const attempts = data.attempts;
            const rate     = data.rate;
            const elapsed  = data.elapsedTime;
            const phase    = data.phase === 'dictionary' ? 'DICT' : 'MARKOV';
            const pwd      = data.currentPassword || '';

            // Update stat boxes
            const saEl = document.getElementById('stat-attempts');
            const srEl = document.getElementById('stat-rate');
            const seEl = document.getElementById('stat-elapsed');
            const spEl = document.getElementById('stat-phase');
            const cpEl = document.getElementById('current-pwd');
            if (saEl) saEl.textContent = attempts.toLocaleString();
            if (srEl) srEl.textContent = `${rate.toLocaleString()} p/s`;
            if (seEl) seEl.textContent = `${elapsed.toFixed(1)}s`;
            if (spEl) spEl.textContent = phase;
            if (cpEl) cpEl.textContent = pwd;

            // Feed
            const ts = new Date().toLocaleTimeString('en-GB', { hour12: false });
            appendToPwdFeed(pwd, ts);

            // Markov highlight
            if (pwd.length > 0) highlightMatrixChar(pwd[0]);

            // Telemetry
            const loadPct = Math.min(95, 30 + (rate / 5000 * 65));
            setBarProgress(attempts, state.maxAttempts);
            setBarLoad(Math.round(loadPct));
            setBarWordlist(attempts, state.wordlistCount);
            setTelemCard('tc-tested', attempts.toLocaleString());
            setTelemCard('tc-rate', `${rate.toLocaleString()} p/s`);
            setTelemCard('tc-phase', phase);
            break;
        }

        case 'found':
            state.found = true;
            setStageStatus(3, 'done');
            setStageStatus(4, 'done');
            setStageStatus(5, 'running');

            setStageBody(4, `
                <div class="found-box">
                    <div class="found-badge">✓ PASSWORD CRACKED</div>
                    <div class="found-password">${htmlEscape(data.password)}</div>
                    <div class="found-meta">
                        <span>ATTEMPTS: <strong>${(data.attempts || 0).toLocaleString()}</strong></span>
                        <span>TIME: <strong>${(data.time || 0).toFixed(2)}s</strong></span>
                    </div>
                </div>
            `);

            if (data.canDownload && data.sessionId) {
                setStageBody(5, `
                    <div class="export-box">
                        <button class="btn-download" onclick="downloadPDF('${data.sessionId}')">
                            ⬇ DOWNLOAD DECRYPTED PDF
                        </button>
                        <div class="export-note">File ready // Session expires in 60 seconds</div>
                    </div>
                `);
                setStageStatus(5, 'done');
            } else {
                setStageBody(5, `
                    <div class="export-box">
                        <div class="export-note" style="color:var(--primary)">Password found: <strong>${htmlEscape(data.password)}</strong><br>Use the password to open your PDF manually.</div>
                    </div>
                `);
                setStageStatus(5, 'done');
            }

            // Telemetry final
            setBarProgress(data.attempts || state.currentAttempts, state.maxAttempts);
            setBarLoad(0);
            break;

        case 'failed':
            setStageStatus(3, 'fail');
            setStageStatus(4, 'fail');
            setStageBody(4, `
                <div class="failed-box">
                    <div class="failed-title">✕ CRACK FAILED</div>
                    <div class="failed-meta">
                        REASON: ${htmlEscape(data.reason || 'Unknown')}<br>
                        ATTEMPTS: ${(data.attempts || 0).toLocaleString()}<br>
                        TIME: ${(data.time || 0).toFixed(2)}s<br><br>
                        Password not in dictionary or Markov model coverage.
                    </div>
                </div>
            `);
            setBarLoad(0);
            break;

        case 'error':
            setStageStatus(1, 'fail');
            setStageBody(1, `<div class="stage-placeholder" style="color:var(--error)">[!] ERROR: ${htmlEscape(data.message)}</div>`);
            break;

        case 'done':
            // streaming complete — no-op; individual events handled above
            break;

        default:
            break;
    }
}

// ── Download decrypted PDF ─────────────────────────────────────────────────
window.downloadPDF = function(sessionId) {
    const url = `${API_BASE}/api/download/${sessionId}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = 'decrypted.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
};

// ── Health check on load ──────────────────────────────────────────────────
(async function checkServer() {
    try {
        const res = await fetch(`${API_BASE}/api/health`);
        if (!res.ok) throw new Error('not ok');
        document.getElementById('server-status-dot').className = 'status-dot active';
        document.getElementById('server-status-text').textContent = 'SYS:ONLINE';
    } catch {
        document.getElementById('server-status-dot').className = 'status-dot error';
        document.getElementById('server-status-text').textContent = 'SRV:OFFLINE';
    }
})();
