# HotelZippo Demo Video — Production Kit

Everything needed to produce a **60-second product demo video** for the contest submission, using **only free tools** (QuickTime, edge-tts, ffmpeg).

## What's in here

| File | What it is |
|---|---|
| `SCRIPT.md` | The timed voiceover script (4 beats, ~56.5s) + on-screen action cues. The source of truth. |
| `SHOT_LIST.md` | Click-by-click recording guide for QuickTime (incl. prod Google-login + local fallback). |
| `generate-voiceover.sh` | Renders the voiceover with free neural TTS (edge-tts). Already run → see below. |
| `trim-wait.sh` | ffmpeg helper: cuts the ~30s "Researching…" wait out of your recording. |
| `assemble.sh` | ffmpeg script: muxes your recording + voiceover into the final MP4. |
| `captions.srt` | Subtitle file, synced to the script (for muted viewing). |
| `SUBMISSION.md` | The written HotelZippo write-up to submit alongside the video. |
| `voiceover-andrew.mp3` | ✅ Rendered. Warm confident US voice (`en-US-AndrewNeural`), **56.5s**. The default. |
| `voiceover-prabhat.mp3` | ✅ Rendered. Indian-English voice (`en-IN-PrabhatNeural`), on-brand alt, **57.1s**. |
| `voiceover.mp3` | The chosen track `assemble.sh` uses (currently = Andrew). |

The voiceover is **already generated** — you can listen now:
```bash
open demo/voiceover-andrew.mp3      # default
open demo/voiceover-prabhat.mp3     # Indian-English alternative
```

---

## Produce the final video in 5 steps

### 1 · (Optional) Re-render or switch the voiceover
Already done, but if you want to change voice or pacing:
```bash
./demo/generate-voiceover.sh                 # re-render (Andrew default, -14% rate ≈ 56.5s)
VOICE=prabhat ./demo/generate-voiceover.sh   # make Prabhat the default voiceover.mp3
```
To use the Indian-English voice without re-rendering, just point assembly at it (step 4).

> If a re-render runs long/short, tune the rate: `RATE="-6%" ./demo/generate-voiceover.sh`.
> The on-brand Prabhat voice was tuned separately at `+10%`; to reproduce it:
> ```bash
> source demo/.venv/bin/activate
> python -m edge_tts --voice en-IN-PrabhatNeural --rate "+10%" \
>   --text "$(awk '/^## Full voiceover/{f=1;next} f&&/^> /{sub(/^> /,"");print}' demo/SCRIPT.md)" \
>   --write-media demo/voiceover-prabhat.mp3
> ```

### 2 · Record the screen
Follow **`SHOT_LIST.md`** exactly. In short:
- Sign in to `https://hotel-zippo.vercel.app` (Google) — or use the local fallback in SHOT_LIST §5.
- QuickTime → New Screen Recording → Microphone **None** → record a clean 16:9 browser window.
- Run the 4 beats (problem → conversation+brief → recommendation+**hard flag** → shortlist+booking) as **one continuous take**. Let the ~30s recommendation wait happen — you'll cut it out next. **Note the timestamp when the "Researching…" pill appears.**
- Save the raw file as **`demo/raw-recording.mov`**.

### 2.5 · Cut out the ~30s recommendation wait
Prod recommendations take ~30s. Remove that dead air (the final length stays 56.5s — set by the voiceover):
```bash
# trim-wait.sh <input> <START> <CUT> [output]
./demo/trim-wait.sh raw-recording.mov 0:33 27 screen-recording.mov
```
- **START** = ~1.5s after the "Researching…" pill appeared (keeps a sliver of it).
- **CUT** = how many seconds of wait to remove (≈ wait length − 1.5s).
- Output `screen-recording.mov` is exactly what `assemble.sh` consumes. See `SHOT_LIST.md §4.5`.

> Recorded clean already (e.g. local fallback returns fast, or you pre-warmed the query)? Skip this — just name your file `screen-recording.mov`.

### 3 · Assemble
```bash
./demo/assemble.sh                 # voiceover over your recording → hotelzippo-demo.mp4
./demo/assemble.sh --captions      # also add captions (see note below)
```
To use the Indian-English voice:
```bash
VOICE_FILE=voiceover-prabhat.mp3 ./demo/assemble.sh
```

### 4 · Watch it
```bash
open demo/hotelzippo-demo.mp4
```
Check: the **red hard-flag** is on screen while the VO says *"never buries a dealbreaker… above everything else."* If the timing is off, re-record that beat slower (it's the most important frame) and re-assemble.

### 5 · Submit
Upload `demo/hotelzippo-demo.mp4`, and paste the write-up from **`SUBMISSION.md`** into the submission form.

---

## About captions

This machine's ffmpeg is built **without libass**, so `assemble.sh --captions` **muxes a soft (toggleable) subtitle track** into the MP4 instead of burning the text into the pixels. That's fine for most platforms — the viewer can turn captions on. Two ways to get **always-on, burned-in** captions if a platform needs them:

- **Easiest (free GUI):** open `hotelzippo-demo.mp4` in **HandBrake** (free) → Subtitles tab → import `captions.srt` → check **"Burn in"** → encode.
- **CLI:** reinstall ffmpeg with libass (`brew uninstall ffmpeg && brew install ffmpeg` usually includes it), then re-run `./demo/assemble.sh --captions` — it auto-detects libass and burns them in.
- **Or just ship `captions.srt` as a sidecar** next to the video — YouTube, Vimeo, and most contest portals accept an uploaded `.srt`.

---

## Notes

- **All generated media is git-ignored** (`.venv/`, `*.mp3`, `*.mov`, `*.mp4`) — see `demo/.gitignore`. The scripts + docs are committed; the binaries are reproducible from them.
- **No paid tools, no API keys** were used to make the video: QuickTime (built-in), edge-tts (free Microsoft neural voices), ffmpeg (free).
- The voiceover text in `generate-voiceover.sh` is kept identical to the "Full voiceover" block in `SCRIPT.md` — edit the script there and re-run if you tweak wording.
