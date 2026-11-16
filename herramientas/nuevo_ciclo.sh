#!/usr/bin/env bash
# Uso: bash herramientas/nuevo_ciclo.sh ruta/a/la/revista.pdf
# Requiere: pip install pymupdf pillow
set -e
PDF="$1"
TMP=$(mktemp -d)
python3 herramientas/extract.py "$PDF" "$TMP/products.json"
python3 herramientas/render.py "$PDF" "$TMP/products.json" "$TMP/out"
python3 - "$PDF" "$TMP/out/pages" <<'PY'
import sys, pymupdf as fitz
d = fitz.open(sys.argv[1])
for i in range(len(d)):
    d[i].get_pixmap(dpi=40).pil_save(f"{sys.argv[2]}/s{i+1:03d}.jpg", quality=70, optimize=True)
PY
rm -f public/revista/*.jpg
cp "$TMP"/out/pages/*.jpg public/revista/
python3 herramientas/aplicar_correcciones.py "$TMP/out/products.json" data/products.json
echo "Ojo: herramientas/correcciones.json es del ciclo anterior; vacíalo ({}) para un ciclo nuevo y vuelve a revisar."
echo "Listo: revisa data/products.json y cambia CYCLE_NAME en las variables de entorno."
