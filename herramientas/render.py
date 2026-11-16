import json, sys, os
import pymupdf as fitz
PDF, PRODUCTS, OUTDIR = sys.argv[1:4]
doc = fitz.open(PDF)
os.makedirs(f"{OUTDIR}/pages", exist_ok=True)
os.makedirs(f"{OUTDIR}/thumbs", exist_ok=True)
prods = json.load(open(PRODUCTS))

def section(page, name):
    n = name.lower()
    if 51 <= page <= 71: return "Perfumería"
    if 74 <= page <= 95: return "Maquillaje"
    if 98 <= page <= 119: return "Rostro"
    if 121 <= page <= 132: return "Cuerpo"
    if 146 <= page <= 169: return "Cabello"
    if 170 <= page <= 172: return "Niños y bebés"
    if page >= 173: return "Creer para Ver"
    # páginas de ofertas: clasificar por palabras
    kw = [("Perfumería", ["eau de", "perfum", "colonia", "body splash", "bodysplash", "kaiak", "ilía", "essencial", "luna", "homem", "humor", "aura", "kriska"]),
          ("Maquillaje", ["labial", "base", "corrector", "pestañina", "máscara", "delineador", "sombra", "rubor", "polvo", "una ", "gloss"]),
          ("Cabello", ["shampoo", "acondicionador", "cabello", "capilar", "murumuru", "lumina"]),
          ("Rostro", ["sérum", "chronos", "facial", "rostro", "micelar", "faces"]),
          ("Cuerpo", ["jabón", "jabones", "corporal", "manos", "pulpa", "crema", "desodorante", "tododia", "aceite", "exfoliante"]),
          ("Creer para Ver", ["creer para ver", "bolso", "porta", "cartuchera", "set natura by"])]
    for sec, words in kw:
        if any(w in n for w in words): return sec
    return "Regalos y otros"

pages = sorted(set(p["page"] for p in prods))
for i in range(len(doc)):
    pix = doc[i].get_pixmap(dpi=110)
    pix.pil_save(f"{OUTDIR}/pages/p{i+1:03d}.jpg", quality=72, optimize=True)

by_page = {}
for p in prods:
    by_page.setdefault(p["page"], []).append(p)
for pg, items in by_page.items():
    page = doc[pg - 1]
    W, H = page.rect.width, page.rect.height
    for p in items:
        x0, y0, x1, y1 = p["bbox"]
        if p["kind"] == "oferta" or len(items) <= 2:
            clip = page.rect
        else:
            clip = fitz.Rect(max(0, x0 - 35), max(0, y0 - 190), min(W, x0 + 135), min(H, y0 + 45))
        pix = page.get_pixmap(dpi=130, clip=clip)
        pix.pil_save(f"{OUTDIR}/thumbs/{p['code']}.jpg", quality=72, optimize=True)
        p["section"] = section(pg, p["name"] + " " + p["title"])
        p["promo"] = pg <= 46
        p.pop("bbox", None)
json.dump(prods, open(f"{OUTDIR}/products.json", "w"), ensure_ascii=False)
print("ok", len(prods), "pages", len(doc))
