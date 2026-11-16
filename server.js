require("./load-env");
const express = require("express");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { createStore, STATUSES } = require("./db");

// ---------------- Configuración ----------------
const PORT = process.env.PORT || 3000;
const STORE_NAME = process.env.STORE_NAME || "Mi catálogo Ciclo 17A";
const WHATSAPP_NUMBER = (process.env.WHATSAPP_NUMBER || "573148616132").replace(/\D/g, "");
const MANAGER_PASSWORD = process.env.MANAGER_PASSWORD || "";
const ATTENDANT_PASSWORD = process.env.ATTENDANT_PASSWORD || "";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";
const CYCLE = process.env.CYCLE_NAME || "Ciclo 17A";

if (!MANAGER_PASSWORD) console.warn("⚠️  Falta MANAGER_PASSWORD: el panel del manager no tendrá acceso hasta que la configures.");
if (!process.env.SESSION_SECRET) console.warn("⚠️  Falta SESSION_SECRET: las sesiones se cerrarán cada vez que reinicie el servidor.");

const products = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "products.json"), "utf8"));
const byCode = new Map(products.map((p) => [p.code, p]));
const PAGES = fs.readdirSync(path.join(__dirname, "public", "revista")).filter((f) => /^p\d+\.jpg$/.test(f)).length;
const store = createStore();

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "200kb" }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));

const money = (n) => (n == null ? "precio a confirmar" : "$ " + Number(n).toLocaleString("es-CO"));

// ---------------- Sesiones (cookie firmada) ----------------
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return body + "." + mac;
}
function verify(token) {
  if (!token || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  const data = JSON.parse(Buffer.from(body, "base64url").toString());
  if (data.exp < Date.now()) return null;
  return data;
}
function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  const m = raw.split(/;\s*/).find((c) => c.startsWith(name + "="));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
function requireRole(...roles) {
  return (req, res, next) => {
    const s = verify(readCookie(req, "sesion"));
    if (!s || !roles.includes(s.role)) return res.status(401).json({ error: "No autorizado" });
    req.session = s;
    next();
  };
}

// Límite simple de intentos por IP
const hits = new Map();
function rateLimit(key, max, windowMs) {
  return (req, res, next) => {
    const k = key + ":" + (req.headers["x-forwarded-for"] || req.ip || "").split(",")[0];
    const now = Date.now();
    const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: "Demasiadas solicitudes, intenta en un momento." });
    arr.push(now);
    hits.set(k, arr);
    next();
  };
}

// ---------------- API pública ----------------
app.get("/api/config", (req, res) => {
  res.json({
    storeName: STORE_NAME,
    cycle: CYCLE,
    whatsapp: WHATSAPP_NUMBER,
    pages: PAGES,
    assistantAI: Boolean(process.env.ANTHROPIC_API_KEY),
  });
});

app.get("/api/products", (req, res) => {
  res.set("Cache-Control", "public, max-age=600");
  res.json(products);
});

