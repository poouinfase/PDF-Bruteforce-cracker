import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { PDFEncryptionChecker } from './pdfcheck.js';
import { generateMarkovPassword } from './weightLoader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Two-phase brute force:
 *   Phase 1 — Full wordlist (dictionary). Every entry is tested in order.
 *              If found, reports row number and stops immediately.
 *   Phase 2 — Markov-weighted generation. Only runs if Phase 1 exhausts
 *              the entire wordlist without a match.
 *
 * Events emitted via onEvent:
 *   { type: 'init',             encrypted, bufferSize, filename }
 *   { type: 'not_encrypted' }
 *   { type: 'wordlist_loaded',  count }
 *   { type: 'progress',         attempts, rate, currentPassword, elapsedTime,
 *                                phase ('dictionary'|'markov'), rowNumber? }
 *   { type: 'found',            password, attempts, time, rowNumber?,
 *                                foundInPhase ('dictionary'|'markov'),
 *                                decryptedBuffer }
 *   { type: 'phase_change',     from: 'dictionary', to: 'markov',
 *                                wordlistExhausted: true, wordlistCount }
 *   { type: 'failed',           attempts, time, reason }
 *   { type: 'error',            message }
 */
export async function bruteForcePDF(pdfBuffer, onEvent, options = {}) {
    const {
        maxMarkovAttempts = 500000,
        maxTimeSeconds = 180,
        filename = 'uploaded.pdf',
    } = options;

    const checker = new PDFEncryptionChecker(pdfBuffer);

    // ── STAGE 1: Encryption check ─────────────────────────────────────────
    let encrypted;
    try {
        encrypted = await checker.isEncrypted();
    } catch (err) {
        onEvent({ type: 'error', message: `Failed to analyse PDF: ${err.message}` });
        return;
    }

    onEvent({ type: 'init', encrypted, bufferSize: pdfBuffer.length, filename });

    if (!encrypted) {
        onEvent({ type: 'not_encrypted' });
        return;
    }

    // ── STAGE 2: Load wordlist ────────────────────────────────────────────
    let wordList = [];
    const passwordsPath = join(__dirname, 'rockyou.txt');
    try {
        const txt = readFileSync(passwordsPath, 'utf8');
        wordList = txt.split('\n').map(l => l.trimEnd()).filter(Boolean);
    } catch (_) {
        wordList = [];
    }

    onEvent({ type: 'wordlist_loaded', count: wordList.length });

    const startTime = Date.now();

    // ── PHASE 1: Full dictionary sweep ────────────────────────────────────
    for (let i = 0; i < wordList.length; i++) {
        const password = wordList[i];
        const attempts = i + 1;
        const elapsed = (Date.now() - startTime) / 1000;

        // Emit progress every 50 rows (or on last row)
        if (attempts % 50 === 0 || i === wordList.length - 1) {
            const rate = elapsed > 0 ? Math.round(attempts / elapsed) : 0;
            onEvent({
                type: 'progress',
                attempts,
                rate,
                currentPassword: password,
                elapsedTime: elapsed,
                phase: 'dictionary',
                rowNumber: attempts,
            });
        }

        // Test the password
        try {
            const result = await checker.validatePassword(password);
            if (result.success) {
                const totalTime = (Date.now() - startTime) / 1000;
                onEvent({
                    type: 'found',
                    password,
                    attempts,
                    time: totalTime,
                    rowNumber: attempts,           // 1-indexed
                    foundInPhase: 'dictionary',
                    decryptedBuffer: result.data,
                });
                return;
            }
        } catch (err) {
            onEvent({ type: 'error', message: `Decryption error: ${err.message}` });
            return;
        }

        // Yield the event loop every 500 attempts so SSE flush reaches client
        if (attempts % 500 === 0) await sleep(1);

        // Respect max time even during dictionary phase
        if (elapsed > maxTimeSeconds) {
            onEvent({ type: 'failed', attempts, time: elapsed, reason: 'Time limit reached during dictionary phase' });
            return;
        }
    }

    // ── PHASE 1 COMPLETE — wordlist exhausted with no match ───────────────
    const dictTime = (Date.now() - startTime) / 1000;
    onEvent({
        type: 'phase_change',
        from: 'dictionary',
        to: 'markov',
        wordlistExhausted: true,
        wordlistCount: wordList.length,
        elapsedTime: dictTime,
    });

    // ── PHASE 2: Markov-weighted generation ───────────────────────────────
    const attemptedSet = new Set(wordList); // don't re-test wordlist entries
    let markovAttempts = 0;
    const phaseStart = Date.now();

    while (markovAttempts < maxMarkovAttempts) {
        const totalElapsed = (Date.now() - startTime) / 1000;
        if (totalElapsed > maxTimeSeconds) {
            onEvent({
                type: 'failed',
                attempts: wordList.length + markovAttempts,
                time: totalElapsed,
                reason: 'Time limit reached during Markov phase',
            });
            return;
        }

        const password = generateMarkovPassword();
        if (attemptedSet.has(password)) continue;
        attemptedSet.add(password);
        markovAttempts++;

        // Progress every 50 Markov attempts
        if (markovAttempts % 50 === 0) {
            const phaseElapsed = (Date.now() - phaseStart) / 1000;
            const rate = phaseElapsed > 0 ? Math.round(markovAttempts / phaseElapsed) : 0;
            onEvent({
                type: 'progress',
                attempts: wordList.length + markovAttempts,
                rate,
                currentPassword: password,
                elapsedTime: (Date.now() - startTime) / 1000,
                phase: 'markov',
            });
        }

        try {
            const result = await checker.validatePassword(password);
            if (result.success) {
                const totalTime = (Date.now() - startTime) / 1000;
                onEvent({
                    type: 'found',
                    password,
                    attempts: wordList.length + markovAttempts,
                    time: totalTime,
                    foundInPhase: 'markov',
                    decryptedBuffer: result.data,
                });
                return;
            }
        } catch (err) {
            onEvent({ type: 'error', message: `Decryption error during Markov: ${err.message}` });
            return;
        }

        if (markovAttempts % 500 === 0) await sleep(1);
    }

    const totalTime = (Date.now() - startTime) / 1000;
    onEvent({
        type: 'failed',
        attempts: wordList.length + markovAttempts,
        time: totalTime,
        reason: 'Attempt limit reached (Markov phase)',
    });
}
