"""Extrae productos (código, nombre, precio, puntos, página) de la revista Natura en PDF."""
import json
import re
import sys

import pymupdf as fitz

PDF = sys.argv[1]
OUT = sys.argv[2]

CODE_RE = re.compile(r"\((\d{4,6})\)")
MONEY_RE = re.compile(r"\$\s*([\d\.]+)")
PTS_RE = re.compile(r"(\d+)\s*pts")
SKIP_RE = re.compile(
    r"^(\$|A \$|De \$|Te ahorras|\(\d|Intensidad|ml a|g a|Unidad a|cada uno|\d+\s*pts|\d+%|de descuento|Las imágenes|LANZAMIENTO|NUEVO|Favorito|de Natura|\*)",
    re.I,
)


def money(s):
    m = MONEY_RE.search(s)
    if not m:
        return None
    try:
        return int(m.group(1).replace(".", ""))
    except ValueError:
        return None


def page_lines(page):
    out = []
    for b in page.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            spans = [s for s in l["spans"] if s["text"].strip()]
            if not spans:
                continue
            t = " ".join(s["text"].strip() for s in spans)
            t = re.sub(r"\s+", " ", t).strip()
            out.append({"t": t, "b": l["bbox"], "size": max(s["size"] for s in spans), "spans": spans})
    return out


def overlap_x(a, b, pad=0):
    return min(a[2], b[2] + pad) - max(a[0], b[0] - pad)


def find_name(code_b, lines):
    cx0, cy0 = code_b[0], code_b[1]
    cands = [
        l for l in lines
        if l["b"][3] <= cy0 + 1.5 and cy0 - l["b"][3] < 60
        and l["b"][0] >= cx0 - 18 and l["b"][0] <= cx0 + 20
    ]
    cands.sort(key=lambda l: -l["b"][3])
    got = []
    last_top = cy0
    for l in cands:
        gap = last_top - l["b"][3]
        if gap > (16 if got else 22):
            break
        if CODE_RE.search(l["t"]) or l["t"].startswith("$") or "Te ahorras" in l["t"] or l["t"].startswith(("A $", "De $")):
            break
        if SKIP_RE.match(l["t"]) and not got:
            last_top = l["b"][1]
            continue
        if SKIP_RE.match(l["t"]):
            break
        if l["size"] > 14:  # titulares grandes
            break
        got.insert(0, l["t"])
        last_top = l["b"][1]
        if l["t"].lower() == "repuesto" or (len(got) == 1 and shade_like(l["t"]) and len(l["t"]) < 12):
            break
        if len(got) >= 4:
            break
    name = " ".join(got)
    name = re.sub(r"^\d+\.?\s+(?=[A-ZÁÉÍÓÚ])", "", name)
    return name.strip()


def page_title(lines):
    top = [l for l in lines if l["size"] >= 13 and not SKIP_RE.match(l["t"]) and len(l["t"]) > 3 and not re.match(r"^[\d%]+", l["t"])]
    top.sort(key=lambda l: (l["b"][1]))
    return top[0]["t"] if top else ""


def offer_desc(lines):
    items = [l for l in lines if re.match(r"^\d+ [A-ZÁÉÍÓÚa-z]", l["t"]) and l["size"] < 12]
    items.sort(key=lambda l: (l["b"][1], l["b"][0]))
    return [re.sub(r"\s+", " ", l["t"]) for l in items]


BARE_RE = re.compile(r"^\d{1,3}(\.\d{3})+$")


def is_price(l):
    t = l["t"]
    if t.startswith(("$", "A $")) or re.match(r"^a\s*\$\s*\d", t):
        return True
    t2 = re.sub(r"^[aA]\s+", "", re.sub(r"\s+", " ", t.replace("$", " ")).strip()).strip()
    return bool(BARE_RE.match(t2) and (l["size"] >= 11 or "$" in t))


def is_before(l):
    return l["t"].lower().startswith("de $")


def money2(t):
    m = re.search(r"\d{1,3}(?:\.\d{3})+", t)
    return int(m.group(0).replace(".", "")) if m else money(t)


SRC = {"v": None}


