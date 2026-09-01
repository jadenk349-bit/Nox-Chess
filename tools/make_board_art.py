#!/usr/bin/env python3
"""Cut the board art out of the two reference photographs.

The game's board is a photograph, not a drawing: one shot of the board with the
men on it and one of the same board empty.  Everything the page needs is taken
from those two files —

    assets/board-squares.webp   the 8x8 playfield, one texture for the board
    assets/board-frame.webp     the surround, used as a CSS 9-slice border
    assets/pieces.webp          the twelve men, a 6x2 sheet, white row on top

Why two photographs: the empty one is what tells us where a man ends and its
square begins.  For most of the men the square and the man are far enough apart
in brightness that a threshold is enough (a black man on a sand square, a white
one on a night square); where they are not — the queens, each of which stands on
its own colour — the empty board is subtracted instead, and what is still
coloured like the square is thrown away.  That is the whole of `sprite()`.

The playfield is rebuilt square by square rather than scaled as one image: the
photographed squares are a couple of pixels off a perfect grid, and the page
draws its highlights on a perfect one.  Resampling each square onto an even
128px cell is what keeps a highlight on top of the square it belongs to.

The two reference shots are kept beside this file in `board-reference/`, so
running it with no arguments re-cuts exactly what ships.  They are webp because
that is 240 kB instead of 3 MB and the cutter reads pixels, not a file format;
the coordinates below are in their pixels, so replacing them means measuring
PLAY, OUTER, XS and YS again.

Usage:  python3 tools/make_board_art.py [men.webp empty.webp]
"""
import sys, os
from PIL import Image
import numpy as np
from scipy import ndimage as nd

# where the board sits in the reference photographs (they are the same shot)
PLAY  = (376, 87, 979, 654)      # the playfield, inside the gold liner
OUTER = (308, 18, 1045, 718)     # the whole board, frame and all
# the photographed squares are not perfectly even; these are where they fall
XS = [0, 75, 153, 225, 302, 375, 453, 526, 603]
YS = [0, 71, 143, 211, 283, 352, 425, 493, 567]
CELL = 128                        # the playfield is rebuilt at 8 * CELL
SPRITE = 256                      # one man, one cell of the sheet

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT  = os.path.join(ROOT, 'assets')
REF  = (os.path.join(HERE, 'board-reference', 'men.webp'),
        os.path.join(HERE, 'board-reference', 'empty.webp'))


def otsu(v):
    """The split between the two things in this square, wherever it falls."""
    lo, hi = float(v.min()), float(v.max())
    hist, edges = np.histogram(v, bins=96, range=(lo, hi))
    tot = hist.sum(); cum = np.cumsum(hist)
    mids = (edges[:-1] + edges[1:]) / 2
    csum = np.cumsum(hist * mids)
    best, cut = None, (lo + hi) / 2
    for i in range(1, 95):
        w0 = cum[i]; w1 = tot - w0
        if w0 == 0 or w1 == 0: continue
        m0 = csum[i] / w0; m1 = (csum[-1] - csum[i]) / w1
        var = w0 * w1 * (m0 - m1) ** 2
        if best is None or var > best: best, cut = var, mids[i]
    return cut


def central(m):
    """The blob the man is in — the one over the middle of the square, not the
       biggest: the dark seam between two squares is bigger and would win."""
    lab, n = nd.label(m)
    if not n: return m
    h, w = m.shape
    yy, xx = np.mgrid[0:h, 0:w]
    wgt = np.exp(-(((yy - h / 2) / (h * .33)) ** 2 + ((xx - w / 2) / (w * .33)) ** 2))
    return lab == int(np.argmax(nd.sum(wgt * m, lab, range(1, n + 1)))) + 1


