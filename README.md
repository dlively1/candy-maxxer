# 🎃 Candy Maxxer

Give it an address; it plans the trick-or-treat loop that collects the most candy in your time budget
and gets you home — with hills priced in.

## How it works

1. **Start** — "find me" (browser geolocation) flies the map to you; go near a house and it rises out of
   the ground as a haunted house (now and then one rises on its own). Tap yours or drag the gold pin (it
   snaps to a house, else the street). Or pick a
   type-ahead suggestion (houses already on the map first, then Photon, kept within ~30 km of what's on
   screen unless you type a town), or type an address (US Census geocoder via JSONP, Nominatim fallback).
   The chosen start is kept as is and remembered, so GPS jitter never moves it; drag the 🏠 on a plan to
   move it and re-plan, or tap the 🪦 next to the plan summary to clear everything and pick a new start.
2. **Houses & streets** — one Overpass (OpenStreetMap) query (600 m, widening to 1.5 km if sparse), raced
   across four public servers and saved in IndexedDB. A saved neighboring download is reused when it
   covers the spot, and stands in when every server is busy.
3. **Elevation** — AWS Terrain Tiles (Terrarium PNGs, USGS 3DEP ~10 m), decoded in the browser.
4. **Walking graph** — streets densified to ≤20 m; each edge timed with Tobler's hiking function,
   separately uphill and downhill. Bridges and tunnels ramp straight between their ends (the terrain
   is the ground, not the deck), and routes stay on the start's own connected network (the nearest one at least a quarter the size
   of the biggest within 400 m, so a driveway stub can't strand you, but a subdivision that only meets
   the rest across a no-walking highway still works). Each house adds a front-path round trip + porch time.
5. **Solver** (Web Worker) — orienteering problem: greedy candy-per-second insertion, asymmetric 2-opt,
   relocate, then ~0.4 s of iterated local search (tear out a stretch, rebuild, keep if better).
6. **Compare** — a second route next to Max Candy: *Easier legs* (climbing is charged against the haul;
   least climbing that keeps ≥ 85% of the candy, hidden if it isn't ≥ 10 ft flatter), *Different streets*
   (Max Candy's houses discounted to 10%), or *+30 min*.
7. **Directions** — chevrons along the followed route (right of travel, so out-and-back streets read as
   "down this side, back that side") and turn-by-turn steps, including turn-arounds.

Candy model (`src/candy.js`): 2 pieces/house, up to +1 for big footprints; click a house to mark it
⭐ full-size (6) or 🌑 dark (0). Overrides persist in `localStorage`.

## Share a route

Every plan updates the URL, and **Share this route** copies it:

```
?address=301 Shiloh St, Pittsburgh, PA&min=90&walker=kid&door=30&compare=easy
```

Links made by the app also carry `at=lat,lon`, the exact start, so they open at the same spot without
geocoding again.

`walker`: `toddler` | `kid` | `teen` · `compare`: `easy` | `fresh` | `more` | `none` · `min`: 30–180 · `door`: 10–90 s

## Run

No build step, no dependencies.

```sh
npm start        # python3 -m http.server 8080 --bind 0.0.0.0
npm test         # node --test (saved OSM + terrain fixtures around Mount Washington, Pittsburgh)
```

## Deploy

GitHub Pages serves the repo root from `main`: **https://dlively1.github.io/candy-maxxer/**.
Push to `main` and it redeploys. (`.nojekyll` skips Jekyll processing.)
