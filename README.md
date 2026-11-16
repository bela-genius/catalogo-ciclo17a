# Catálogo Ciclo 17A — pedidos por WhatsApp

Página web que muestra la revista como catálogo. Tiene:

- **Catálogo**: 883 productos sacados de la revista, con buscador (por nombre, tipo o código), filtros por sección y orden por precio o descuento.
- **Revista**: la revista página por página (175), con los productos de cada página listos para agregar al carrito.
- **Asistente ✦**: el cliente escribe lo que busca («regalo para mi mamá de menos de 100 mil», «algo para piel grasa») y recibe productos del catálogo que puede agregar al carrito.
  - Con `ANTHROPIC_API_KEY` usa IA (Claude).
  - Sin clave, busca por palabras clave (con sinónimos, filtro de precio y de hombre o mujer).
- **Carrito → «Quiero hacer mi pedido»**: guarda el pedido como *pendiente*, le asigna un código (`PED-XXXXX`) y abre WhatsApp hacia **314 861 6132** con la lista de productos.
- **Panel `/admin`** (con contraseña):
  - **Atención** (`ATTENDANT_PASSWORD`): solo ve los pedidos pendientes. Cuando el cliente acepta verificar, toca **Verificar** y el pedido pasa a la base de datos.
  - **Manager** (`MANAGER_PASSWORD`): ve la base de datos de pedidos verificados. En **Pedido a Natura** está la suma por código de todos los pedidos verificados, que puede copiar o descargar en CSV. Después marca los pedidos como *enviados a Natura*.

## Flujo

```
Cliente: carrito → "Quiero hacer mi pedido"
   └─> pedido PENDIENTE (PED-XXXXX) + mensaje de WhatsApp al 314 861 6132
Atención (WhatsApp): "¿Quieres verificar tu pedido?"
   └─ si acepta → /admin → busca PED-XXXXX → Verificar → pasa a la BASE DE DATOS
Manager: /admin → "Pedido a Natura" → consolidado por código → hace el pedido → "Marcar enviados"
```

Los nombres y precios del pedido se toman siempre del catálogo del servidor, así que nadie puede cambiarlos desde el navegador.

## Probar en tu computador

```bash
npm install
cp .env.example .env      # y pon tus contraseñas
npm start                 # http://localhost:3000   ·   panel: http://localhost:3000/admin
```

Si no hay `DATABASE_URL`, los pedidos se guardan en `data/orders.local.json`, que sirve **solo para pruebas**.

## Publicar (Render + Neon)

1. Crea una base de datos en **Neon** y copia la *connection string* (`postgresql://...`). La tabla `orders` se crea sola la primera vez.
2. Sube esta carpeta a un repositorio de GitHub.
3. En **Render**: New → Web Service → elige el repo. Build `npm install`, Start `npm start`. También puedes usar *Blueprint* con `render.yaml`.
4. En **Environment**, configura:
   - `DATABASE_URL`: la de Neon.
   - `MANAGER_PASSWORD`: una contraseña fuerte.
   - `ATTENDANT_PASSWORD`: opcional.
   - `SESSION_SECRET`: un texto largo y aleatorio.
   - `STORE_NAME`.
   - `ANTHROPIC_API_KEY`: opcional, para el asistente con IA. La sacas de console.anthropic.com. El modelo por defecto es `claude-haiku-5-5`, el más económico, y se cambia con `ANTHROPIC_MODEL`.

El asistente tiene un límite de 30 preguntas cada 10 minutos por persona, para cuidar el costo.

## Nuevo ciclo

Con la revista nueva en PDF:

```bash
pip install pymupdf pillow
bash herramientas/nuevo_ciclo.sh ruta/Ciclo_18.pdf
```

Después cambia `CYCLE_NAME` en Render.

## Importante sobre los datos

Los productos se extrajeron automáticamente del PDF. La revista tiene muchos diseños distintos, así que algunos nombres o precios pueden salir incompletos:

- 18 productos quedaron con «precio a confirmar».
- En las páginas de tonos o de repuestos, el precio se asigna por aproximación.

Por eso cada producto muestra su página de la revista y el mensaje dice «total aproximado». La verificación por WhatsApp es el control final. Si quieres corregir un producto a mano, edita `data/products.json`.

La página es de una **consultora independiente**. Las marcas e imágenes de la revista son de Natura. Usa el contenido según lo que permita tu acuerdo como consultora.
