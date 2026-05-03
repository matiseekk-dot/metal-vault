# Icons

## Files

| File | Purpose | Source |
|------|---------|--------|
| `icon-192.png`           | `purpose: any`, 192×192 | original |
| `icon-512.png`           | `purpose: any`, 512×512 | original |
| `icon-192-maskable.png`  | `purpose: maskable`, 192×192 | **placeholder — see below** |
| `icon-512-maskable.png`  | `purpose: maskable`, 512×512 | **placeholder — see below** |

## Maskable icon — action required before Play Store submission

`icon-*-maskable.png` are currently copies of the regular icons. Maskable
icons need a ~10% safe zone of padding around the visible mark, because
Android crops them with circle / squircle / rounded-square masks depending
on the launcher.

To regenerate properly:

1. Open the source logo in https://maskable.app/editor
2. Adjust padding so the mark sits inside the inner safe-zone circle
3. Export at 512×512 (PNG) → save as `icon-512-maskable.png` here
4. Export at 192×192 (PNG) → save as `icon-192-maskable.png` here

Without this, Lighthouse will warn ("Manifest doesn't have a maskable icon
with proper safe zone") and the launcher icon may look cropped on some
Android skins. Bubblewrap will still build successfully.
