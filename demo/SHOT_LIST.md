# HotelZippo Demo — Recording Shot List (QuickTime, free)

Record **one continuous take** of the four beats below against the live deployment, then `assemble.sh` lays the voiceover over it. The voiceover is **56.5s**, so aim for a **~58s** recording. Pacing cues are per-beat.

> **Why one continuous take:** the voiceover is a single track. A continuous screen recording is easiest to sync. If you fluff a beat, just re-record the whole take — it's under a minute.

---

## 0 · Before you hit record (one-time setup)

### Recording settings (QuickTime Player — built into macOS, free)
1. **QuickTime Player → File → New Screen Recording.**
2. Click **Options**: set **Microphone → None** (we add VO separately), **Save to → Desktop**.
3. Choose **Record Selected Portion** and draw a **16:9 region** over the browser window — or record the full screen and let `assemble.sh` scale/crop. A clean 1920×1080 region is ideal.
4. Browser: use a clean window. **Hide bookmarks bar**, close other tabs, **zoom the page to ~110–125%** so text reads well in a small video. Use an incognito/guest window so no personal autofill shows.
5. Move your mouse deliberately and slowly on camera — fast cursor jumps look jittery in a 60s cut.

### Which environment to record
- **Primary: production** — `https://hotel-zippo.vercel.app`. Production `/chat` is **Google-login only**, so **sign in first** (before recording, or include a quick 2s of the landing page then cut in already-signed-in).
- **Prod data caveat:** prod only shows real recommendations for **destinations that have been curated/seeded**. Phuket is the safest bet (it's the canonical demo destination). If a Phuket query on prod does **not** return cards (or doesn't show the red hard-flag case), use the **local fallback** in §5 — it's visually identical and guaranteed to show the hard flag.
- Verify prod is demo-ready **before recording**: sign in, ask the Phuket query, confirm you get a Top Pick card **and** a red/amber hard flag. If yes → record prod. If no → record locally (§5).

---

## 1 · BEAT 1 — Problem & concierge · target `0:00–0:12`

| t | Action |
|---|---|
| 0:00 | Start on the **landing page** (`/`). Hold ~2s on the headline ("One confident recommendation. *No more research spiral.*") and the trust row. |
| 0:03 | Click into the chat (sign-in already done, or click the Google CTA if you recorded the login earlier). |
| 0:06 | Land on the **concierge welcome screen** — the avatar + "Hi, I'm your *family travel concierge*" greeting + starter chips. Hold ~3s. |
| 0:10 | Hover the composer ("Tell me about your trip…"). |

**Tip:** if signing in on camera is awkward, sign in first, then start your recording on the landing page and click straight through — the auth redirect is fast.

---

## 2 · BEAT 2 — Conversation → trip brief · target `0:12–0:30`

| t | Action |
|---|---|
| 0:12 | Click the composer and **type** (or paste) this trip: |

> **A vegetarian family resort trip to Phuket in late December — two kids aged 2 and 7, plus two grandparents. Comfort to luxury budget.**

| t | Action |
|---|---|
| 0:16 | Press **Enter**. The concierge streams its reply word-by-word. |
| 0:20 | **Point the cursor at the Trip Brief rail** (right side, desktop ≥1280px) as it fills in — Destination → Phuket, When → late December, Who → 2 adults + 2 kids + 2 grandparents, Food → Vegetarian. This is the "it understood my family" moment — let it land. |
| 0:26 | If the concierge asks one follow-up, answer briefly (e.g. "Near a calm, shallow beach for the toddler") so a **preference chip** appears in the rail. |

**Make the rail visible:** record at desktop width (≥1280px) so the Trip Brief rail shows. If you must record narrow, tap the brief toggle so the captured context is on screen — the rail filling in is the whole point of this beat.

---

## 3 · BEAT 3 — Recommendation & the hard flag · target `0:30–0:46`

> ⏱️ **About the ~30s wait:** on prod, the recommendation takes ~30s for the model to return. **Do not try to record this in real time** — just record naturally (let it wait), and afterwards cut the dead time out with `trim-wait.sh` (see §4.5 below). The final video length is fixed by the voiceover (56.5s), so trimming the wait never changes the duration. **Keep ~1.5s of the "Researching…" pill** — it shows the AI working — then the trim jump-cuts to the results.