def find_price(code_b, lines):
    cx0, cy0, cx1, cy1 = code_b
    SRC["v"] = None
    below = [l for l in lines if is_price(l) and 0 <= l["b"][1] - cy1 < 40 and abs(l["b"][0] - cx0) < 40]
    if below:
        below.sort(key=lambda l: l["b"][1] - cy1)
        de = [l for l in lines if is_before(l) and 0 <= l["b"][1] - cy1 < 30 and abs(l["b"][0] - cx0) < 40]
        SRC["v"] = "debajo"
        return money2(below[0]["t"]), (money(de[0]["t"]) if de else None)
    # 2) oferta: "A $" y "De $" arriba del código
    a = [l for l in lines if l["t"].startswith("A $") and 0 <= cy0 - l["b"][3] < 80 and abs(l["b"][0] - cx0) < 60]
    if a:
        a.sort(key=lambda l: cy0 - l["b"][3])
        de = [l for l in lines if is_before(l) and -10 <= a[0]["b"][1] - l["b"][3] < 40 and abs(l["b"][0] - a[0]["b"][0]) < 40]
        SRC["v"] = "oferta"
        return money(a[0]["t"]), (money(de[0]["t"]) if de else None)
    # 3) precio más cercano en la página (p. ej. "cada uno" o variantes)
    best = None
    for l in lines:
        if is_price(l):
            dx = l["b"][0] - cx0
            dy = l["b"][1] - cy0
            dist = (dx * dx + dy * dy) ** 0.5
            if best is None or dist < best[0]:
                best = (dist, l)
    if best and best[0] < 260:
        SRC["v"] = "cercano"
        de = [l for l in lines if is_before(l) and 0 <= best[1]["b"][1] - l["b"][3] < 40 and abs(l["b"][0] - best[1]["b"][0]) < 40]
        return money2(best[1]["t"]), (money(de[0]["t"]) if de else None)
    return None, None


def code_spans(lines):
    for l in lines:
        for s in l["spans"]:
            for m in CODE_RE.finditer(s["text"]):
                x0, y0, x1, y1 = s["bbox"]
                n = len(s["text"]) or 1
                # posición aproximada del código dentro del span
                fx0 = x0 + (x1 - x0) * m.start() / n
                rest = s["text"][m.end():]
                pm = PTS_RE.search(rest) or PTS_RE.search(l["t"])
                yield m.group(1), (fx0, y0, x1, y1), l, (int(pm.group(1)) if pm else None)


MEASURE_RE = re.compile(r"\d+\s?(ml|g|kg|cm|un)\b", re.I)
KEYWORDS = re.compile(r"(eau|perfume|colonia|shampoo|acondicionador|jab[oó]n|crema|loci[oó]n|s[eé]rum|base|labial|m[aá]scara|polvo|corrector|delineador|sombra|aceite|gel|pulpa|desodorante|protector|kit|caja|bolsa|esmalte|rubor|t[oó]nico|exfoliante|mascarilla|spray|hidratante|bruma|body|repuesto|estuche|set)", re.I)


def shade_like(name):
    return len(name) < 30 and not MEASURE_RE.search(name) and not KEYWORDS.search(name)


def descriptor(code_b, lines):
    """Bloque de producto más cercano (nombre con medida) para códigos de tonos/variantes."""
    cy = code_b[1]
    cands = [l for l in lines if MEASURE_RE.search(l["t"]) and l["size"] < 13 and not CODE_RE.search(l["t"]) and not SKIP_RE.match(l["t"]) and "Largo" not in l["t"]]
    best = None
    for l in cands:
        dy = cy - l["b"][1]
        if dy < -60:
            continue
        score = abs(dy) + (0 if l["b"][0] <= code_b[0] else 60)
        if best is None or score < best[0]:
            best = (score, l)
    if not best or best[0] > 220:
        return None, None
    l = best[1]
    # incluir líneas inmediatamente encima (nombre partido en 2-3 líneas)
    parts = [l["t"]]
    top = l["b"][1]
    for _ in range(3):
        up = [u for u in lines if 0 <= top - u["b"][3] < 6 and abs(u["b"][0] - l["b"][0]) < 8 and abs(u["size"] - l["size"]) < 1.6 and not SKIP_RE.match(u["t"]) and not u["t"].rstrip("*").endswith(".")]
        if not up:
            break
        u = max(up, key=lambda u: u["b"][3])
        parts.insert(0, u["t"])
        top = u["b"][1]
    return re.sub(r"^\d+\.?\s+(?=[A-ZÁÉÍÓÚ])", "", " ".join(parts)), l