class Art:
    def __init__(self, men_path, empty_path):
        self.men   = np.asarray(Image.open(men_path).convert('RGB')).astype(np.float32)
        self.empty = np.asarray(Image.open(empty_path).convert('RGB')).astype(np.float32)

    # ---- the men ----------------------------------------------------------
    def sprite(self, c, r, white, mode=None, bias=0., veto=None,
               close=3, openn=2, band=3, cut=.5, feather=.8):
        x0, y0 = PLAY[0] + XS[c] - 1, PLAY[1] + YS[r] - 1
        x1, y1 = PLAY[0] + XS[c + 1] + 1, PLAY[1] + YS[r + 1] + 1
        pa = self.men[y0:y1, x0:x1]
        light = (c + r) % 2 == 0            # a8 is sand, so an even sum is a light square
        R, G, B = pa[..., 0], pa[..., 1], pa[..., 2]
        chroma = lambda: nd.gaussian_filter(((R - B) if light else (B - R)) / (pa.max(axis=2) + 18), .8)
        if mode == 'diff':                  # a man on his own colour: neither tone nor
            pb = self.empty[y0:y1, x0:x1]   # hue tells him from the square, so ask the
            v = nd.gaussian_filter(np.abs(pa - pb).max(axis=2), 1.)   # empty board instead
            m = v > otsu(v) * (1 + bias)
            if veto is not None: m &= chroma() < veto   # …and drop what is still square-coloured
        elif white != light:                # the man and his square differ in brightness
            v = nd.gaussian_filter(.3 * R + .6 * G + .1 * B, .8)
            t = otsu(v) * (1 + bias)
            m = (v > t) if white else (v < t)
        else:                               # same tone: the square is coloured, the man is not
            v = chroma(); m = v < otsu(v) + bias
        if openn > 1: m = nd.binary_opening(m, np.ones((openn, openn)))
        m = nd.binary_closing(m, np.ones((close, close)))
        if band:                            # the seam around the square is not part of the man
            m[:band, :] = m[-band:, :] = False
            m[:, :band] = m[:, -band:] = False
        m = nd.binary_fill_holes(central(m))
        alpha = np.clip((nd.gaussian_filter(m.astype(np.float32), feather) - cut) / .34, 0, 1)
        rgb = Image.fromarray(pa.astype(np.uint8)).resize((SPRITE, SPRITE), Image.LANCZOS)
        al  = Image.fromarray((alpha * 255).astype(np.uint8)).resize((SPRITE, SPRITE), Image.LANCZOS)
        out = rgb.convert('RGBA'); out.putalpha(al)
        return out

    def sheet(self):
        # Column order is the sheet's order: K Q R B N P, white row then black.
        # Each man is taken from the square he reads most clearly on. Most of
        # them stand on the other colour, where brightness alone tells man from
        # square; the knights stand on their own and are cut by hue instead;
        # the queens, who also stand on their own, are too close in both and
        # are cut against the empty board.
        spec = {
            ('w', 'K'): ((4, 7), True,  {}),
            ('w', 'Q'): ((3, 7), True,  {}),
            ('w', 'R'): ((0, 7), True,  {}),
            ('w', 'B'): ((2, 7), True,  {}),
            ('w', 'N'): ((1, 7), True,  {}),
            ('w', 'P'): ((1, 6), True,  {}),
            ('b', 'K'): ((4, 0), False, {}),
            ('b', 'Q'): ((3, 0), False, {'mode': 'diff', 'bias': -.45, 'veto': .24}),
            ('b', 'R'): ((0, 0), False, {}),
            ('b', 'B'): ((2, 0), False, {}),
            ('b', 'N'): ((1, 0), False, {}),
            ('b', 'P'): ((1, 1), False, {}),
        }
        sheet = Image.new('RGBA', (SPRITE * 6, SPRITE * 2), (0, 0, 0, 0))
        for i, t in enumerate('KQRBNP'):
            for j, col in enumerate('wb'):
                (c, r), white, kw = spec[(col, t)]
                sheet.paste(self.sprite(c, r, white, **kw), (i * SPRITE, j * SPRITE))
        return sheet

    # ---- the board --------------------------------------------------------
    def squares(self):
        board = Image.new('RGB', (CELL * 8, CELL * 8))
        men = Image.fromarray(self.empty.astype(np.uint8))
        for r in range(8):
            for c in range(8):
                cell = men.crop((PLAY[0] + XS[c], PLAY[1] + YS[r],
                                 PLAY[0] + XS[c + 1], PLAY[1] + YS[r + 1]))
                board.paste(cell.resize((CELL, CELL), Image.LANCZOS), (c * CELL, r * CELL))
        return board

    def frame(self):
        """The surround, with the playfield punched out — CSS draws the middle."""
        img = Image.fromarray(self.empty.astype(np.uint8)).convert('RGBA')
        img = img.crop(OUTER)
        hole = Image.new('RGBA', (PLAY[2] - PLAY[0], PLAY[3] - PLAY[1]), (0, 0, 0, 0))
        img.paste(hole, (PLAY[0] - OUTER[0], PLAY[1] - OUTER[1]))
        return img


def main():
    if len(sys.argv) == 1:
        men, empty = REF
    elif len(sys.argv) == 3:
        men, empty = sys.argv[1], sys.argv[2]
    else:
        sys.exit(__doc__)
    art = Art(men, empty)
    jobs = [('pieces.webp', art.sheet(), dict(quality=90, method=6)),
            ('board-squares.webp', art.squares(), dict(quality=86, method=6)),
            ('board-frame.webp', art.frame(), dict(quality=88, method=6))]
    for name, img, kw in jobs:
        path = os.path.join(OUT, name)
        img.save(path, 'WEBP', **kw)
        print('%-22s %5.1f kB  %s' % (name, os.path.getsize(path) / 1024, img.size))
    print('frame slices (top right bottom left):',
          PLAY[1] - OUTER[1], OUTER[2] - PLAY[2], OUTER[3] - PLAY[3], PLAY[0] - OUTER[0])


if __name__ == '__main__':
    main()
