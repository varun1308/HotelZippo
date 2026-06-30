#!/usr/bin/env bash
#
# trim-wait.sh — cut the dead "Researching…" wait out of your screen recording.
#
# Prod recommendations take ~30s to return. You don't want that dead time in a 60s
# video. Record naturally (including the wait), then cut the boring stretch out:
# this removes [START, START+CUT] from the recording and seamlessly joins the two
# halves, so the result jumps from "Find hotels" straight to the rendered cards.
#
# The final video LENGTH is set by the voiceover in assemble.sh (56.5s), not by this
# file — this just removes dead air so your footage matches the voiceover's pacing.
#
# Usage:
#   ./demo/trim-wait.sh <input.mov> <START> <CUT> [output.mov]
#
#   START  where the wait begins (seconds), e.g. 32.5  or  0:32.5
#   CUT    how many seconds of wait to remove, e.g. 28
#   output defaults to: screen-recording.mov  (what assemble.sh consumes)
#
# Examples:
#   ./demo/trim-wait.sh raw.mov 32.5 28
#       → keeps 0–32.5s, drops 32.5–60.5s, keeps 60.5s–end, writes screen-recording.mov
#   ./demo/trim-wait.sh raw.mov 0:32.5 26 trimmed.mov
#
# TIP (keep a moment of the "Researching" pill): a brief researching pill looks good
# (it shows the AI working). Set START ~1.5s AFTER the pill appears, so a sliver of it
# survives the cut and the video jump-cuts straight to results. See SHOT_LIST.md §3.
#
set -euo pipefail

DEMO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ $# -lt 3 ]; then
  sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
fi

IN="$1"; START_RAW="$2"; CUT_RAW="$3"; OUT="${4:-screen-recording.mov}"

# Resolve IN/OUT relative to demo/ if not absolute and not found as given.
[ -f "$IN" ] || IN="$DEMO_DIR/$IN"
case "$OUT" in /*) ;; *) OUT="$DEMO_DIR/$OUT";; esac

command -v ffmpeg >/dev/null || { echo "✗ ffmpeg not found (brew install ffmpeg)"; exit 1; }
[ -f "$IN" ] || { echo "✗ input '$1' not found"; exit 1; }

# Accept either seconds (32.5) or M:SS(.ms) (0:32.5) for START.
to_secs() {
  case "$1" in
    *:*) awk -F: '{ s=0; for(i=1;i<=NF;i++) s = s*60 + $i; print s }' <<<"$1" ;;
    *)   printf '%s' "$1" ;;
  esac
}
START="$(to_secs "$START_RAW")"
CUT="$(to_secs "$CUT_RAW")"
END="$(awk -v s="$START" -v c="$CUT" 'BEGIN{ printf "%.3f", s + c }')"

DUR="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$IN")"
echo "→ input '$IN' = ${DUR}s"
echo "→ removing ${CUT}s of wait: cut out [${START}s … ${END}s], keep the rest"

# Guard: cut window must be inside the clip.
awk -v e="$END" -v d="$DUR" 'BEGIN{ if (e > d) { exit 1 } }' || {
  echo "✗ START+CUT (${END}s) is past the end of the clip (${DUR}s). Lower START or CUT."; exit 1; }

# Split into part A [0,START] and part B [END,end], then concat.
# Re-encode (short clip → fast) so the two parts share identical codec params and the
# join is glitch-free regardless of the QuickTime source's GOP/keyframe layout.
TMP_A="$(mktemp -t trimA).mp4"; TMP_B="$(mktemp -t trimB).mp4"
ENC=(-c:v libx264 -pix_fmt yuv420p -preset medium -crf 18 -c:a aac -b:a 192k -ar 48000 -vsync cfr -r 30)

echo "  • part A: 0 → ${START}s"
ffmpeg -y -loglevel error -i "$IN" -t "$START" "${ENC[@]}" "$TMP_A"
echo "  • part B: ${END}s → end"
ffmpeg -y -loglevel error -ss "$END" -i "$IN" "${ENC[@]}" "$TMP_B"

echo "  • joining…"
CONCAT="$(mktemp -t concat).txt"
printf "file '%s'\nfile '%s'\n" "$TMP_A" "$TMP_B" > "$CONCAT"
ffmpeg -y -loglevel error -f concat -safe 0 -i "$CONCAT" -c copy "$OUT" 2>/dev/null \
  || ffmpeg -y -loglevel error -f concat -safe 0 -i "$CONCAT" "${ENC[@]}" "$OUT"

rm -f "$TMP_A" "$TMP_B" "$CONCAT"

NEWDUR="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")"
echo
echo "✓ Wrote $OUT  (${NEWDUR}s — was ${DUR}s, removed ${CUT}s)"
echo "  Next:  ./demo/assemble.sh        # voiceover sets the final length (56.5s)"
echo "  If the jump-cut is abrupt, re-run with a START ~1s earlier/later to taste."