app.post("/api/orders", rateLimit("orders", 10, 60 * 60 * 1000), async (req, res) => {
  try {
    const { customerName, customerPhone, notes, items } = req.body || {};
    const name = String(customerName || "").trim().slice(0, 80);
    const phone = String(customerPhone || "").replace(/[^\d+ ]/g, "").slice(0, 20);
    if (!name) return res.status(400).json({ error: "Escribe tu nombre." });
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "El carrito está vacío." });

    // Los nombres y precios se toman del catálogo del servidor, no del navegador.
    const clean = [];
    for (const it of items.slice(0, 100)) {
      const p = byCode.get(String(it.code));
      const qty = Math.max(1, Math.min(99, parseInt(it.qty, 10) || 1));
      if (!p) continue;
      clean.push({ code: p.code, name: p.name, price: p.price, qty, page: p.page });
    }
    if (!clean.length) return res.status(400).json({ error: "Ningún producto del carrito es válido." });
    const total = clean.reduce((s, it) => s + (it.price || 0) * it.qty, 0);
    const pending = clean.some((it) => it.price == null);

    const order = await store.create({
      customerName: name,
      customerPhone: phone,
      notes: String(notes || "").trim().slice(0, 500),
      items: clean,
      total,
    });

    const lines = clean.map(
      (it, i) => `${i + 1}. ${it.qty} × ${it.name} (cód. ${it.code}) — ${money(it.price == null ? null : it.price * it.qty)}`
    );
    const msg = [
      `Hola 👋 Quiero hacer mi pedido de la revista ${CYCLE}.`,
      ``,
      `🧾 Pedido: *${order.code}*`,
      `👤 Nombre: ${name}`,
      phone ? `📱 Celular: ${phone}` : null,
      ``,
      ...lines,
      ``,
      `💰 Total aproximado: *${money(total)}*${pending ? " (+ productos con precio a confirmar)" : ""}`,
      order.notes ? `📝 Notas: ${order.notes}` : null,
    ]
      .filter((l) => l !== null)
      .join("\n");

    res.json({
      code: order.code,
      message: msg,
      whatsappUrl: `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "No se pudo registrar el pedido. Intenta de nuevo." });
  }
});

// ---------------- Asistente de búsqueda ----------------
const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

const STOP = new Set("de la el los las un una unos unas para con por que y o a en mi me mis su sus quiero busco algo tienes hay del al como mas muy sea es menos hasta mil pesos maximo regalo regalar".split(" "));
const SYN = {
  perfume: ["eau de", "parfum", "colonia", "perfume", "fragancia"],
  fragancia: ["eau de", "parfum", "colonia", "perfume"],
  hombre: ["masculino", "homem", "hombre", "barba"],
  mujer: ["femenino", "mujer"],
  mama: ["femenino", "mujer", "mama"],
  pelo: ["cabello", "shampoo", "acondicionador", "capilar"],
  cabello: ["cabello", "shampoo", "acondicionador", "capilar"],
  labios: ["labial", "labios", "gloss", "boca"],
  pestanas: ["pestanina", "pestanas"],
  grasa: ["oleosidad", "antioleosidad", "grasa", "mixta"],
  arrugas: ["arrugas", "antisenales", "firmeza", "chronos"],
  nino: ["nature", "infantil", "ninos"],
  bebe: ["bebe", "mama y bebe"],
  piel: ["piel", "corporal", "hidratante"],
};
function localSearch(q, limit = 12) {
  const nq = norm(q);
  let maxPrice = null;
  const m = nq.match(/(menos de|hasta|maximo|max|no mas de)\s*\$?\s*([\d.]+)\s*(mil|k)?/);
  if (m) {
    maxPrice = parseInt(m[2].replace(/\./g, ""), 10);
    if (m[3] || maxPrice < 1000) maxPrice *= 1000;
  }
  const words = nq.replace(/(menos de|hasta|maximo|max|no mas de)\s*\$?\s*[\d.]+\s*(mil|k)?/, " ")
    .split(/[^a-z0-9ñ]+/).filter((w) => w.length > 2 && !STOP.has(w));
  const wantMale = words.includes("hombre") || words.includes("masculino");
  const wantFemale = words.some((w) => ["mujer", "femenino", "mama"].includes(w));
  const scored = products
    .map((p) => {
      const hay = norm(`${p.name} ${p.title} ${p.section} ${p.code} ${(p.detail || []).join(" ")}`);
      let s = 0;
      for (const w of words) {
        const alts = SYN[w] || [w.replace(/s$/, "")];
        if (alts.some((a) => hay.includes(a))) s += w.length > 4 ? 2 : 1;
      }
      if (wantMale && hay.includes("femenino")) s = 0;
      if (wantFemale && (hay.includes("masculino") || hay.includes("homem"))) s = 0;
      if (maxPrice && (p.price == null || p.price > maxPrice)) s = 0;
      if (!words.length && maxPrice && p.price && p.price <= maxPrice) s = 1;
      return { p, s };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || (b.p.promo ? 1 : 0) - (a.p.promo ? 1 : 0));
  return scored.slice(0, limit).map((x) => x.p.code);
}

let anthropic = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!anthropic) {
    const Anthropic = require("@anthropic-ai/sdk");
    anthropic = new (Anthropic.default || Anthropic)({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropic;
}
const catalogText = products
  .map((p) => `${p.code}|${p.name}|${p.price ?? "?"}|${p.before ?? ""}|${p.section}|p${p.page}${p.promo ? "|oferta" : ""}`)
  .join("\n");
const SYSTEM = `Eres el asistente de compras de un catálogo de belleza (revista ${CYCLE}). Ayudas a los clientes a encontrar productos: por tipo, para quién es (regalo para mamá, para hombre, para niños), presupuesto, tipo de piel o cabello, aroma, tono, ocasión.

Reglas:
- Solo recomiendas productos que estén en el CATÁLOGO de abajo. Nunca inventes productos, códigos ni precios.
- Responde en español, cálido y breve (máximo 3 o 4 frases). Si hace falta un dato para recomendar mejor (presupuesto, tono, tipo de piel), haz UNA pregunta.
- Los precios están en pesos colombianos. Un precio "?" significa que se confirma por WhatsApp.
- Devuelve SIEMPRE un JSON válido y nada más, con esta forma:
{"respuesta": "texto para el cliente", "codigos": ["código1", "código2"]}
- "codigos": de 0 a 12 códigos del catálogo, ordenados del más al menos recomendado.

CATÁLOGO (código|nombre|precio|precio antes|sección|página|oferta):
${catalogText}`;

app.post("/api/assistant", rateLimit("ai", 30, 10 * 60 * 1000), async (req, res) => {
  const msgs = Array.isArray(req.body?.messages) ? req.body.messages.slice(-10) : [];
  const last = msgs.filter((m) => m.role === "user").pop();
  if (!last) return res.status(400).json({ error: "Escribe qué buscas." });

  const client = getClient();
  if (!client) {
    const codes = localSearch(last.content);
    return res.json({
      reply: codes.length
        ? "Encontré estos productos que coinciden con lo que escribiste:"
        : "No encontré coincidencias. Prueba con otras palabras, por ejemplo «perfume para hombre» o «shampoo anticaspa».",
      codes,
      mode: "local",
    });
  }
  try {
    const r = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 700,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: msgs.map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content || "").slice(0, 1500),
      })),
    });
    const text = r.content.map((c) => c.text || "").join("");
    let out;
    try {
      out = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    } catch {
      out = { respuesta: text, codigos: [] };
    }
    const codes = (out.codigos || []).map(String).filter((c) => byCode.has(c)).slice(0, 12);
    res.json({ reply: out.respuesta || "", codes, mode: "ai" });
  } catch (e) {
    console.error("Error del asistente:", e.message);
    res.json({ reply: "El asistente no está disponible ahora; te muestro coincidencias directas:", codes: localSearch(last.content), mode: "local" });
  }
});

// ---------------- Panel (manager / atención) ----------------
app.post("/api/admin/login", rateLimit("login", 8, 15 * 60 * 1000), (req, res) => {
  const pw = String(req.body?.password || "");
  let role = null;
  if (MANAGER_PASSWORD && safeEqual(pw, MANAGER_PASSWORD)) role = "manager";
  else if (ATTENDANT_PASSWORD && safeEqual(pw, ATTENDANT_PASSWORD)) role = "atencion";
  if (!role) return res.status(401).json({ error: "Contraseña incorrecta" });
  const token = sign({ role, exp: Date.now() + 12 * 3600 * 1000 });
  const secure = req.secure || req.headers["x-forwarded-proto"] === "https";
  res.setHeader("Set-Cookie", `sesion=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${12 * 3600}${secure ? "; Secure" : ""}`);
  res.json({ role });
});
app.post("/api/admin/logout", (req, res) => {
  res.setHeader("Set-Cookie", "sesion=; HttpOnly; Path=/; Max-Age=0");
  res.json({ ok: true });
});
app.get("/api/admin/me", requireRole("manager", "atencion"), (req, res) => res.json({ role: req.session.role }));

// Atención: solo ve pedidos pendientes y puede verificarlos o cancelarlos.
app.get("/api/admin/orders", requireRole("manager", "atencion"), async (req, res) => {
  let statuses = String(req.query.status || "pendiente").split(",").filter((s) => STATUSES.includes(s));
  if (req.session.role !== "manager") statuses = ["pendiente"];
  if (!statuses.length) statuses = ["pendiente"];
  res.json(await store.list(statuses));
});

app.post("/api/admin/orders/:code/verify", requireRole("manager", "atencion"), async (req, res) => {
  const o = await store.get(req.params.code.toUpperCase());
  if (!o) return res.status(404).json({ error: "Pedido no encontrado" });
  if (o.status !== "pendiente") return res.status(409).json({ error: `El pedido ya está ${o.status}` });
  res.json(await store.setStatus(o.code, "verificado", req.session.role));
});

app.post("/api/admin/orders/:code/status", requireRole("manager", "atencion"), async (req, res) => {
  const status = String(req.body?.status || "");
  if (!STATUSES.includes(status)) return res.status(400).json({ error: "Estado inválido" });
  if (req.session.role !== "manager" && status !== "cancelado") return res.status(403).json({ error: "Solo el manager puede hacer esto" });
  const o = await store.get(req.params.code.toUpperCase());
  if (!o) return res.status(404).json({ error: "Pedido no encontrado" });
  if (req.session.role !== "manager" && o.status !== "pendiente") return res.status(403).json({ error: "Solo el manager puede hacer esto" });
  res.json(await store.setStatus(o.code, status, req.session.role));
});

// Consolidado para hacer el pedido a Natura (suma por código)
app.get("/api/admin/consolidado", requireRole("manager"), async (req, res) => {
  const orders = await store.list(["verificado"]);
  const map = new Map();
  for (const o of orders)
    for (const it of o.items) {
      const cur = map.get(it.code) || { code: it.code, name: it.name, price: it.price, qty: 0, orders: [] };
      cur.qty += it.qty;
      cur.orders.push(o.code);
      map.set(it.code, cur);
    }
  const rows = [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
  res.json({ orders: orders.length, rows, total: rows.reduce((s, r) => s + (r.price || 0) * r.qty, 0) });
});

app.get("/api/admin/export.csv", requireRole("manager"), async (req, res) => {
  const statuses = String(req.query.status || "verificado").split(",").filter((s) => STATUSES.includes(s));
  const orders = await store.list(statuses);
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [["pedido", "estado", "fecha", "cliente", "celular", "codigo", "producto", "cantidad", "precio_unitario", "subtotal", "notas"].join(",")];
  for (const o of orders)
    for (const it of o.items)
      lines.push(
        [o.code, o.status, new Date(o.createdAt).toISOString(), o.customerName, o.customerPhone, it.code, it.name, it.qty, it.price ?? "", it.price ? it.price * it.qty : "", o.notes]
          .map(esc)
          .join(",")
      );
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="pedidos-${statuses.join("-")}.csv"`);
  res.send("﻿" + lines.join("\n"));
});

app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));

store
  .init()
  .then(() => app.listen(PORT, () => console.log(`✅ Catálogo en http://localhost:${PORT}  ·  Panel: /admin`)))
  .catch((e) => {
    console.error("No se pudo iniciar la base de datos:", e);
    process.exit(1);
  });
