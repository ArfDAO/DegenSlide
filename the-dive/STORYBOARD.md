# THE DIVE — DegenSlide scroll-film

One unbroken shot: moonlit ocean surface → under the surface → the whale → its eye
→ the signal floor. Camera **always descending / pushing forward** — never a reversal,
never a cut. 5 chapters × 5s, 16:9. Audio OFF.

## Art direction (committed)

**The grade — "Midnight Pacific, Yinger cut".** This is NOT a blue Hollywood ocean.
Shadows fall to the brand's warm near-black `#0e0f0c`; highlights are bone `#e4dfda`
(moonlight, glints, whale skin rim-light); the only colour is ember `#d6633a`
bioluminescence, sparse until CH04–05. Desaturated everything else. One grade, all
five clips — grade drift is the #1 junction killer.

- Abyss / canvas: `#0e0f0c` (warm near-black — matches app `--bg-app`)
- Moon / rim light: `#e4dfda` (bone glow)
- Bioluminescence: `#d6633a` (muted ember) — particles only, never washes
- Rare secondary glint: `#6db48a` (sage) — CH05 grid only, <5% of lights
- Seam target (final frame edge): near `#0e0f0c` → hands off into page background

**Type (continuity with the app):** display = Space Mono uppercase tight
(`letter-spacing:-0.04em`, the app's wordmark voice) · telemetry = JetBrains Mono ·
body = Inter. The landing must read as the same product as the app.

**Motion feel:** heavy, inevitable, slow — a submersible, not a drone. Constant
descent speed across chapters (uniform 5s clips = constant scrub speed).

**Chapter names (used in the page's altimeter readout):**
`01 SURFACE · 02 DESCENT · 03 THE WHALE · 04 THE EYE · 05 SIGNAL FLOOR`

---

## Opening keyframe (Nano Banana Pro, text-to-image, 16:9)

> Cinematic aerial night shot, high above a vast open ocean at midnight. Nearly black
> warm-toned water, gentle swell. Cold full-moon light scatters bone-white glints
> across the wave crests in a broken path toward the horizon. No land, no boats, no
> sky detail — just black water, faint horizon line, moonlight glints. Film still,
> anamorphic, muted desaturated grade, warm black shadows (#0e0f0c), bone-white
> highlights (#e4dfda). Photorealistic, 35mm film grain.

## CH01 — SURFACE  (start-image: keyframe)

> Continue the exact same shot from the reference frame, identical framing, identical
> colour grade. Do not change the colour grade. The camera pushes slowly straight
> down toward the black ocean surface in one continuous descending move, no cuts.
> Moonlight glints drift on the swell. As the camera nears the water the surface
> fills the frame, the horizon leaves the top of frame. Ends close above dark water,
> nose-down. Slow, heavy, cinematic, photorealistic, 35mm grain.

## CH02 — DESCENT  (start-image: ch01-last.png)

> Continue the exact same shot from the reference frame, identical framing, identical
> colour grade. Do not change the colour grade. The camera pierces through the ocean
> surface and descends underwater in the same continuous move, no cuts. Small silver
> bubbles streak upward past the lens. Pale bone-white shafts of moonlight fan down
> through dark water from the surface above. The water is deep warm-black, not blue.
> Depth grows; the light rays soften. Ends in open dark water, rays visible above.
> Slow, heavy, photorealistic, 35mm grain.

## CH03 — THE WHALE  (start-image: ch02-last.png)

> Continue the exact same shot from the reference frame, identical framing, identical
> colour grade. Do not change the colour grade. Still descending through dark open
> water in one continuous move, no cuts: below the camera a colossal whale glides
> slowly across frame, its back rim-lit in pale bone moonlight. A tight school of
> small silver fish trails its wake, mirroring its turn. The camera keeps descending
> toward the whale, closing the distance. Ends close above the whale's massive back.
> Majestic, slow, photorealistic, 35mm grain.

## CH04 — THE EYE  (start-image: ch03-last.png)

> Continue the exact same shot from the reference frame, identical framing, identical
> colour grade. Do not change the colour grade. The camera glides forward along the
> whale's dark flank toward its head in the same continuous move, no cuts. Sparse
> ember-orange bioluminescent particles (#d6633a) drift in the black water, glowing
> softly. The whale's eye comes into view and grows until it nearly fills the frame —
> ancient, calm, with tiny ember specks reflected in it. Ends on an extreme close-up
> of the eye. Intimate, slow, photorealistic, 35mm grain.

## CH05 — SIGNAL FLOOR  (start-image: ch04-last.png)

> Continue the exact same shot from the reference frame, identical framing, identical
> colour grade. Do not change the colour grade. The camera pushes into the black of
> the eye's pupil in one continuous move, no cuts; the darkness opens into deep
> abyssal water. Drifting ember-orange particles slowly settle into a faint,
> ordered grid of small lights on the abyssal plane below — like a distant terminal
> constellation, mostly ember (#d6633a) with rare pale-green points (#6db48a). The
> camera slows and settles; the image darkens toward warm black (#0e0f0c), the grid
> faint at the bottom of frame. Ends nearly black. Slow, final, photorealistic,
> 35mm grain.

---

## Chain contract (per clip)

```
scripts/chain-step.sh assets ch0N <prev-last.png> "<prompt>" <prev-last.png> [480p|1080p]
```

Draft pass: all 5 @ 480p/fast (~7.5 cr each ≈ 37.5 cr) → junction-gate every seam
(SSIM ≥ 0.88 pass; 0.80–0.88 watch in motion; structural drift = regenerate).
Master pass: only approved prompts @ 1080p/std (~45 cr each ≈ 225 cr) — after
explicit user approval of the draft chain and the cost quote.

## After-film content (below the scroll)

Seam gradient starts at sampled final-frame colour → sections: LIVE SIGNALS (deck
preview) · HOW IT WORKS (swipe → copy → manage, 3 terminal cards) · CHAINS (MON/SOL)
· CTA "Open the deck" → app URL · footer (socials, disclaimer). All Yinger tokens.
