# eeclass — Classroom Real-time Captions & Notes

**English** | [中文](README.zh.md)

Turn a live lecture into a clean, structured, searchable record — in real time, on your
own machine. Speech recognition, speaker separation, voiceprints and highlight detection
all run **locally on CPU**; your audio never leaves the device. Only optional text calls
(for correction/summary) go to an external LLM.

Built for Chinese university classrooms, but the recognizer is multilingual
(zh / en / ja / ko / yue).

---

## Features

- **Real-time transcription** — streaming captions with punctuation, CPU-only
  (sherpa-onnx SenseVoice, ~0.05 RTF).
- **Speaker separation + voiceprint library** — tells speakers apart on the fly; name a
  person once and future recordings recognize the same voice automatically. Same person is
  stored once (deduplicated), and renaming propagates back across past classes.
- **Highlight detection** — auto-marks key points, definitions and formulas the teacher
  stresses.
- **AI assist (via DeepSeek, optional)** — homophone correction, smart sentence
  segmentation, English→Chinese subtitles, per-class summary, exam-point prediction,
  flashcards / quiz, and “ask the lecture” Q&A.
- **Board capture** — snap the blackboard/slide; shots are aligned to the timeline.
- **Accounts & privacy** — real login (pbkdf2), strict per-account data isolation,
  admin-only voiceprint management, read-only share links.
- **Export** — PDF export; live write-into-Word via an Office add-in (Windows only).
- **Timetable & syllabus**, full-text search across classes, editable transcripts.
- **Optional Aliyun OSS** offload/backup for audio and files.

## How it works

```
Browser / Word add-in ──WSS──►  Python backend (aiohttp, HTTPS on :5901)
                                 ├─ sherpa-onnx SenseVoice   (ASR, CPU)
                                 ├─ silero VAD               (segmentation)
                                 ├─ 3D-Speaker eres2netv2    (voiceprints)
                                 └─ DeepSeek API (text only, optional)
```

- **Frontend** — React 19 + Vite + TypeScript + Tailwind (`frontend/`), served by the
  backend at `/app`.
- **Backend** — Python + aiohttp (`backend/service/`); files stored under
  `records/`.
- **Word add-in** — Office.js task pane (`backend/addin/`), Windows only.

## Requirements

- Python 3.11+, Node.js 18+, ffmpeg
- ~2 GB disk for speech models (downloaded on first setup)
- A DeepSeek API key for the AI features (optional; transcription works without it)

## Quick start

### macOS

```bash
bash setup-mac.sh          # installs node/python/ffmpeg + deps, downloads ~2GB models
```

### Windows

```powershell
backend\scripts\install.ps1     # deps + models
backend\scripts\start.ps1       # start the backend
```

### Configure

```bash
cp backend/service/config.example.json backend/service/config.json
```

Provide your DeepSeek key via environment variable (preferred — keeps it out of files):

```bash
export DEEPSEEK_API_KEY=sk-your-key
```

Speech recognition runs without a key; only the AI-assist features need it.

## Run (development)

Two terminals:

```bash
# A — backend (recognition service, HTTPS on :5901)
cd backend
DEEPSEEK_API_KEY=sk-your-key ./.venv/bin/python service/server.py

# B — frontend (hot reload on :3000)
cd frontend
npm run dev
```

Open **http://localhost:3000/course**. The frontend auto-detects dev mode and talks to the
backend on `localhost:5901`.

## Build & serve (single origin / LAN / phones)

```bash
cd frontend
BASE_PATH=/app/ npm run build     # outputs to out/
```

The backend then serves the built app at **https://localhost:5901/app/course**. On the same
Wi-Fi, phones/tablets can open `https://<your-LAN-ip>:5901/app/course` (self-signed cert —
accept the warning). Access is gated by a token when `server.require_token` is on.

## Privacy & security

- **Audio, ASR, speaker voiceprints — all local, on CPU.** Speech never leaves the machine.
- Only optional **text** (transcript snippets for correction/summary) is sent to DeepSeek.
- Passwords stored as pbkdf2 hashes; sessions are token-based; brute-force lockout on the
  token gate.
- **Strict per-account data isolation** — each account only sees its own classes, courses,
  schedule and voiceprint library.
- Secrets (`config.json`, `token.txt`, `certs/`), all user data (`records/`) and the
  models are **git-ignored** and never committed. Put keys in environment variables, not in
  files.

## Project layout

```
frontend/                 Frontend (React + Vite + TS + Tailwind)
backend/
  service/                   Backend (Python, aiohttp, sherpa-onnx, DeepSeek)
    config.example.json      Copy to config.json and edit
    models/                  Speech models (downloaded, git-ignored)
  addin/                     Word Office.js task pane (Windows)
  records/                   User data (git-ignored)
  scripts/                   install.ps1 / start.ps1 (Windows)
setup-mac.sh                 One-shot dev setup for macOS
```

## Models & licensing

Speech models are downloaded from the [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)
releases (SenseVoice ASR, CT-Transformer punctuation) and
[3D-Speaker](https://github.com/modelscope/3D-Speaker) (eres2netv2 voiceprint), plus silero
VAD. They are not redistributed here — the setup script fetches them, and each carries its
own upstream license.

## License

[MIT](LICENSE) © 2026 dtee@shu.edu.cn
