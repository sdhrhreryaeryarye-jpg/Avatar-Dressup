#!/usr/bin/env python3
"""Режет картинку-сетку (по умолчанию 2x2) на отдельные ассеты и кладёт в нужную папку.

Нужна библиотека Pillow:  pip install pillow

Предметы (выбирает зритель) попадают в assets/<слот>/, слои лица в assets/face/.

Примеры:
  python split_grid.py hats1.png hat witch cap_red tophat crown
  python split_grid.py dresses.png outfit maid evening sailor sundress --size 256
  python split_grid.py hats2.png hat a b - d              (прочерк "-" пропускает ячейку)
  python split_grid.py mouths1.png mouth closed open smile frown --base male
  python split_grid.py brows.png brow neutral angry sad surprised
  python split_grid.py fx1.png fx blush sweat vein sparkle

Слот: base, eyes, hair, outfit, hat, acc, mouth, brow, eyex, fx.
Порядок ячеек: слева направо, сверху вниз
(верхняя левая, верхняя правая, нижняя левая, нижняя правая).
Файл получает имя <слот>_<название>.png, например assets/hat/hat_witch.png

--base male|female  только для слоёв лица: положить в assets/face/<база>/ (свой вариант под эту базу)
--size N            уменьшить каждый кусок до N x N (без сглаживания)
--remove-magenta    сделать пурпурный фон #FF00FF прозрачным
--cols / --rows     если сетка не 2x2
"""
import argparse
import os
import sys

from PIL import Image

ITEM_SLOTS = ("base", "eyes", "hair", "outfit", "hat", "acc")
FACE_SLOTS = ("mouth", "brow", "eyex", "fx")


def remove_magenta(img, tol=90):
    img = img.convert("RGBA")
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if abs(r - 255) + g + abs(b - 255) < tol:
                px[x, y] = (0, 0, 0, 0)
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("slot", choices=ITEM_SLOTS + FACE_SLOTS)
    ap.add_argument("names", nargs="+")
    ap.add_argument("--cols", type=int, default=2)
    ap.add_argument("--rows", type=int, default=2)
    ap.add_argument("--size", type=int, default=0)
    ap.add_argument("--base", default="")
    ap.add_argument("--remove-magenta", action="store_true")
    a = ap.parse_args()

    if a.base and a.slot not in FACE_SLOTS:
        sys.exit("--base нужен только для слоёв лица (mouth, brow, eyex, fx)")
    if len(a.names) != a.cols * a.rows:
        sys.exit("Нужно %d названий (по числу ячеек), получено %d" % (a.cols * a.rows, len(a.names)))

    img = Image.open(a.image).convert("RGBA")
    w, h = img.size
    cw, ch = w // a.cols, h // a.rows
    if w % a.cols or h % a.rows:
        print("! Размер %dx%d не делится ровно, края обрежутся" % (w, h))

    here = os.path.dirname(os.path.abspath(__file__))
    if a.slot in FACE_SLOTS:
        out_dir = os.path.join(here, "assets", "face", a.base) if a.base else os.path.join(here, "assets", "face")
    else:
        out_dir = os.path.join(here, "assets", a.slot)
    os.makedirs(out_dir, exist_ok=True)

    i = 0
    for r in range(a.rows):
        for c in range(a.cols):
            name = a.names[i]
            i += 1
            if name == "-":
                continue
            piece = img.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))
            if a.remove_magenta:
                piece = remove_magenta(piece)
            if a.size:
                piece = piece.resize((a.size, a.size), Image.NEAREST)
            stem = name if name.startswith(a.slot + "_") else "%s_%s" % (a.slot, name)
            path = os.path.join(out_dir, stem + ".png")
            piece.save(path)
            print("сохранено", os.path.relpath(path, here))
    print("Теперь запустите: python update_catalog.py")


if __name__ == "__main__":
    main()
