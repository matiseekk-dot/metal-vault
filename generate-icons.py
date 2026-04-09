#!/usr/bin/env python3
"""
Run this once locally to generate icon PNGs:
  pip install cairosvg
  python3 generate-icons.py

Or use any image editor to create:
  public/icons/icon-192.png  (192x192)
  public/icons/icon-512.png  (512x512)

Design: dark background #0a0a0a, red "MV" text in Bebas Neue style
"""

SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="80" fill="#0a0a0a"/>
  <rect width="512" height="512" rx="80" fill="url(#g)"/>
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1a0000"/>
      <stop offset="100%" stop-color="#0a0a0a"/>
    </linearGradient>
  </defs>
  <!-- Vinyl record circle -->
  <circle cx="256" cy="256" r="180" fill="none" stroke="#dc2626" stroke-width="3" opacity="0.3"/>
  <circle cx="256" cy="256" r="140" fill="none" stroke="#dc2626" stroke-width="2" opacity="0.2"/>
  <circle cx="256" cy="256" r="100" fill="none" stroke="#dc2626" stroke-width="2" opacity="0.15"/>
  <circle cx="256" cy="256" r="30" fill="#dc2626" opacity="0.8"/>
  <circle cx="256" cy="256" r="12" fill="#0a0a0a"/>
  <!-- MV text -->
  <text x="256" y="290" text-anchor="middle"
    font-family="Arial Black, sans-serif" font-weight="900"
    font-size="110" fill="#dc2626" letter-spacing="4">MV</text>
</svg>"""

try:
    import cairosvg
    cairosvg.svg2png(bytestring=SVG.encode(), write_to="public/icons/icon-192.png", output_width=192, output_height=192)
    cairosvg.svg2png(bytestring=SVG.encode(), write_to="public/icons/icon-512.png", output_width=512, output_height=512)
    print("Icons generated successfully!")
except ImportError:
    print("cairosvg not installed. Save the SVG below as icon.svg and convert manually:")
    print(SVG)
