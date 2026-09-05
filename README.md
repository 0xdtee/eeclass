# eeclass — Classroom Real-time Captions & Notes

**English** | [中文](README.zh.md)

> **Turn a live lecture into a clean, structured, searchable, review-ready notebook — in real time.**

eeclass is a classroom transcription & AI-notes system. The teacher lectures; it renders live captions, tells speakers apart, and marks key points. Afterwards it uses an LLM to generate summaries, likely exam points, and mock papers to help you revise. Speech recognition, speaker separation and voiceprints run on CPU (sherpa-onnx / 3D-Speaker); correction, summary and other AI features optionally use DeepSeek.

Built for Chinese university classrooms, but the recognizer is multilingual (zh / en / ja / ko / yue and more).

## Screenshots

<p align="center">
  <img src="docs/screenshots/dashboard.png" width="900" alt="Dashboard — semester overview, class calendar and quick actions">
</p>

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/live.png" alt="Live transcription"><br><sub><b>Live transcription</b> — speaker labels, an inline translation under each line, notes side by side.</sub></td>
    <td width="50%"><img src="docs/screenshots/summary.png" alt="AI summary"><br><sub><b>AI summary</b> — summary, key points, textbook cross-reference, one-tap homophone fixes.</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/schedule.png" alt="Weekly schedule"><br><sub><b>Weekly schedule</b> — import a timetable from a screenshot/PDF; weeks auto-read, per-course colors.</sub></td>
    <td width="50%"><img src="docs/screenshots/settings.png" alt="Settings"><br><sub><b>Settings</b> — toggle real-time correction, smart segmentation and translation.</sub></td>
  </tr>
</table>

<p align="center">
  <img src="docs/screenshots/syllabus.png" width="900" alt="Official syllabus library"><br>
  <sub><b>Official syllabus library</b> — browse ministry &amp; university course outlines (PDF) right inside the app.</sub>
</p>

---

## Who it's for

- **University students** — who can't take notes fast enough and keep missing content; who want a complete, searchable, revisable record of every class.
- **Teachers** — who want a verbatim record of their own lectures, plus automatic per-class and whole-course summaries.
- **Deaf / hard-of-hearing & non-native students** — who need live captions, or a native-language subtitle auto-added under foreign-language speech.

## Problems it solves

- **Can't keep up taking notes, miss the key parts** — everything is transcribed automatically, with the points/definitions/formulas the teacher stresses highlighted live; after class an AI "one-tap highlight" pass fills in the definitions/key points the real-time rules missed.
- **Nothing to revise from after class** — one tap generates a per-class summary, a whole-course "grand summary", exam-point prediction, an (exportable) mock exam, and self-test flashcards; for academic courses the summary is even **grounded in the standard textbook**, tagging the corresponding chapters.
- **ASR mishears homophones and leaves choppy fragments** — real-time homophone correction + smart segmentation turn broken speech into readable sentences (both are built to **never drop a word**).
- **Content scattered across many classes, hard to find** — full-text search across every course ("which class did the teacher mention X?").

## Typical scenarios

1. **In class**: bring an iPad / laptop, hit start → live captions, teacher-vs-student separation, mark highlights, snap the board (aligned to the timeline).
2. **After class**: read the class summary; open the course view for a whole-course **grand summary / exam-point prediction / mock paper (exportable to Word·PDF)**; self-test with flashcards; **ask questions** about the whole lecture.
3. **Revise / find material**: full-text search down to a single sentence; export PDF; replay a foreign-language class with the translated subtitles already attached.
4. **Cross-device**: record on the **native iPad app** in class, revise on the **web app** on your phone/computer — same backend, same data.

## Highlights

