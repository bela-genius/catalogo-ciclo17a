// Capa de datos de pedidos.
// - Con DATABASE_URL (p. ej. Neon / Render Postgres) usa PostgreSQL.
// - Sin DATABASE_URL usa un archivo JSON local (solo para probar en tu computador).
const fs = require("fs");
const path = require("path");

const STATUSES = ["pendiente", "verificado", "enviado_natura", "cancelado"];

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return "PED-" + s;
}

// ---------- PostgreSQL ----------
function pgStore(url) {
  const { Pool } = require("pg");
  const pool = new Pool({
    connectionString: url,
    ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
  });

  const rowToOrder = (r) => ({
    id: r.id,
    code: r.code,
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    notes: r.notes,
    items: r.items,
    total: Number(r.total),
    status: r.status,
    createdAt: r.created_at,
    verifiedAt: r.verified_at,
    verifiedBy: r.verified_by,
    sentAt: r.sent_at,
  });

  return {
    async init() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS orders (
          id SERIAL PRIMARY KEY,
          code TEXT UNIQUE NOT NULL,
          customer_name TEXT NOT NULL,
          customer_phone TEXT,
          notes TEXT,
          items JSONB NOT NULL,
          total INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'pendiente',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          verified_at TIMESTAMPTZ,
          verified_by TEXT,
          sent_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status);
      `);
    },
    async create(o) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = makeCode();
        try {
          const { rows } = await pool.query(
            `INSERT INTO orders (code, customer_name, customer_phone, notes, items, total)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [code, o.customerName, o.customerPhone, o.notes, JSON.stringify(o.items), o.total]
          );
          return rowToOrder(rows[0]);
        } catch (e) {
          if (e.code !== "23505") throw e; // código repetido -> reintentar
        }
      }
      throw new Error("No se pudo generar un código de pedido único");
    },
    async list(statuses) {
      const ph = statuses.map((_, i) => "$" + (i + 1)).join(",");
      const { rows } = await pool.query(
        `SELECT * FROM orders WHERE status IN (${ph}) ORDER BY created_at DESC LIMIT 500`,
        statuses
      );
      return rows.map(rowToOrder);
    },
    async get(code) {
      const { rows } = await pool.query(`SELECT * FROM orders WHERE code = $1`, [code]);
      return rows[0] ? rowToOrder(rows[0]) : null;
    },
    async setStatus(code, status, by) {
      const sets = ["status = $2"];
      if (status === "verificado") sets.push("verified_at = now()", "verified_by = $3");
      if (status === "enviado_natura") sets.push("sent_at = now()");
      const { rows } = await pool.query(
        `UPDATE orders SET ${sets.join(", ")} WHERE code = $1 RETURNING *`,
        status === "verificado" ? [code, status, by || null] : [code, status]
      );
      return rows[0] ? rowToOrder(rows[0]) : null;
    },
  };
}

// ---------- Archivo JSON (desarrollo) ----------
function fileStore(file) {
  let data = { orders: [] };
  const save = () => fs.writeFileSync(file, JSON.stringify(data, null, 1));
  return {
    async init() {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (fs.existsSync(file)) data = JSON.parse(fs.readFileSync(file, "utf8"));
      else save();
    },
    async create(o) {
      let code;
      do code = makeCode();
      while (data.orders.some((x) => x.code === code));
      const order = {
        id: data.orders.length + 1,
        code,
        ...o,
        status: "pendiente",
        createdAt: new Date().toISOString(),
        verifiedAt: null,
        verifiedBy: null,
        sentAt: null,
      };
      data.orders.push(order);
      save();
      return order;
    },
    async list(statuses) {
      return data.orders.filter((o) => statuses.includes(o.status)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
    async get(code) {
      return data.orders.find((o) => o.code === code) || null;
    },
    async setStatus(code, status, by) {
      const o = data.orders.find((x) => x.code === code);
      if (!o) return null;
      o.status = status;
      if (status === "verificado") {
        o.verifiedAt = new Date().toISOString();
        o.verifiedBy = by || null;
      }
      if (status === "enviado_natura") o.sentAt = new Date().toISOString();
      save();
      return o;
    },
  };
}

module.exports = {
  STATUSES,
  createStore() {
    if (process.env.DATABASE_URL) return pgStore(process.env.DATABASE_URL);
    console.warn("⚠️  Sin DATABASE_URL: los pedidos se guardan en data/orders.local.json (solo para pruebas).");
    return fileStore(path.join(__dirname, "data", "orders.local.json"));
  },
};
