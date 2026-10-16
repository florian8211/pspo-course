#!/usr/bin/env python3
"""Generate the PWA icons in server/static/ (standard library only, deterministic).

Design: solid #0F5567 background with three white, left-aligned bars of
decreasing length (100%, 75%, 50%), like an ordered list. The mark spans the
central ~62% of the canvas; on the maskable icon it stays inside the central
50% so launchers can crop it to any shape.

Usage: python3 server/make_icons.py [OUTPUT_DIR]   (default: server/static)
"""

import struct
import sys
import zlib
from pathlib import Path

BACKGROUND = (0x0F, 0x55, 0x67)
FOREGROUND = (0xFF, 0xFF, 0xFF)
BAR_LENGTHS = (1.0, 0.75, 0.5)

ICONS = (
    ("icon-192.png", 192, 0.62),
    ("icon-512.png", 512, 0.62),
    ("icon-maskable-512.png", 512, 0.46),
)


def chunk(kind: bytes, data: bytes) -> bytes:
    body = kind + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)


def png(width: int, height: int, rows) -> bytes:
    """Encode 8-bit RGB rows (each a bytes object of width*3) as a PNG."""
    raw = b"".join(b"\x00" + row for row in rows)  # filter type 0 per row
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def icon(size: int, mark_fraction: float) -> bytes:
    mark = round(size * mark_fraction)
    left = top = (size - mark) // 2
    bar = mark / 5  # bar, gap, bar, gap, bar
    bars = []
    for i, length in enumerate(BAR_LENGTHS):
        y0 = top + round(2 * i * bar)
        bars.append((y0, top + round((2 * i + 1) * bar), left + round(mark * length)))

    bg = bytes(BACKGROUND)
    fg = bytes(FOREGROUND)
    rows = []
    for y in range(size):
        right = next((x1 for y0, y1, x1 in bars if y0 <= y < y1), None)
        if right is None:
            rows.append(bg * size)
        else:
            rows.append(bg * left + fg * (right - left) + bg * (size - right))
    return png(size, size, rows)


def main(out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, size, fraction in ICONS:
        (out_dir / name).write_bytes(icon(size, fraction))


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent / "static")
