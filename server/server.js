import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { bruteForcePDF } from './cracker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 3001;

// Store in-memory so we can serve decrypted PDF for download
const sessions = new Map(); // sessionId => { decryptedBuffer, filename }

app.use(cors());
app.use(express.json());

// Serve frontend static files
app.use(express.static(join(__dirname, '..', 'frontend')));

// Multer: store upload in memory
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf' || file.originalname.endsWith('.pdf')) {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed'));
        }
    }
});

/**
 * POST /api/crack
 * Accepts multipart form with field "pdf"
 * Returns Server-Sent Events stream with progress events
 */
app.post('/api/crack', upload.single('pdf'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No PDF file uploaded' });
    }

    const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const originalName = req.file.originalname;

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    function sendEvent(eventType, data) {
        try {
            res.write(`event: ${eventType}\n`);
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch (_) {
            // Client disconnected
        }
    }

    // Send session ID to client so they can download decrypted file
    sendEvent('session', { sessionId, filename: originalName });

    const pdfBuffer = req.file.buffer;

    await bruteForcePDF(pdfBuffer, (event) => {
        switch (event.type) {
            case 'init':
                sendEvent('init', {
                    encrypted: event.encrypted,
                    bufferSize: event.bufferSize,
                    filename: originalName,
                });
                break;

            case 'not_encrypted':
                sendEvent('not_encrypted', { message: 'This PDF is not password-protected.' });
                break;

            case 'wordlist_loaded':
                sendEvent('wordlist_loaded', { count: event.count });
                break;

            case 'progress':
                sendEvent('progress', {
                    attempts:        event.attempts,
                    rate:            event.rate,
                    currentPassword: event.currentPassword,
                    elapsedTime:     parseFloat(event.elapsedTime.toFixed(2)),
                    phase:           event.phase,
                    rowNumber:       event.rowNumber || null,
                });
                break;

            case 'phase_change':
                sendEvent('phase_change', {
                    from:              event.from,
                    to:                event.to,
                    wordlistExhausted: event.wordlistExhausted,
                    wordlistCount:     event.wordlistCount,
                    elapsedTime:       parseFloat(event.elapsedTime.toFixed(2)),
                });
                break;

            case 'found': {
                // Store decrypted buffer for download
                let canDownload = false;
                if (event.decryptedBuffer) {
                    let buf;
                    if (Buffer.isBuffer(event.decryptedBuffer)) {
                        buf = event.decryptedBuffer;
                    } else if (event.decryptedBuffer instanceof Uint8Array) {
                        buf = Buffer.from(event.decryptedBuffer);
                    } else if (ArrayBuffer.isView(event.decryptedBuffer)) {
                        buf = Buffer.from(event.decryptedBuffer.buffer);
                    } else {
                        buf = Buffer.from(event.decryptedBuffer);
                    }
                    sessions.set(sessionId, { buffer: buf, filename: `decrypted_${originalName}` });
                    canDownload = true;
                }
                sendEvent('found', {
                    password:     event.password,
                    attempts:     event.attempts,
                    time:         parseFloat(event.time.toFixed(2)),
                    rowNumber:    event.rowNumber   || null,
                    foundInPhase: event.foundInPhase || 'unknown',
                    sessionId,
                    canDownload,
                });
                break;
            }

            case 'failed':
                sendEvent('failed', {
                    attempts: event.attempts,
                    time:     parseFloat(event.time.toFixed(2)),
                    reason:   event.reason,
                });
                break;

            case 'error':
                sendEvent('error', { message: event.message });
                break;
        }
    }, {
        maxMarkovAttempts: 500000,
        maxTimeSeconds:    180,
        filename:          originalName,
    });

    sendEvent('done', { sessionId });
    res.end();
});

/**
 * GET /api/download/:sessionId
 * Download the decrypted PDF
 */
app.get('/api/download/:sessionId', (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session) {
        return res.status(404).json({ error: 'Session expired or not found' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${session.filename}"`);
    res.send(session.buffer);

    // Clean up session after download (wait 60s)
    setTimeout(() => sessions.delete(req.params.sessionId), 60000);
});

/**
 * Health check
 */
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});

app.listen(PORT, () => {
    console.log(`\n╔════════════════════════════════════════╗`);
    console.log(`║  PDFCRACK.EXE Server                   ║`);
    console.log(`║  Running on http://localhost:${PORT}      ║`);
    console.log(`╚════════════════════════════════════════╝\n`);
});