- ⚡ **CPU-only, real-time** — ASR, speaker separation and voiceprints all run on CPU (sherpa-onnx SenseVoice, RTF ≈ 0.05); no GPU needed, an ordinary machine handles it.
- 🗣️ **Overlapping-speech separation (experimental, opt-in)** — when two people talk at once, an optional GPU separation service splits the mixture into per-speaker streams, each recognized (with your chosen model) and attributed separately; falls back to normal recognition when the service is unavailable.
- 🧬 **A voiceprint library that recognizes people** — name someone once and future recordings of the same voice are recognized automatically; each person is stored once, and renaming propagates **back across all past classes**.
- 🖍️ **Highlights: real-time + after-class** — rule-based key/definition highlighting while lecturing; after class, one tap has the AI read the whole transcript and fill in the fragmented, keyword-less **real definitions** and **key points**, merged with your manual marks and re-runnable.
- 📖 **Textbook-grounded summaries** — for academic courses the summary is organized around that course's **standard textbook chapters**, notes the corresponding textbook/chapters at the end, and tags textbook-core points with a 「【教材】」 (textbook) marker.
- 🧠 **Course-level AI** — beyond per-class summaries, it **aggregates a whole course's classes into a grand summary**, predicts exam points (with a share pie chart), generates a mock paper, and **exports it to Word / PDF** (questions first, answer key after, formulas included).
- 🗓️ **Timetable straight into the calendar** — upload a timetable **screenshot or PDF**; it reads course names, times and rooms, plus each course's **teaching weeks** (contiguous `1-16`, discrete `1,5,9,13`, odd/even weeks); set one first-week Monday + total weeks and it generates the whole semester of weekly classes; got it wrong? **undo/redo**.
- 🌏 **Multilingual recognition + live translation** — recognize Chinese (incl. 16 dialects), English, French, German, Italian, Spanish, Russian, Japanese, Korean; add one translation subtitle line in any direction among 9 languages via an **"original ⇄ target" dropdown**.
- 🤝 **Meeting translator (multilingual)** — a standalone meeting page: auto-detects the spoken language and translates in real time, showing up to 3 subtitle languages at once; one-tap fullscreen projection; auto-generated **minutes** when you stop; import PPT/docs to **project** during the meeting; per-account **history**.
- 📱 **Web + native iPad app** — the phone/iPad client (web `/m` + a Capacitor-packaged iPad app) lives in the separate repo [eeclass-mobile](https://github.com/0xdtee/eeclass-mobile).
- 🏠 **Open source (MIT), self-hosted** — runs on one ordinary machine over your LAN.
- 📚 **Built-in animated manual** — every feature comes with a CSS-animated demo + step-by-step, zero learning curve.

## Features

### In class (real-time)
- **Live transcription** — punctuated streaming captions, CPU-only (sherpa-onnx SenseVoice, RTF ≈ 0.05). Optional cloud recognition (Alibaba Cloud) adds high-accuracy Mandarin/English, 16 Chinese dialects (auto-converted to Mandarin), and a continuous streaming multilingual model (fr/de/it/es/ru/ja/ko + zh/en).
- **Speaker separation + voiceprint library** — tells speakers apart live; name someone once and they're recognized automatically, stored deduplicated, with renames propagating to past classes.
- **Overlapping-speech separation (experimental, opt-in)** — split simultaneous speech into per-speaker streams via an optional GPU service.
- **Real-time highlighting** — auto-marks the points the teacher stresses (yellow) and definitions (green); colors carry into exports.
- **Real-time translation subtitles** — a translation line under each sentence in any direction among 9 languages (zh/en/fr/de/it/es/ru/ja/ko), chosen via an "original ⇄ target" dropdown; font size adjustable; defaults to the UI language.
- **Snap the board** — one tap captures the board/slides, inserted into the transcript aligned to the timeline.
- **Mic gain & caption font size** — adjustable on the fly for different rooms and eyesight.

### After class (AI, DeepSeek, optional)
- **Per-class summary** — reads the whole transcript and covers every part of the class; outputs a summary, key points, formulas, exam hints the teacher named, classroom Q&A, and likely mishearings; written in the UI language.
- **One-tap highlight** — have the AI read the whole transcript after class and fill in the definitions/key points (green/yellow) the real-time rules missed, merged with manual marks and re-runnable.
- **Textbook-grounded summary** — academic courses are cross-referenced against the standard textbook: the corresponding textbook/chapters are noted at the end and textbook-core points are tagged 「【教材】」.
- **One-tap correction replace** — replace a misheard word (heard-as-X, should-be-Y) across the whole text and remember it for later auto-correction.
- **Course level** — a whole-course **grand summary**, **exam-point prediction** (share pie chart), and a **mock paper** that **exports to Word / PDF**.
- **Review** — flashcards (scheduled by the Ebbinghaus forgetting curve), self-test quizzes, and **follow-up Q&A** with DeepSeek about the whole lecture.
- **Math rendering** — LaTeX in summaries/points/course views is rendered with KaTeX; converted to readable text when exporting to Word/PDF.

### Timetable & calendar
- **Timetable import** — upload a screenshot or PDF; local OCR (or optional cloud) + AI turns it into courses, reading names, times (mapped via the Shanghai University period bell schedule), rooms, teachers, and each course's **teaching weeks** (contiguous/discrete/odd-even).
- **Generate a whole semester** — enter the first-week Monday + total weeks and it lays out weekly classes per course's weeks; each course's weeks can be edited individually.
- **Undo / redo** — picked the wrong start date/week count on import? Undo in one tap, redo if needed.
- **Calendar** — year / month / week / day drill-down, per-course colors; recordings and meetings both show on the calendar.

### Meeting translator (`/meeting`)
- **Multilingual translation** — auto-detects the spoken language and translates live, showing up to 3 subtitle languages at once, via the cloud Gummy model. Great for in-person meetings.
- **Projection** — original/translation equal-sized, full-width, one-tap fullscreen to a big screen.
- **Minutes** — tapping "stop" auto-generates an overview / discussion points / decisions / action items (with owners); copy or regenerate.
- **File projection** — import PPT / PDF / docs and project them during the meeting (fit-to-screen resize, page flip).
- **History** — each meeting (bilingual record + minutes) is saved per account and replayable across devices.

### Accounts, reference & export
- **Accounts** — email verification-code sign-up, pbkdf2-hashed passwords, strict per-account data isolation; the voiceprint library is admin-only; accounts can be deleted.
- **Syllabus library** — browse standard / official course outlines in-app (usable as the textbook basis for summaries).
- **Export & share** — vector PDF export, real .docx (Windows writes into Word live via an Office add-in); read-only share links.
- **More** — cross-course full-text search, line-by-line editable transcript, light/dark theme, optional Alibaba Cloud OSS for audio/file offload & backup.

## How it works

```
Web / iPad app / Word add-in ──WSS──►  Python backend (aiohttp, HTTPS :5901)
                                        ├─ sherpa-onnx SenseVoice   (ASR, CPU)
                                        ├─ Alibaba DashScope        (ASR, optional: dialect / multilingual stream / Gummy meeting translate)
                                        ├─ Alibaba OCR / Qwen-VL    (timetable screenshot·PDF recognition, optional)
                                        ├─ silero VAD               (segmentation)
                                        ├─ 3D-Speaker eres2netv2    (voiceprints)
                                        ├─ optional GPU service     (overlapping-speech separation)
                                        ├─ PostgreSQL               (accounts / sessions / course metadata)
                                        ├─ records/                 (audio / transcripts / board shots, file storage)
                                        └─ DeepSeek API             (summary / correction / translation / minutes, optional)
```

- **Frontend** — React 19 + Vite + TypeScript + Tailwind (`frontend/`, desktop web). The phone/iPad client lives in the separate repo [eeclass-mobile](https://github.com/0xdtee/eeclass-mobile), built both as web `/m` and as a Capacitor-packaged native iPad app.
- **Backend** — Python + aiohttp (`backend/service/`). Accounts, login sessions and course metadata live in PostgreSQL; audio, per-line transcripts and board images live as files under `records/`, referenced by the DB.
- **Word add-in** — an Office.js task pane (`backend/addin/`, Windows only).

## Requirements

- Python 3.11+, Node.js 18+, ffmpeg, PostgreSQL 14+, poppler (`pdftoppm`, for PDF timetables)
- ~2 GB disk for the speech models (downloaded on first install)
- AI features need a DeepSeek API key (optional; transcription works without it). Cloud timetable OCR, dialect/multilingual and meeting translation need an Alibaba Cloud key (optional)

## Quick start

> 📖 Full install · config · usage guide: [docs/安装配置使用.md](docs/安装配置使用.md).

### macOS

```bash
bash setup-mac.sh          # installs node/python/ffmpeg + deps, downloads ~2GB of models
```

### Windows

```powershell
backend\scripts\install.ps1     # deps + models
backend\scripts\start.ps1       # start the backend
```

### Configuration

```bash
cp backend/service/config.example.json backend/service/config.json
```

Provide secrets via environment variables (recommended, keeps them out of files):

```bash
export DEEPSEEK_API_KEY=sk-your-key
export EECLASS_DB_DSN=postgresql:///eeclass   # local peer auth, no password
# optional: cloud timetable OCR / dialect & multilingual / meeting translation
export DASHSCOPE_API_KEY=sk-...
export ALIBABA_CLOUD_ACCESS_KEY_ID=...  ALIBABA_CLOUD_ACCESS_KEY_SECRET=...
```

Speech recognition needs no key; only AI assistance and cloud recognition do.

## Development

Two terminals:

```bash
# A — backend (recognition service, HTTPS :5901)
cd backend
DEEPSEEK_API_KEY=sk-your-key ./.venv/bin/python service/server.py

# B — frontend (hot reload :3000)
cd frontend
npm run dev
```

Open **http://localhost:3000/course**. The frontend detects dev mode and connects to the local :5901 backend.

## Build & deploy (single origin / LAN / mobile)

```bash
cd frontend && BASE_PATH=/app/ npm run build     # desktop → out/
```

The mobile build `/m` comes from the separate repo [eeclass-mobile](https://github.com/0xdtee/eeclass-mobile) (`BASE_PATH=/ npm run build`); drop its `out/` where the backend serves `/m`.

The backend then serves the web app at **https://localhost:5901/app/course** and mobile at `/m`. On the same Wi-Fi, phones/tablets can open `https://<LAN-IP>:5901/app/course` (self-signed cert, accept the warning). With `server.require_token` on, access needs a token.

## Security

- AI features (correction/summary/etc.) send the transcript **text** to DeepSeek; cloud timetable OCR and meeting translation send the relevant **image/audio** to Alibaba Cloud. Without those features there are no external calls; local recognition never leaves the machine.
- Passwords are stored as pbkdf2 hashes; sessions are token-based; the token gate has brute-force lockout.
- **Strict per-account isolation** — each account only sees its own courses, timetable and voiceprint library.
- Secrets (`config.json`, `token.txt`, `certs/`, env vars in `start-server.sh`), all user data (`records/`) and the models are **git-ignored** and never committed. Put the DB DSN and API keys in environment variables, not in files.

## Project layout

```
frontend/                  desktop web frontend (React + Vite + TS + Tailwind)
                           (phone/iPad client → separate repo 0xdtee/eeclass-mobile)
backend/
  service/                   backend (Python, aiohttp, sherpa-onnx, PostgreSQL, DeepSeek)
    config.example.json      copy to config.json and edit
    db.py / migrate_to_db.py PostgreSQL connection & JSON→DB migration script
    models/                  speech models (downloaded, git-ignored)
  addin/                     Word Office.js task pane (Windows)
  records/                   audio / transcripts / board shots etc. (git-ignored)
  scripts/                   install.ps1 / start.ps1 (Windows)
setup-mac.sh                 one-shot macOS dev environment
```

## Models & licenses

Speech models come from [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (SenseVoice recognition, CT-Transformer punctuation) and [3D-Speaker](https://github.com/modelscope/3D-Speaker) (eres2netv2 voiceprints), plus silero VAD. This repo does not redistribute them — the install script downloads them, each under its own upstream license.

## License

[MIT](LICENSE) © 2026 dtee
