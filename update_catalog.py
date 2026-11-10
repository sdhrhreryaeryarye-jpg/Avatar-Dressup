#!/usr/bin/env python3
"""Пересобирает catalog.json и catalog.js по содержимому папки assets/.

Запуск:  python update_catalog.py
Ничего устанавливать не нужно (только стандартный Python 3).

Предметы, которые выбирает зритель:
  assets/<слот>/<слот>_<название>.png     например assets/hat/hat_witch.png
  слоты: base, eyes, hair, outfit, hat, acc

Слои лица для анимации (зритель их не выбирает):
  assets/face/<вид>_<название>.png        общие для всех баз, например assets/face/mouth_open.png
  assets/face/<male|female>/<...>.png     свой вариант для конкретной базы (имя папки = id базы без "base_")
  виды: mouth, brow, eyex (особые глаза), fx (эффекты)

Допустимы строчные латинские буквы, цифры и подчёркивание.
Ручные настройки (dx, dy, scale, label, hides, order, face.params) в catalog.json сохраняются.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "assets")
FACE_DIR = os.path.join(ASSETS, "face")

SLOTS = [
    ("base", "Тело", True),
    ("eyes", "Глаза", True),
    ("hair", "Причёска", False),
    ("outfit", "Одежда", False),
    ("hat", "Головной убор", False),
    ("acc", "Аксессуар", False),
]
DEFAULT_ORDER = ["base", "eyes", "eyex", "brow", "mouth", "outfit", "hair", "hat", "acc", "fx"]
DEFAULT_PARAMS = {"eyeY": 0.42}   # высота линии глаз в долях картинки (моргание сжимает вокруг неё)

# что ждёт анимация (отсутствующее просто не показывается)
EXPECTED = {
    "mouth": ["closed", "open", "smile", "frown", "wavy", "o", "shout", "laugh"],
    "brow": ["neutral", "angry", "sad", "surprised"],
    "eyex": ["happy", "relaxed", "squeeze", "dot"],
    "fx": ["blush", "sweat", "vein", "sparkle", "tears", "gloom", "heart", "excl"],
}
ID_RE = re.compile(r"^[a-z0-9_]+$")


def load_old():
    path = os.path.join(HERE, "catalog.json")
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print("! Не удалось прочитать старый catalog.json:", e)
    return {}


def scan_items(old_items, warnings):
    items = {}
    for slot, _label, _req in SLOTS:
        folder = os.path.join(ASSETS, slot)
        os.makedirs(folder, exist_ok=True)
        lst = []
        for fn in sorted(os.listdir(folder)):
            stem, ext = os.path.splitext(fn)
            if ext.lower() != ".png":
                continue
            if not ID_RE.match(stem):
                warnings.append("Пропущен %s/%s: имя только из a-z, 0-9 и _" % (slot, fn))
                continue
            if not stem.startswith(slot + "_"):
                warnings.append("Пропущен %s/%s: имя должно начинаться с %s_" % (slot, fn, slot))
                continue
            prev = old_items.get(stem, {})
            lst.append({
                "id": stem,
                "file": "assets/%s/%s" % (slot, fn),
                "label": prev.get("label") or stem[len(slot) + 1:].replace("_", " "),
                "dx": prev.get("dx", 0),
                "dy": prev.get("dy", 0),
                "scale": prev.get("scale", 1),
            })
        items[slot] = lst
    return items


def scan_face(base_keys, warnings):
    """Возвращает {ключ: {"file": путь|None, "per": {база: путь}}}."""
    assets = {}
    os.makedirs(FACE_DIR, exist_ok=True)

    def add(path_dir, rel_dir, per_key):
        for fn in sorted(os.listdir(path_dir)):
            full = os.path.join(path_dir, fn)
            stem, ext = os.path.splitext(fn)
            if os.path.isdir(full) or ext.lower() != ".png":
                continue
            where = "face/%s%s" % (per_key + "/" if per_key else "", fn)
            kind = stem.split("_", 1)[0]
            if not ID_RE.match(stem) or kind not in EXPECTED or "_" not in stem:
                warnings.append("Пропущен %s: имя вида <mouth|brow|eyex|fx>_<название>.png из a-z, 0-9, _" % where)
                continue
            if stem.split("_", 1)[1] not in EXPECTED[kind]:
                warnings.append("%s: анимация не знает такого слоя, он не будет показан (знает: %s)"
                                % (where, ", ".join(EXPECTED[kind])))
            rec = assets.setdefault(stem, {"file": None, "per": {}})
            path = "%s/%s" % (rel_dir, fn)
            if per_key:
                rec["per"][per_key] = path
            else:
                rec["file"] = path

    add(FACE_DIR, "assets/face", "")
    for sub in sorted(os.listdir(FACE_DIR)):
        if os.path.isdir(os.path.join(FACE_DIR, sub)):
            if sub not in base_keys:
                warnings.append("Папка face/%s не совпадает ни с одной базой (%s), пропущена" % (sub, ", ".join(base_keys) or "баз нет"))
                continue
            add(os.path.join(FACE_DIR, sub), "assets/face/" + sub, sub)
    return assets


def main():
    old = load_old()
    old_items = {}
    for lst in old.get("items", {}).values():
        for it in lst:
            old_items[it["id"]] = it

    warnings = []
    items = scan_items(old_items, warnings)
    base_keys = [it["id"][len("base_"):] for it in items["base"]]
    face_assets = scan_face(base_keys, warnings)

    order = old.get("order")
    if not order or set(order) != set(DEFAULT_ORDER):
        if order:
            print("Порядок слоёв обновлён под слои лица (был: %s)" % ", ".join(order))
        order = DEFAULT_ORDER
    params = dict(DEFAULT_PARAMS)
    params.update(old.get("face", {}).get("params", {}))

    cat = {
        "slots": [{"id": s, "label": l, "required": r} for s, l, r in SLOTS],
        "order": order,
        "hides": old.get("hides", {}),
        "items": items,
        "face": {"params": params, "assets": face_assets},
    }

    old_cmp = {k: v for k, v in old.items() if k != "version"}
    cat["version"] = 1 if not old else old.get("version", 0) + (1 if old_cmp != cat else 0)

    with open(os.path.join(HERE, "catalog.json"), "w", encoding="utf-8") as f:
        json.dump(cat, f, ensure_ascii=False, indent=2)
    with open(os.path.join(HERE, "catalog.js"), "w", encoding="utf-8") as f:
        f.write("window.CATALOG = ")
        json.dump(cat, f, ensure_ascii=False)
        f.write(";\n")

    # список id для Streamer.bot (только то, что выбирает зритель)
    ids = [it["id"] for s, _, _ in SLOTS for it in items[s]]
    with open(os.path.join(HERE, "streamerbot_items.txt"), "w", encoding="utf-8") as f:
        f.write(",\n".join('"%s"' % i for i in ids) + "\n")

    print("Каталог v%d: предметов %d, слоёв лица %d" % (cat["version"], len(ids), len(face_assets)))
    for s, _, _ in SLOTS:
        print("  %-7s %d" % (s, len(items[s])))

    # чего не хватает для анимации
    for kind, names in EXPECTED.items():
        missing = []
        for n in names:
            rec = face_assets.get("%s_%s" % (kind, n))
            if not rec or (not rec["file"] and not rec["per"]):
                missing.append(n)
            elif not rec["file"]:
                lacking = [b for b in base_keys if b not in rec["per"]]
                if lacking:
                    warnings.append("%s_%s нет для баз: %s" % (kind, n, ", ".join(lacking)))
        if missing:
            print("  нет слоёв %s: %s" % (kind, ", ".join(missing)))
    for w in warnings:
        print("!", w)
    if not warnings:
        print("Готово. Список id для Streamer.bot записан в streamerbot_items.txt")


if __name__ == "__main__":
    sys.exit(main())
