#!/usr/bin/env bash
#
# assemble.sh — mux the screen recording + voiceover into the final demo MP4 (ffmpeg, free).
#
# Inputs (in demo/):
#   screen-recording.mov   your QuickTime capture (see SHOT_LIST.md)
#   voiceover.mp3          rendered by generate-voiceover.sh (default = Andrew, 56.5s)
#   captions.srt           optional, burned in with --captions
#
# Output:
#   hotelzippo-demo.mp4    1080p, H.264 + AAC, voiceover as the audio track
#
# Usage:
#   ./demo/assemble.sh                 # voiceover over video, no subtitles
#   ./demo/assemble.sh --captions      # also burn in captions.srt
#   VOICE_FILE=voiceover-prabhat.mp3 ./demo/assemble.sh   # use the Indian-English VO
#
# Behavior:
#   • Scales/pads the recording to 1920x1080 (handles any input aspect cleanly).
#   • Trims the final video to the voiceover length (so it always ends on the VO's
#     last word). If your recording is SHORTER than the VO, the last frame holds.
#   • Normalises voiceover loudness to broadcast-ish -16 LUFS.
#
set -euo pipefail

DEMO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DEMO_DIR"

VIDEO_IN="${VIDEO_IN:-screen-recording.mov}"
VOICE_FILE="${VOICE_FILE:-voiceover.mp3}"
OUT="${OUT:-hotelzippo-demo.mp4}"
BURN_CAPTIONS=0
[ "${1:-}" = "--captions" ] && BURN_CAPTIONS=1

# ---- preflight ----
command -v ffmpeg >/dev/null || { echo "✗ ffmpeg not found (brew install ffmpeg)"; exit 1; }
if [ ! -f "$VIDEO_IN" ]; then
  echo "✗ Missing '$VIDEO_IN'. Record per SHOT_LIST.md, rename to screen-recording.mov, put it in demo/."
  exit 1
fi
if [ ! -f "$VOICE_FILE" ]; then
  echo "✗ Missing '$VOICE_FILE'. Run ./demo/generate-voiceover.sh first."
  exit 1
fi

dur() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; }
VO_DUR="$(dur "$VOICE_FILE")"
VID_DUR="$(dur "$VIDEO_IN")"
echo "→ video '$VIDEO_IN' = ${VID_DUR}s · voiceover '$VOICE_FILE' = ${VO_DUR}s · output ${VO_DUR}s"

# Scale to fit inside 1920x1080 preserving aspect, pad letterbox to exactly 1080p.
VF="scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x1F1B17,setsar=1,fps=30"

# ---- Pass 1: scale + mux voiceover, trim to VO length ----
#  -t $VO_DUR  → output length = voiceover length (ends exactly on the last word)
#  tpad/clone  → if the video is shorter than the VO, hold the last frame
#  loudnorm    → normalise the voiceover loudness
echo "→ pass 1: scaling video + muxing voiceover…"
ffmpeg -y -loglevel warning -stats \
  -i "$VIDEO_IN" \
  -i "$VOICE_FILE" \
  -filter_complex "[0:v]${VF},tpad=stop_mode=clone:stop_duration=60[v];[1:a]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=async=1[a]" \
  -map "[v]" -map "[a]" \
  -t "$VO_DUR" \
  -c:v libx264 -pix_fmt yuv420p -preset medium -crf 19 -movflags +faststart \
  -c:a aac -b:a 192k -ar 48000 \
  "$OUT"

# ---- Pass 2 (optional): captions ----
# Prefer a burned-in track (always visible). If this ffmpeg build lacks libass /
# the `subtitles` filter, fall back to muxing a SOFT subtitle track (toggleable in
# any player) so --captions never hard-fails. Either way it's free.
if [ "$BURN_CAPTIONS" = "1" ]; then
  if [ ! -f captions.srt ]; then echo "✗ --captions given but captions.srt missing"; exit 1; fi
  TMP="${OUT%.mp4}.cap.mp4"
  if ffmpeg -hide_banner -filters 2>/dev/null | grep -q " subtitles "; then
    echo "→ pass 2: burning in captions (libass)…"
    STYLE="FontName=Helvetica,FontSize=22,PrimaryColour=&H00F8FAFB&,OutlineColour=&H99171B1F&,BorderStyle=1,Outline=2,Shadow=0,MarginV=46"
    ffmpeg -y -loglevel warning -stats -i "$OUT" \
      -vf "subtitles=captions.srt:force_style='${STYLE}'" \
      -c:v libx264 -pix_fmt yuv420p -preset medium -crf 19 -movflags +faststart \
      -c:a copy "$TMP"
    mv "$TMP" "$OUT"
  else
    echo "→ pass 2: this ffmpeg has no libass — muxing a SOFT subtitle track instead"
    echo "  (toggle captions on in the player; or burn in with the HandBrake tip in README.md)"
    ffmpeg -y -loglevel warning -stats -i "$OUT" -i captions.srt \
      -map 0 -map 1 -c copy -c:s mov_text -metadata:s:s:0 language=eng "$TMP"
    mv "$TMP" "$OUT"
  fi
fi

echo
echo "✓ Wrote $DEMO_DIR/$OUT  ($(dur "$OUT")s, 1080p)"
echo "  Preview:  open '$DEMO_DIR/$OUT'"
