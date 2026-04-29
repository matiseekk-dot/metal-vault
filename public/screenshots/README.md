# Screenshots for PWA + Play Store

This folder is for **real app screenshots** used by:
1. PWA install prompt (Chrome / Edge / Brave on Android)
2. Google Play Store listing (when wrapping with Bubblewrap)

## Required before Play Store submission

Take screenshots on a real phone (or Chrome DevTools mobile mode at 1080×1920):

| Filename               | Content suggestion                          |
|------------------------|---------------------------------------------|
| `01-feed.png`          | Feed tab with several albums                |
| `02-vault.png`         | Vault → Collection sub-tab with sparkline   |
| `03-scan.png`          | Scanner active (barcode in viewfinder)      |
| `04-when-live.png`     | When → Live sub-tab (concerts list)         |
| `05-vinyl-modal.png`   | VinylModal with MarketComparison rows       |
| `06-stats-persona.png` | Stats sub-tab with PersonaCard              |
| `07-onboarding.png`    | First onboarding step                       |
| `08-upgrade.png`       | UpgradeModal open                           |

## Format

- **Aspect ratio**: 9:16 (portrait, 1080×1920 or 1080×2400)
- **PNG**, no compression artifacts
- **No status bar overlay** (use Chrome DevTools toolbar OFF mode if recording from desktop)
- **Real data**, not Lorem Ipsum — actual album covers, populated lists

## After adding screenshots — update manifest.json

```json
"screenshots": [
  {
    "src": "/screenshots/01-feed.png",
    "sizes": "1080x1920",
    "type": "image/png",
    "form_factor": "narrow",
    "label": "Browse new metal releases"
  },
  {
    "src": "/screenshots/02-vault.png",
    "sizes": "1080x1920",
    "type": "image/png",
    "form_factor": "narrow",
    "label": "Your collection with price trends"
  }
  // ... etc
]
```

`form_factor: "narrow"` = mobile portrait. Use `"wide"` for desktop screenshots if you want PWA install prompt to look good on Chrome desktop too.

## Why this matters

Currently `manifest.json` has NO screenshots entry — PWA install prompts will fall back to icon-only, looking unprofessional. Play Store TWA build will inherit this. Adding 2-3 real screenshots immediately fixes both.
