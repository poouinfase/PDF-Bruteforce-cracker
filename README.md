# Obsidian Sentinel — PDF Password Brute-Force Cracker

A full-stack penetration testing demonstration tool that brute-forces password-protected PDF files using a two-phase attack strategy: a sequential dictionary sweep followed by a Markov-chain weighted password generator. Built as a class project for an introductory penetration testing course.

**Live Demo:** [https://pdf-bruteforce-cracker.onrender.com](https://pdf-bruteforce-cracker.onrender.com)
---

## Overview

The application exposes a browser-based interface styled as a security operations dashboard. When a protected PDF is uploaded, the server streams real-time attack telemetry back to the client via Server-Sent Events (SSE), making every stage of the cracking process visible: encryption probe, weight matrix load, dictionary sweep (with row-level progress), and neural-weighted generation.

### Attack Strategy

**Phase 1 — Dictionary Sweep**

Every entry in the configured wordlist is tested sequentially from the first row to the last. If a match is found, the attack stops immediately and reports the recovered password along with its exact row number in the wordlist. The dictionary phase is exhausted in full before Phase 2 begins.

**Phase 2 — Neural-Weighted Markov Generation**

Only reached if the entire wordlist is exhausted without a match. A pre-trained Markov transition matrix (`Weight.txt`) is used to generate statistically plausible password candidates. Each character is sampled from the conditional probability distribution P(c_n+1 | c_n) derived from a corpus of real-world passwords. Generation continues up to a configurable attempt limit or time boundary.

---

## Project Structure

```
PDF-Bruteforce-cracker/
├── frontend/
│   └── index.html          # Single-page application (Tailwind CSS, vanilla JS)
├── server/
│   ├── server.js           # Express HTTP server, SSE streaming, file upload
│   ├── cracker.js          # Two-phase attack engine (dictionary then Markov)
│   ├── weightLoader.js     # Markov weight matrix loader and password generator
│   ├── pdfcheck.js         # PDF encryption detection and password validation
│   └── package.json        # Server-side dependencies
├── Weight.txt              # Pre-trained Markov character transition weights
├── weigthmake.py           # Script used to generate Weight.txt from a corpus
├── pdfbruteforce.js        # Original standalone brute-force script (reference)
├── pdfcheck.js             # Original PDF checker (reference)
├── wordGen.js              # Original Markov generator (reference)
└── .gitignore
```

---

## Prerequisites

- **Node.js** v18 or higher
- **npm** v9 or higher
- A wordlist file (see section below)

---

## Wordlist Setup

The dictionary attack phase requires a plaintext wordlist file. The file must be placed at:

```
server/passwords.txt
```

The recommended wordlist is **RockYou**, a well-known corpus of real leaked passwords commonly used in penetration testing education.

**Download options:**

```
https://weakpass.com/wordlists/rockyou.txt
```

Or via the Kali Linux package if you are running Kali:

```bash
sudo gzip -d /usr/share/wordlists/rockyou.txt.gz
cp /usr/share/wordlists/rockyou.txt ./server/passwords.txt
```

The full RockYou file contains approximately 14 million entries (133 MB uncompressed). For faster testing or limited environments, a truncated version works fine:

```bash
head -n 100000 rockyou.txt > server/passwords.txt
```

> The `.gitignore` is pre-configured to exclude large wordlist files from version control. Do not commit `rockyou.txt` or any substantial wordlist to the repository.

---

## Installation

**1. Clone the repository**

```bash
git clone https://github.com/poouinfase/PDF-Bruteforce-cracker.git
cd PDF-Bruteforce-cracker
```

**2. Install server dependencies**

```bash
cd server
npm install
```

**3. Place the wordlist**

Copy or symlink a `passwords.txt` into the `server/` directory as described above.

**4. Verify `Weight.txt` is present**

The file `Weight.txt` (in the project root) must exist. It contains the serialised Markov weight matrix. It is included in the repository. If it is missing or corrupted, re-generate it by running:

```bash
python weigthmake.py
```

This script requires a source corpus. By default it reads from a local password file — edit the path at the top of `weigthmake.py` before running.

---

## Running

**Start the backend server**

```bash
cd server
node server.js
```

The server starts on `http://localhost:3001`. You should see:

```
╔════════════════════════════════════════╗
║  PDFCRACK.EXE Server                   ║
║  Running on http://localhost:3001      ║
╚════════════════════════════════════════╝
```

**Open the frontend**

Navigate to `http://localhost:3001` in your browser. The server serves `frontend/index.html` statically.

---

## Usage

1. Open the [Live Demo](https://pdf-bruteforce-cracker.onrender.com) (or `http://localhost:3001` if running locally) in a modern browser.
2. Drag and drop a password-protected PDF onto the upload zone, or click "browse files".
3. Click **Initiate Attack**.
4. Watch the attack pipeline progress in real time:
   - Stage 1 confirms the PDF is encrypted.
   - Stage 2 loads the Markov weight matrix.
   - Stage 3 runs the full dictionary sweep row by row.
   - Stage 4 activates only if the dictionary is exhausted — Markov generation begins.
5. On success, the recovered password, its wordlist row number, phase source, and timing statistics are displayed in the analysis card.
6. If the server was able to decrypt the document, a **Download Decrypted PDF** button appears. Otherwise, the recovered password is shown for manual use.

---

## Configuration

Attack limits are defined in `server/server.js` when calling `bruteForcePDF`:

| Option | Default | Description |
|---|---|---|
| `maxMarkovAttempts` | `500000` | Maximum candidates generated in Phase 2 |
| `maxTimeSeconds` | `180` | Hard time limit in seconds across both phases |

The wordlist path is defined in `server/cracker.js`:

```js
const passwordsPath = join(__dirname, '..', 'passwords.txt');
```

Change this path if your wordlist has a different name or location.

---

## API Reference

All endpoints are served by the Express server on port 3001.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Returns `{ status: 'ok' }` if the server is running |
| `POST` | `/api/crack` | Accepts `multipart/form-data` with field `pdf`. Returns an SSE stream. |
| `GET` | `/api/download/:sessionId` | Downloads the decrypted PDF for a given session (60-second TTL) |

### SSE Event Types

Events are emitted on the `/api/crack` stream in the format `event: <type>\ndata: <json>\n\n`.

| Event | Key Fields | Description |
|---|---|---|
| `session` | `sessionId` | Issued at the start of each cracking session |
| `init` | `encrypted`, `bufferSize` | Result of the PDF encryption probe |
| `not_encrypted` | — | PDF requires no password |
| `wordlist_loaded` | `count` | Number of entries in the dictionary |
| `progress` | `attempts`, `rate`, `currentPassword`, `phase`, `rowNumber` | Emitted every 50 attempts |
| `phase_change` | `wordlistCount`, `elapsedTime` | Dictionary exhausted, Markov phase beginning |
| `found` | `password`, `rowNumber`, `foundInPhase`, `attempts`, `time`, `sessionId`, `canDownload` | Password recovered |
| `failed` | `attempts`, `time`, `reason` | Both phases exhausted without a match |
| `error` | `message` | Internal error |
| `done` | `sessionId` | Stream closing |

---

## Security Notes

- This tool is intended solely for educational and authorised penetration testing use.
- Decrypted PDF buffers are held in server memory for 60 seconds after a download request, then automatically purged.
- No data is persisted to disk beyond the uploaded file (which is held in memory via `multer`'s `memoryStorage`).
- Do not expose port 3001 to any public network. Run only on localhost or an isolated lab environment.
- The server does not implement authentication. Anyone who can reach port 3001 can initiate a cracking session.

---

## Dependencies

**Server (`server/package.json`)**

| Package | Purpose |
|---|---|
| `express` | HTTP server and routing |
| `multer` | Multipart file upload handling |
| `cors` | Cross-origin resource sharing headers |
| `pdf-lib` | PDF parsing and encryption detection |

**Frontend**

| Resource | Purpose |
|---|---|
| Tailwind CSS (CDN) | Utility-first styling |
| Google Fonts — Manrope, Inter | Typography |
| Google Material Symbols | Icon set |

---

## Development Notes

The project uses ES Modules (`"type": "module"` in `package.json`). All `import`/`export` statements use the ECMAScript module syntax. CommonJS `require()` is not used anywhere in the server code.

If you add a new module, ensure it uses `import` and is referenced with the correct file extension (`.js`). Node.js does not auto-resolve extensions in ESM mode.

**Adding a new attack phase**

1. Implement the logic in `server/cracker.js` after the Markov phase.
2. Emit a new `phase_change` event with appropriate fields.
3. Add a corresponding `case` in the `handleEvent` switch in `frontend/index.html`.
4. Add a Stage 5 panel to the HTML and wire it up via `stageSet(5, ...)`.

---

## License

This project is provided for educational purposes under the MIT License. The authors accept no liability for misuse. Only use this tool on files you own or have explicit written permission to test.
