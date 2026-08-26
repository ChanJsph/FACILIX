#!/bin/sh
# Expose local dev to WAN via the first available tunnel tool.
# Usage: npm run expose:wan  or  deno task expose:wan
# Requires one of: cloudflared, ngrok, tailscale

PORT="${PORT:-8000}"
VITE_PORT="${VITE_PORT:-5173}"

echo "FACILIX WAN expose helper"
echo "LAN Vite : http://$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}'):5173/"
echo "LAN Deno : http://$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}'):8000/"
echo ""

if command -v cloudflared >/dev/null 2>&1; then
  echo "→ Using cloudflared (no signup needed) for Deno :$PORT"
  echo "  Run: cloudflared tunnel --url http://localhost:$PORT"
  echo "  For Vite HMR also: cloudflared tunnel --url http://localhost:$VITE_PORT"
  echo ""
  # If --vite flag passed, expose vite instead
  if [ "$1" = "vite" ] || [ "$1" = "--vite" ]; then
    exec cloudflared tunnel --url "http://localhost:$VITE_PORT"
  else
    exec cloudflared tunnel --url "http://localhost:$PORT"
  fi
fi

if command -v ngrok >/dev/null 2>&1; then
  echo "→ Using ngrok for :$PORT"
  exec ngrok http "$PORT"
fi

if command -v tailscale >/dev/null 2>&1; then
  echo "→ Using tailscale funnel for :$PORT"
  echo "  tailscale funnel --bg http://localhost:$PORT"
  exec tailscale funnel "$PORT"
fi

echo "No tunnel tool found."
echo "Install one:"
echo "  brew install cloudflared   # recommended, free, no account"
echo "  brew install ngrok"
echo "  # or tailscale: https://tailscale.com/download"
echo ""
echo "Manual WAN options:"
echo "  cloudflared tunnel --url http://localhost:$PORT   # Deno"
echo "  cloudflared tunnel --url http://localhost:$VITE_PORT  # Vite"
echo "  ngrok http $PORT"
echo "  tailscale funnel $PORT"
echo ""
echo "Router port-forward (advanced): forward $PORT and $VITE_PORT to this machine's LAN IP, then use your public IP."