def main():
    doc = fitz.open(PDF)
    products = {}
    order = []
    for pi in range(len(doc)):
        page = doc[pi]
        lines = page_lines(page)
        codes = sorted(code_spans(lines), key=lambda c: (round(c[1][1] / 4), c[1][0]))
        if not codes:
            continue
        title = page_title(lines)
        desc = offer_desc(lines)
        page_names = {}
        page_names_b = {}
        for code, b, line, pts in codes:
            name = find_name(b, lines)
            kind = "regular"
            if not name or name.lower() in ("repuesto",):
                if name.lower() == "repuesto":
                    # repuesto del producto de arriba en la misma columna
                    ups = [(cb, page_names[cc]) for cc, cb in page_names_b.items() if cb[1] < b[1] and abs(cb[0] - b[0]) < 40]
                    base = sorted(ups, key=lambda x: -x[0][1])[0][1] if ups else title
                    name = f"{base} - Repuesto"
                else:
                    kind = "oferta"
                    name = title
            price, before = find_price(b, lines)
            src = SRC["v"]
            base_name = name.replace(" - Repuesto", "")
            if kind == "regular" and shade_like(base_name):
                dname, dl = descriptor(b, lines)
                if dname:
                    name = f"{dname} - {name}"
                    p2, b2 = find_price(dl["b"], lines)
                    if " - Repuesto" in name:
                        rep = [l for l in lines if l["t"].lower().startswith("repuesto") and abs(l["b"][0] - dl["b"][0]) < 10 and 0 < l["b"][1] - dl["b"][1] < 140]
                        if rep:
                            p2, b2 = find_price(min(rep, key=lambda l: l["b"][1])["b"], lines)
                    if p2:
                        price, before = p2, b2
                        src = "tono"
            name = re.sub(r"( - Repuesto)+", " - Repuesto", name)
            if code in products:
                continue
            p = {
                "code": code,
                "name": name,
                "price": price,
                "before": before,
                "pts": pts,
                "page": pi + 1,
                "title": title,
                "kind": kind,
                "detail": desc if kind == "oferta" else [],
                "bbox": [round(v, 1) for v in b],
                "src": src,
            }
            products[code] = p
            order.append(code)
            page_names[code] = name
        # respaldo por página: tonos sin precio/nombre base
        main_prices = [l for l in lines if is_price(l)]
        main_price = max(main_prices, key=lambda l: l["size"]) if main_prices else None
        mp_before = None
        if main_price:
            de = [l for l in lines if is_before(l) and 0 <= main_price["b"][1] - l["b"][3] < 40 and abs(l["b"][0] - main_price["b"][0]) < 50]
            mp_before = money(de[0]["t"]) if de else None
        meas = [l for l in lines if MEASURE_RE.search(l["t"]) and l["size"] < 13 and not CODE_RE.search(l["t"]) and not SKIP_RE.match(l["t"]) and "Largo" not in l["t"]]
        base = None
        if meas:
            m0 = meas[0]
            if len(m0["t"]) < 10 or m0["t"][:1].islower():
                ups = [u for u in lines if 0 <= m0["b"][1] - u["b"][3] < 45 and abs(u["b"][0] - m0["b"][0]) < 10 and not SKIP_RE.match(u["t"])]
                if ups:
                    base = max(ups, key=lambda u: u["b"][3])["t"] + " " + m0["t"]
            base = base or m0["t"]
        for c in page_names:
            p = products[c]
            raw = p["name"].replace(" - Repuesto", "")
            if p["kind"] == "regular" and shade_like(raw) and " - " not in raw:
                if base:
                    p["name"] = f"{base} - {p['name']}"
                if not p["price"] and main_price:
                    p["price"] = money2(main_price["t"].replace("A $", "$"))
                    p["src"] = "pagina"
                    p["before"] = p["before"] or mp_before
            page_names_b = {c: products[c]["bbox"] for c in page_names}
    res = [products[c] for c in order]
    for p in res:
        n = re.sub(r"\s*Producto vegano\.?", "", p["name"])
        n = re.sub(r"^\d{5,6} \)\s*", "", n)
        p["name"] = re.sub(r"\s+", " ", n).strip(" -")
    # tonos de la misma página sin precio: usar el precio más común de sus hermanos
    from collections import Counter
    bypage = {}
    for p in res:
        bypage.setdefault((p["page"], p["name"].endswith("Repuesto")), []).append(p)
    for grp in bypage.values():
        prices = Counter(p["price"] for p in grp if p["price"])
        if prices:
            common = prices.most_common(1)[0][0]
            for p in grp:
                if not p["price"] and " - " in p["name"]:
                    p["price"] = common
                    p["src"] = "hermano"
    # completar precios faltantes con hermanos (mismo producto base y tipo en la misma página)
    def key(p):
        base = p["name"].split(" - ")[0]
        return (p["page"], base, p["name"].endswith("Repuesto"))
    known = {}
    for p in res:
        if p["price"]:
            known.setdefault(key(p), p["price"])
    for p in res:
        if not p["price"] and key(p) in known and " - " in p["name"]:
            p["price"] = known[key(p)]
            p["src"] = "hermano"
    json.dump(res, open(OUT, "w"), ensure_ascii=False, indent=1)
    print(len(res), "productos")


main()
