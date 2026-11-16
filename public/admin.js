(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => (n == null ? "a confirmar" : "$ " + Number(n).toLocaleString("es-CO"));
  const date = (d) => (d ? new Date(d).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }) : "");
  const STATUS = { pendiente: "Pendiente", verificado: "Verificado", enviado_natura: "Enviado a Natura", cancelado: "Cancelado" };
  let role = null, tab = "pendiente", orders = [];

  async function api(url, opts = {}) {
    const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
    if (r.status === 401) { showLogin(); throw new Error("Sesión cerrada"); }
    const out = await r.json();
    if (!r.ok) throw new Error(out.error || "Error");
    return out;
  }
  function showLogin() { $("#login").hidden = false; $("#app").hidden = true; }
  function showApp() {
    $("#login").hidden = true; $("#app").hidden = false;
    $("#roleLabel").textContent = role === "manager" ? "Manager · acceso completo" : "Atención · solo pedidos por verificar";
    document.querySelectorAll("[data-mgr]").forEach((b) => (b.hidden = role !== "manager"));
    load();
  }

  function waLink(phone) {
    let d = String(phone || "").replace(/\D/g, "");
    if (d.length === 10) d = "57" + d;
    return d ? `https://wa.me/${d}` : null;
  }

  function orderHTML(o) {
    const wa = waLink(o.customerPhone);
    const unknown = o.items.some((i) => i.price == null);
    let actions = "";
    if (o.status === "pendiente") actions = `<button class="btn ok" data-verify="${o.code}">✓ El cliente aceptó · Verificar</button><button class="btn warn" data-status="cancelado" data-code="${o.code}">Cancelar</button>`;
    if (role === "manager" && o.status === "verificado") actions = `<button class="btn" data-status="enviado_natura" data-code="${o.code}">Marcar enviado a Natura</button><button class="btn warn" data-status="cancelado" data-code="${o.code}">Cancelar</button>`;
    if (role === "manager" && (o.status === "cancelado" || o.status === "enviado_natura")) actions = `<button class="btn ghost" data-status="verificado" data-code="${o.code}">Volver a verificados</button>`;
    return `<article class="order">
      <header><div><span class="code">${esc(o.code)}</span> <span class="status ${o.status}">${STATUS[o.status]}</span></div>
        <span class="muted">${date(o.createdAt)}</span></header>
      <p><b>${esc(o.customerName)}</b>${o.customerPhone ? ` · ${esc(o.customerPhone)}` : ""}${wa ? ` · <a href="${wa}" target="_blank" rel="noopener">Abrir chat</a>` : ""}</p>
      <table><thead><tr><th>Código</th><th>Producto</th><th class="num">Cant.</th><th class="num">Subtotal</th></tr></thead><tbody>
      ${o.items.map((i) => `<tr><td>${esc(i.code)}</td><td>${esc(i.name)} <span class="muted">(pág. ${i.page})</span></td><td class="num">${i.qty}</td><td class="num">${i.price == null ? "a confirmar" : money(i.price * i.qty)}</td></tr>`).join("")}
      <tr><td></td><td><b>Total aproximado</b></td><td></td><td class="num"><b>${money(o.total)}</b>${unknown ? " +" : ""}</td></tr></tbody></table>
      ${o.notes ? `<p><b>Notas:</b> ${esc(o.notes)}</p>` : ""}
      ${o.verifiedAt ? `<p class="muted">Verificado el ${date(o.verifiedAt)}</p>` : ""}
      <div class="actions">${actions}</div>
    </article>`;
  }

  function renderOrders() {
    const q = $("#find").value.trim().toLowerCase();
    const list = orders.filter((o) => !q || o.code.toLowerCase().includes(q) || o.customerName.toLowerCase().includes(q) || (o.customerPhone || "").includes(q));
    const help = tab === "pendiente"
      ? `<p class="help">Cuando llegue un pedido por WhatsApp, pregúntale al cliente si quiere verificarlo. Si acepta, busca su código aquí y toca <b>Verificar</b>: el pedido pasa a la base de datos del manager.</p>`
      : "";
    $("#content").innerHTML = help + (list.length ? list.map(orderHTML).join("") : `<div class="empty">No hay pedidos aquí.</div>`);
  }

  async function renderConsolidado() {
    const c = await api("/api/admin/consolidado");
    $("#content").innerHTML = `<p class="help">Suma de todos los pedidos <b>verificados</b> (${c.orders}). Usa esta lista para montar el pedido en Natura; cuando lo hayas hecho, márcalos como enviados.</p>
      ${c.rows.length ? `<table class="cons"><thead><tr><th>Código</th><th>Producto</th><th class="num">Cantidad</th><th class="num">Precio</th><th class="num">Subtotal</th><th>Pedidos</th></tr></thead><tbody>
      ${c.rows.map((r) => `<tr><td><b>${esc(r.code)}</b></td><td>${esc(r.name)}</td><td class="num"><b>${r.qty}</b></td><td class="num">${money(r.price)}</td><td class="num">${r.price == null ? "—" : money(r.price * r.qty)}</td><td class="muted">${[...new Set(r.orders)].join(", ")}</td></tr>`).join("")}
      <tr><td></td><td><b>Total</b></td><td></td><td></td><td class="num"><b>${money(c.total)}</b></td><td></td></tr></tbody></table>` : `<div class="empty">No hay pedidos verificados pendientes de enviar.</div>`}`;
    $("#tools").innerHTML = c.rows.length
      ? `<button class="btn ghost" id="copyCons">Copiar lista</button><button class="btn" id="sendAll">Marcar todos como enviados a Natura</button>`
      : "";
    if (c.rows.length) {
      $("#copyCons").onclick = () => {
        navigator.clipboard.writeText(c.rows.map((r) => `${r.code}\t${r.qty}\t${r.name}`).join("\n"));
        $("#copyCons").textContent = "¡Copiado!";
      };
      $("#sendAll").onclick = async () => {
        if (!confirm(`¿Marcar los ${c.orders} pedidos verificados como enviados a Natura?`)) return;
        const vs = await api("/api/admin/orders?status=verificado");
        for (const o of vs) await api(`/api/admin/orders/${o.code}/status`, { method: "POST", body: JSON.stringify({ status: "enviado_natura" }) });
        renderConsolidado();
      };
    }
  }

  async function load() {
    $("#find").hidden = tab === "consolidado";
    $("#tools").innerHTML = "";
    $("#content").innerHTML = `<p class="muted">Cargando…</p>`;
    try {
      if (tab === "consolidado") return renderConsolidado();
      const status = tab === "historial" ? "enviado_natura,cancelado" : tab;
      orders = await api(`/api/admin/orders?status=${status}`);
      if (role === "manager" && tab !== "pendiente")
        $("#tools").innerHTML = `<a class="btn ghost" href="/api/admin/export.csv?status=${status}" style="text-decoration:none">Descargar Excel (CSV)</a>`;
      renderOrders();
    } catch (e) {
      $("#content").innerHTML = `<p class="error">${esc(e.message)}</p>`;
    }
  }

  document.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    try {
      if (b.dataset.tab) {
        tab = b.dataset.tab;
        document.querySelectorAll("#tabs .tab").forEach((t) => t.classList.toggle("active", t === b));
        load();
      } else if (b.dataset.verify) {
        b.disabled = true;
        await api(`/api/admin/orders/${b.dataset.verify}/verify`, { method: "POST" });
        load();
      } else if (b.dataset.status) {
        if (b.dataset.status === "cancelado" && !confirm(`¿Cancelar el pedido ${b.dataset.code}?`)) return;
        b.disabled = true;
        await api(`/api/admin/orders/${b.dataset.code}/status`, { method: "POST", body: JSON.stringify({ status: b.dataset.status }) });
        load();
      }
    } catch (err) {
      alert(err.message);
      b.disabled = false;
    }
  });
  $("#find").addEventListener("input", renderOrders);
  $("#logout").addEventListener("click", async () => { await fetch("/api/admin/logout", { method: "POST" }); showLogin(); });
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const r = await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: $("#pw").value }) });
      const out = await r.json();
      if (!r.ok) throw new Error(out.error);
      role = out.role; $("#pw").value = ""; showApp();
    } catch (err) { $("#loginErr").textContent = err.message; $("#loginErr").hidden = false; }
  });

  fetch("/api/admin/me").then((r) => (r.ok ? r.json() : null)).then((me) => { if (me) { role = me.role; showApp(); } else showLogin(); });
  setInterval(() => { if (!$("#app").hidden && tab === "pendiente" && !$("#find").value) load(); }, 60000);
})();
