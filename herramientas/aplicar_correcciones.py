"""Aplica herramientas/correcciones.json sobre un products.json extraído.
Uso: python3 aplicar_correcciones.py entrada.json salida.json
- "codigo": {campos}            -> corrige ese producto (o lo crea si trae "new": true)
- "page:N": {prefix, price,...} -> valores por defecto para los productos de la página N
                                   que no tengan corrección propia
"""
import json, os, sys

src, dst = sys.argv[1], sys.argv[2]
here = os.path.dirname(os.path.abspath(__file__))
fixes = json.load(open(os.path.join(here, "correcciones.json")))
prods = json.load(open(src))
by = {p["code"]: p for p in prods}

for key, f in fixes.items():
    if not key.startswith("page:"):
        continue
    pg = int(key[5:])
    for p in prods:
        if p["page"] != pg or p["code"] in fixes:
            continue
        if "prefix" in f:
            p["name"] = f["prefix"] + p["name"].split(" - ")[-1]
        for k in ("price", "before", "pts"):
            if k in f:
                p[k] = f[k]
        p["verificado"] = True

for code, f in fixes.items():
    if code.startswith("page:"):
        continue
    f = dict(f)
    if f.pop("new", False) and code not in by:
        p = {"code": code, "name": "", "price": None, "before": None, "pts": None,
             "page": f.get("page"), "title": "", "kind": "regular", "detail": [],
             "section": f.get("section", "Regalos y otros"), "promo": f.get("page", 99) <= 46}
        prods.append(p)
        by[code] = p
    p = by.get(code)
    if not p:
        print("aviso: código sin producto", code)
        continue
    for k, v in f.items():
        if k in ("page",) and "page" in p:
            continue
        p[k] = v
    p["verificado"] = True

prods.sort(key=lambda p: (p["page"], p["code"]))
for p in prods:
    p.pop("src", None)
json.dump(prods, open(dst, "w"), ensure_ascii=False)
print(len(prods), "productos;", sum(1 for p in prods if p.get("verificado")), "verificados a mano")