| t | Action |
|---|---|
| 0:30 | Click **"Find hotels"** (enables once the core trip details are captured). |
| — | The **"Researching Phuket hotels…"** pill shows for ~30s. **Note the timestamp** when the pill appears (e.g. your recording clock reads 0:31.5) — you'll pass it to `trim-wait.sh`. Wait it out; don't stop recording. |
| 0:32* | When the **recommendation set renders inline**, carry on. (*The on-screen time after trimming.*) |
| 0:35 | Hold on the **Top Pick card** — the lifted card with the terracotta **"Top Pick"** badge, hotel name in serif, the "Why this one" verdict, and the 2×2 category grid (Rooms / Facilities / Food / Location). |
| 0:39 | **Scroll down slowly** to the alternative that carries the **hard flag**. |
| 0:41 | **Stop and hold** on the **red hard-flag bar** ("Active refurbishment — avoid for now" / "Based on recent guest reviews"). This is the single most important frame in the video — let it sit ~3s. The VO says "the warning is right there, above everything else" here. |

**Critical:** the hard flag must be clearly readable and on screen when the VO hits "never buries a dealbreaker" (~0:33) through "Honesty over polish" (~0:45). Slow down. Don't scroll past it.

---

## 4 · BEAT 4 — Shortlist → booking & close · target `0:46–0:58`

| t | Action |
|---|---|
| 0:46 | Click **"Save to shortlist"** on the Top Pick. The **shortlist panel slides in** from the right with the saved hotel + count badge. Hold ~2s. |
| 0:50 | Click **"Proceed to book"**. The **booking handoff** opens (a confirm screen / room picker, or the booking deep-link). Hold ~3s. |
| 0:55 | End on a clean frame — the **HotelZippo wordmark** in the top bar, or the Top Pick card. Stop recording at ~0:58. |

> On prod, "Proceed to book" may open a RouteStack deep-link in a new tab. That's fine — capturing the moment the booking opens is enough; you don't need to complete a real booking.

---

## 4.5 · Cut out the ~30s recommendation wait (after recording)

Your raw take includes the ~30s "Researching…" wait. Remove it so the footage matches the voiceover's pacing — **without** changing the final 56.5s length.

```bash
# ./demo/trim-wait.sh <input> <START> <CUT> [output]
#   START = when the wait begins (note it while recording), e.g. 0:31.5
#   CUT   = how many seconds of wait to remove, e.g. 28
./demo/trim-wait.sh raw-recording.mov 0:33 27 screen-recording.mov
```

- Set **START ~1.5s after the "Researching…" pill appears**, so a sliver of the pill survives → the video jump-cuts straight from "Find hotels" to the cards.
- **CUT** = roughly (how long the wait actually lasted − 1.5s). If the pill was on screen ~29s, cut ~27s.
- Output is `screen-recording.mov` — exactly what `assemble.sh` expects. If the jump-cut feels abrupt, re-run with START a touch earlier/later.

> The final video length is set by the voiceover (56.5s), so even if your trimmed footage is shorter, `assemble.sh` holds the last frame to fill — the duration is always locked. You can trim aggressively without worrying about timing.

---

## 5 · Local fallback (if prod data isn't demo-ready)

If prod doesn't return cards or the hard-flag case for Phuket, record locally — the UI is byte-for-byte the same and the demo seed **guarantees** the Holiday Inn Karon red-flag case.

```bash
# in the repo root
supabase start                         # local Postgres + Storage
npm run dev:db                         # seeds 10 demo hotels + intelligence (incl. the red-flag case)
# enable dev login (local only):
echo 'NEXT_PUBLIC_ENABLE_DEV_LOGIN=true' >> .env.local
# add your ANTHROPIC_API_KEY to .env.local for real recommendations
npm run dev:user                       # creates dev@hotelzippo.local / dev-password-123!
npm run dev                            # http://localhost:3000
```

Open `http://localhost:3000`, use the **"Dev sign-in"** box on the landing page → lands on `/chat`. Then follow Beats 1–4 exactly as above. Record the browser window the same way.

> The local seed ships **Phuket and Bali** demo data, and the canonical red **hard-flag** case (Holiday Inn Karon — "Active refurbishment"). Phuket is the destination to use.

---

## 6 · After recording

1. Rename your file to **`screen-recording.mov`** and move it into the `demo/` folder.
2. Run the assembly:
   ```bash
   ./demo/assemble.sh                       # voiceover only
   ./demo/assemble.sh --captions            # also burn in subtitles (good for muted judges)
   ```
3. Output: **`demo/hotelzippo-demo.mp4`** — your final submission video.

See `demo/README.md` for the full end-to-end runbook.
