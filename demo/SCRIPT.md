# HotelZippo — 60-Second Demo Script

**Format:** ~60s hard cap · 16:9 1080p · voiceover (`en-US-AndrewNeural`) + on-screen captions
**Reference scenario:** an Indian family of six (2 adults, kids 2 & 7, 2 grandparents), vegetarian, late December, beach resort in **Phuket**, comfort-to-luxury budget.

This script is the single source of truth. The voiceover (`generate-voiceover.sh`), the captions (`captions.srt`), and the recording (`SHOT_LIST.md`) all sync to the four beats below.

---

## Word count & pacing

Total ≈ **148 words**. At edge-tts's natural rate (~2.5 words/sec) this lands at **~58s** — safely under the 60s cap. Each beat's VO is timed to its on-screen action.

---

## BEAT 1 — The problem & the concierge · `0:00 – 0:12`

**On screen:** Landing page (`hotel-zippo.vercel.app`). Hold on the headline 2s, then click into the chat. Concierge welcome screen appears.

**Voiceover:**
> Planning a family trip means thirty hours lost across review sites, maps, and forums — and you still aren't sure. HotelZippo replaces all of it with one conversation.

*(~24 words · ~10s, +2s of hold)*

---

## BEAT 2 — Conversation → trip brief · `0:12 – 0:30`

**On screen:** Type the trip into the chat: *"A vegetarian family resort trip to Phuket in late December — two kids, two grandparents."* Send. The concierge streams a reply; the **Trip Brief rail** on the right fills in live (Destination, When, Who, Food…).

**Voiceover:**
> You just talk. Tell it who's travelling and where — a vegetarian family heading to Phuket with two kids and grandparents — and it asks the right questions, building a complete picture of exactly what your family needs.

*(~37 words · ~15s)*

---

## BEAT 3 — The recommendation & the hard flag · `0:30 – 0:46`

**On screen:** Click **Find hotels**. The recommendation set renders inline — the **Top Pick card** (lifted, terracotta badge) plus alternatives. Scroll so the **red hard-flag** ("Active refurbishment — avoid for now") is clearly visible above the fold on the flagged hotel.

**Voiceover:**
> Then it delivers one confident pick — backed by family reviews synthesised by AI, not a wall of links. And it never buries a dealbreaker. When a hotel has a real problem, the warning is right there, above everything else. Honesty over polish.

*(~41 words · ~16s)*

---

## BEAT 4 — Shortlist → booking & close · `0:46 – 0:58`

**On screen:** Click **Save to shortlist** (panel slides in), then **Proceed to book** — the booking handoff opens. End on the HotelZippo wordmark / top pick.

**Voiceover:**
> Save it, and book it — straight through. From a single question to a booking you can trust, in under a minute. HotelZippo. The family travel concierge.

*(~26 words · ~11s)*

---

## Full voiceover (continuous — this exact text is fed to edge-tts)

> Planning a family trip means thirty hours lost across review sites, maps, and forums — and you still aren't sure. HotelZippo replaces all of it with one conversation. You just talk. Tell it who's travelling and where — a vegetarian family heading to Phuket with two kids and grandparents — and it asks the right questions, building a complete picture of exactly what your family needs. Then it delivers one confident pick — backed by family reviews synthesised by AI, not a wall of links. And it never buries a dealbreaker. When a hotel has a real problem, the warning is right there, above everything else. Honesty over polish. Save it, and book it — straight through. From a single question to a booking you can trust, in under a minute. HotelZippo. The family travel concierge.

---

## Notes for the narrator (if recording your own voice instead of TTS)

- **Tone:** calm, warm, confident — a concierge, not an ad. Don't rush beat 3; let "honesty over polish" land.
- **Emphasis words:** *thirty hours* · *one conversation* · *the right questions* · *never buries a dealbreaker* · *above everything else* · *trust*.
- **Pause** ~0.4s before "And it never buries a dealbreaker" and before "HotelZippo. The family travel concierge."
