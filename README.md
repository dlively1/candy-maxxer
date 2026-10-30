# 🎃 Candy Maxxer

Give it an address; it plans the trick-or-treat loop that collects the most candy in your time budget
and gets you home — with hills priced in.

## How it works

1. **Geocode** — US Census geocoder (JSONP), Nominatim fallback.
2. **Houses & streets** — one Overpass (OpenStreetMap) query, 1 km radius, cached in `localStorage`.
3. **Elevation** — AWS Terrain Tiles (Terrarium PNGs, USGS 3DEP ~10 m), decoded in the browser.
4. **Walking graph** — streets densified to ≤20 m; each edge timed with Tobler's hiking function,
   separately uphill and downhill. Each house adds a front-path round trip + porch time.
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
