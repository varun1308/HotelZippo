#!/usr/bin/env bash
#
# generate-voiceover.sh — render the HotelZippo demo voiceover with FREE neural TTS.
#
# Primary engine: edge-tts (Microsoft neural voices, free, no signup, no API key).
# Fallback:       macOS `say` (built in) if edge-tts can't be installed/reached.
#
# Output: demo/voiceover-andrew.mp3 (default), demo/voiceover-prabhat.mp3 (on-brand alt).
# Then copies the chosen one to demo/voiceover.mp3 (what assemble.sh consumes).
#
# Usage:
#   ./demo/generate-voiceover.sh                 # render both, default = andrew
#   VOICE=prabhat ./demo/generate-voiceover.sh   # make prabhat the default voiceover.mp3
#   RATE="-5%" ./demo/generate-voiceover.sh       # slow down 5% if it runs long
#
set -euo pipefail

DEMO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DEMO_DIR"

# ---- The script text (kept identical to the "Full voiceover" block in SCRIPT.md) ----
read -r -d '' VO_TEXT <<'EOF' || true
Planning a family trip means thirty hours lost across review sites, maps, and forums — and you still aren't sure. HotelZippo replaces all of it with one conversation. You just talk. Tell it who's travelling and where — a vegetarian family heading to Phuket with two kids and grandparents — and it asks the right questions, building a complete picture of exactly what your family needs. Then it delivers one confident pick — backed by family reviews synthesised by AI, not a wall of links. And it never buries a dealbreaker. When a hotel has a real problem, the warning is right there, above everything else. Honesty over polish. Save it, and book it — straight through. From a single question to a booking you can trust, in under a minute. HotelZippo. The family travel concierge.
EOF

# Andrew at -14% lands at ~56.5s (verified) — paced, confident, under the 60s cap.
RATE="${RATE:--14%}"         # edge-tts speaking rate; override e.g. RATE="-6%"
DEFAULT_VOICE="${VOICE:-andrew}"

# Prefer a local venv (avoids PEP-668 "externally-managed-environment" errors on
# Homebrew/system Python). Created on demand below.
VENV="$DEMO_DIR/.venv"
PY="$VENV/bin/python"

render_edge() {
  # $1 = voice id, $2 = output file
  "$PY" -m edge_tts --voice "$1" --rate "$RATE" --text "$VO_TEXT" --write-media "$2"
}

duration() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1" 2>/dev/null || echo "?"; }

# ---- Ensure edge-tts in a venv; install on demand if missing ----
USE_EDGE=1
if [ ! -x "$PY" ] || ! "$PY" -c "import edge_tts" 2>/dev/null; then
  echo "→ Setting up edge-tts in a local venv (free, no signup)…"
  if ! python3 -m venv "$VENV" 2>/dev/null || ! "$VENV/bin/pip" install --quiet --upgrade pip edge-tts 2>/dev/null; then
    echo "⚠️  Could not set up edge-tts. Falling back to macOS 'say'."
    USE_EDGE=0
  fi
fi

if [ "$USE_EDGE" = "1" ] && "$PY" -c "import edge_tts" 2>/dev/null; then
  echo "→ Rendering with edge-tts (rate ${RATE})…"
  echo "  • Andrew (warm confident US male)…"
  render_edge "en-US-AndrewNeural"  "voiceover-andrew.mp3"  || USE_EDGE=0
  echo "  • Prabhat (Indian English male, on-brand alt)…"
  render_edge "en-IN-PrabhatNeural" "voiceover-prabhat.mp3" || true
fi

if [ "$USE_EDGE" != "1" ] || [ ! -f voiceover-andrew.mp3 ]; then
  echo "→ Falling back to macOS 'say' → voiceover-say.mp3"
  # `say` writes AIFF; convert to mp3 with ffmpeg. Rate ~165 wpm ≈ natural.
  say -v Daniel -r 165 -o voiceover-say.aiff "$VO_TEXT"
  ffmpeg -y -loglevel error -i voiceover-say.aiff -codec:a libmp3lame -b:a 192k voiceover-say.mp3
  rm -f voiceover-say.aiff
  cp voiceover-say.mp3 voiceover.mp3
  DEFAULT_VOICE="say"
fi

# ---- Promote the chosen voice to voiceover.mp3 ----
case "$DEFAULT_VOICE" in
  andrew)  [ -f voiceover-andrew.mp3 ]  && cp voiceover-andrew.mp3  voiceover.mp3 ;;
  prabhat) [ -f voiceover-prabhat.mp3 ] && cp voiceover-prabhat.mp3 voiceover.mp3 ;;
  say)     : ;; # already copied above
esac

echo
echo "✓ Voiceover rendered. Durations:"
for f in voiceover-andrew.mp3 voiceover-prabhat.mp3 voiceover.mp3; do
  [ -f "$f" ] && printf "   %-24s %ss\n" "$f" "$(duration "$f")"
done
echo
echo "Default → voiceover.mp3 (voice: ${DEFAULT_VOICE}). Re-run with VOICE=prabhat to switch."
echo "Target ≈ 58s. If it runs long, re-run with RATE=\"-6%\"; if short, RATE=\"+4%\"."
