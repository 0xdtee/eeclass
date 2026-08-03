#!/usr/bin/env bash
# Expose the caption service to the public internet: start the backend and open a
# temporary cloudflared tunnel, then print the public URL.
#   Usage:  DEEPSEEK_API_KEY=your-key bash serve-public.sh
#   Stop:   Ctrl-C  (tears down both the backend and the tunnel)
#
# Note: a trycloudflare temporary tunnel gets a new URL on every start and is gone
# once the process exits. For a fixed domain, use a named tunnel (needs a Cloudflare
# account and a domain).
set -eo pipefail
cd "$(dirname "$0")"

SERVICE_DIR="backend"
PORT=5901
SRV_PID=""
CF_PID=""

cleanup() {
  echo
  echo "Stopping..."
  [ -n "${CF_PID}" ] && kill "${CF_PID}" 2>/dev/null || true
  [ -n "${SRV_PID}" ] && kill "${SRV_PID}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "== 1. Start the backend recognition service on port ${PORT} =="
( cd "${SERVICE_DIR}/service" && exec ../.venv/bin/python server.py ) > /tmp/lc_server.log 2>&1 &
SRV_PID=$!
for _ in $(seq 1 20); do
  lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1 && break
  sleep 0.5
done
echo "   backend PID=${SRV_PID}, logs at /tmp/lc_server.log"

echo "== 2. Open the public tunnel =="
./cloudflared tunnel --url "https://localhost:${PORT}" --no-tls-verify > /tmp/cf.log 2>&1 &
CF_PID=$!
URL=""
for _ in $(seq 1 30); do
  URL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" /tmp/cf.log | head -1 || true)
  [ -n "${URL}" ] && break
  sleep 1
done

echo
echo "======================================================"
if [ -n "${URL}" ]; then
  echo "Public URL (share this):"
  echo "    ${URL}/app/course"
  echo
  echo "Anyone who opens it can register -> log in -> see live captions."
else
  echo "Tunnel URL not ready yet; check /tmp/cf.log to troubleshoot."
fi
echo "Local access:  https://localhost:${PORT}/app/course"
echo "Records dir:   ${SERVICE_DIR}/records"
echo "Close this window (Ctrl-C) to stop both the service and the tunnel."
echo "======================================================"

wait "${SRV_PID}"
