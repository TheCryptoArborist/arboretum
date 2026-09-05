# Arboretum Cosmetic Asset Checklist

Use this folder for final transparent PNG cosmetics that will overlay Seed slots.

## Frame Asset Rules

- Format: transparent PNG.
- Source aspect: square 1:1 from Leonardo is acceptable.
- Final site crop/export target: 512 x 768 px.
- No text, numbers, UI buttons, water drops, or Growth Point labels in the artwork.
- Keep the center mostly transparent so the Seed art, stage, Growth Points, timers, and buttons remain readable.
- Keep the bottom 150 px very light or transparent. This is the safe zone for timer pills and the Water button.
- Art should feel like real tree material: bark, branches, roots, leaves, rings, moss, crystals, sunlight, or moonlight.

## First Production Set

1. `starter-emerald-nursery.png` - common green bark and young leaves.
2. `rare-crystal-bark.png` - rare-tier bark frame with blue crystal accents.
3. `legendary-canopy-frame.png` - gold old-growth frame with strong leaf and branch detail.
4. `mythic-living-crown.png` - premium ancient branch crown with gold, purple, and living leaves.
5. `one-of-one-crown-frame.png` - highest-tier frame, unmistakably rarer than mythic.
6. `crystal-trellis.png` - purchasable TREE Shop frame with bark and crystal trellis styling.

## Review Standard

Each frame should pass a Seed slot preview check before production: the artwork must look intentional on desktop and mobile, and it must not cover the status pills, active item pills, countdowns, or Water button.

## Turning On A Frame

After a transparent PNG is added and reviewed, set that cosmetic definition in `index.html` from `assetReady:false` to `assetReady:true`. The site will then use the PNG overlay instead of the CSS fallback frame for both My Garden and the Seed Slot Preview.
