#!/usr/bin/env bash
# One-shot dev environment setup on macOS.  Usage:  bash setup-mac.sh
# Idempotent: re-running won't reinstall things that are already in place.
set -euo pipefail
cd "$(dirname "$0")"

echo "== 1. Check Homebrew =="
if ! command -v brew >/dev/null 2>&1; then
  echo "   Homebrew not found. Install it first (then reopen the terminal and re-run this script):"
  echo '   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
  exit 1
fi
echo "   OK"

echo "== 2. System dependencies (node / python / ffmpeg) =="
for pkg in node python@3.11 ffmpeg; do
  brew list "$pkg" >/dev/null 2>&1 || brew install "$pkg"
done
echo "   node $(node -v) / python3 $(python3 --version 2>&1 | awk '{print $2}')"

echo "== 3. Frontend dependencies =="
cd frontend
npm install
cd ..
echo "   frontend OK (npm run dev serves on 3000)"

echo "== 4. Backend Python environment =="
cd backend
if [ ! -d .venv ]; then python3 -m venv .venv; fi
./.venv/bin/pip install -q --upgrade pip
# On macOS torch ships native arm64 wheels, so it installs directly; sherpa-onnx is the ASR core.
./.venv/bin/pip install -q \
  numpy scipy soundfile aiohttp cryptography \
  sherpa-onnx onnxruntime \
  torch faster-whisper \
  sounddevice
cd ..
echo "   backend dependencies OK"

echo "== 5. Speech models =="
MODELS=backend/service/models
SV="$MODELS/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/model.int8.onnx"
if [ -f "$SV" ]; then
  echo "   models already present ($(du -sh "$MODELS" | cut -f1))"
else
  echo "   downloading models (~2GB, one time)..."
  mkdir -p "$MODELS"; cd "$MODELS"
  base=https://github.com/k2-fsa/sherpa-onnx/releases/download
  dl() { echo "     $1"; curl -fL# "$2" -o t.tar.bz2 && tar xjf t.tar.bz2 && rm t.tar.bz2; }
  [ -d sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17 ] || dl "SenseVoice (ASR)" "$base/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2"
  [ -d sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20 ] || dl "streaming zipformer" "$base/asr-models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2"
  [ -d sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12 ] || dl "punctuation" "$base/punctuation-models/sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12.tar.bz2"
  [ -f 3dspeaker_speech_eres2netv2_sv_zh-cn_16k-common.onnx ] || { echo "     speaker voiceprint"; curl -fL# "$base/speaker-recongition-models/3dspeaker_speech_eres2netv2_sv_zh-cn_16k-common.onnx" -o 3dspeaker_speech_eres2netv2_sv_zh-cn_16k-common.onnx; }
  # silero VAD: copy it out of the faster-whisper package
  cd - >/dev/null
  VAD=$(./backend/.venv/bin/python -c "from faster_whisper.vad import get_assets_path;import os;print(os.path.join(get_assets_path(),'silero_vad_v6.onnx'))" 2>/dev/null || true)
  [ -n "$VAD" ] && cp "$VAD" "$MODELS/" 2>/dev/null || true
  echo "   models downloaded"
fi

echo
echo "======================================================"
echo "Done. Run these in two terminals:"
echo
echo "  Terminal A (backend recognition service):"
echo "    cd backend"
echo "    DEEPSEEK_API_KEY=your-key ./.venv/bin/python service/server.py"
echo
echo "  Terminal B (frontend with hot reload):"
echo "    cd frontend && npm run dev"
echo
echo "  Then open http://localhost:3000/course"
echo "  (in dev the frontend is on 3000 and the backend on 5901; cross-origin is handled in code)"
echo "======================================================"
