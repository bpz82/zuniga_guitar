#!/usr/bin/env python3
"""Build the v10 app icons from a square logo PNG (Blake, 2026-11-04).

Usage: python3 -I scripts/build-icons-v10.py <logo10.png> <out-dir>

Writes NEW files only (old icons stay on disk):
  favicon-v10.ico (16/32/48), favicon-32-v10.png, apple-touch-icon-v10.png (180),
  icon-192-v10.png, icon-512-v10.png, icon-maskable-512-v10.png.
The maskable icon keeps the whole logo inside the 80% safe zone on a background
sampled from the logo's own corner, so Android's mask never clips the artwork.
"""
import sys
from pathlib import Path

from PIL import Image


def main(src: str, out: str) -> None:
    out_dir = Path(out)
    out_dir.mkdir(parents=True, exist_ok=True)
    logo = Image.open(src).convert('RGBA')
    w, h = logo.size
    if w != h:  # centre-crop to a square
        s = min(w, h)
        logo = logo.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s))

    def sized(n: int) -> Image.Image:
        return logo.resize((n, n), Image.LANCZOS)

    def save_new(img: Image.Image, name: str, **kw) -> None:
        path = out_dir / name
        if path.exists():
            raise SystemExit(f'refusing to overwrite {path}')
        img.save(path, **kw)
        print('wrote', path, img.size)

    # Opaque RGB for home-screen icons (iOS shows black behind transparency).
    corner = logo.getpixel((4, 4))[:3]

    def opaque(n: int) -> Image.Image:
        bg = Image.new('RGB', (n, n), corner)
        im = sized(n)
        bg.paste(im, (0, 0), im)
        return bg

    save_new(opaque(180), 'apple-touch-icon-v10.png', optimize=True)
    save_new(opaque(192), 'icon-192-v10.png', optimize=True)
    save_new(opaque(512), 'icon-512-v10.png', optimize=True)
    save_new(sized(32), 'favicon-32-v10.png', optimize=True)

    ico_path = out_dir / 'favicon-v10.ico'
    if ico_path.exists():
        raise SystemExit(f'refusing to overwrite {ico_path}')
    sized(48).save(ico_path, format='ICO', sizes=[(16, 16), (32, 32), (48, 48)])
    print('wrote', ico_path, '16/32/48')

    # Maskable: logo at 80% (the safe-zone circle has diameter 80%), centred.
    n = 512
    inner = round(n * 0.8)
    mask = Image.new('RGB', (n, n), corner)
    im = sized(inner)
    off = (n - inner) // 2
    mask.paste(im, (off, off), im)
    save_new(mask, 'icon-maskable-512-v10.png', optimize=True)
    print('background', '#%02x%02x%02x' % corner)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
