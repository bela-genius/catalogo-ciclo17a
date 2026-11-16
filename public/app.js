(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const pad = (n) => String(n).padStart(3, "0");
  const money = (n) => "$ " + Number(n).toLocaleString("es-CO");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  let products = [];
  let byCode = new Map();
  let config = {};
  let section = "Todo";
  let shown = 48;
  let currentPage = 8;
  let totalPages = 175;
  const SECTIONS = ["Todo", "Ofertas", "Perfumería", "Maquillaje", "Rostro", "Cuerpo", "Cabello", "Niños y bebés", "Creer para Ver", "Regalos y otros"];

  // ---------- Carrito (guardado en este navegador) ----------
  const CART_KEY = "carrito-ciclo-17a";
  let cart = {};
  try { cart = JSON.parse(localStorage.getItem(CART_KEY) || "{}"); } catch { cart = {}; }
  const saveCart = () => { try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch {} renderCartCount(); };
  const cartQty = () => Object.values(cart).reduce((a, b) => a + b, 0);

  function addToCart(code, qty = 1) {
    cart[code] = (cart[code] || 0) + qty;
    saveCart();
    toast("Agregado al carrito ✓");
    refreshAddButtons(code);
  }
  function setQty(code, qty) {
    if (qty <= 0) delete cart[code];
    else cart[code] = Math.min(99, qty);
    saveCart();
    renderCart();
    refreshAddButtons(code);
  }
  function refreshAddButtons(code) {
    $$(`[data-add="${code}"]`).forEach((b) => {
      const q = cart[code];
      b.classList.toggle("in", !!q);
      b.textContent = q ? (b.dataset.label === "+" ? `${q} ✓` : `EN CARRITO (${q}) +1`) : b.dataset.label || "AGREGAR";
    });
  }
  function renderCartCount() { $("#cartCount").textContent = cartQty(); }

  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 1600);
  }

  // ---------- Precios ----------
  function priceHTML(p) {
    if (p.price == null) return `<div class="price"><span class="tbd">Precio a confirmar</span></div>`;
    const off = p.before && p.before > p.price ? `<s>${money(p.before)}</s>` : "";
    return `<div class="price"><b>${money(p.price)}</b>${off}</div>`;
  }
  const discount = (p) => (p.before && p.price ? Math.round((1 - p.price / p.before) * 100) : 0);

  // ---------- Búsqueda ----------
  const SYN = {
    perfume: ["eau", "parfum", "colonia", "fragancia", "toilette", "perfume"],
    fragancia: ["eau", "parfum", "colonia", "perfume"],
    hombre: ["masculino", "homem", "hombre"],
    mujer: ["femenino", "mujer"],
    pestanina: ["pestanina", "mascara para pestanas", "mascara extreme"],
    crema: ["crema", "pulpa", "hidratante", "manteca", "locion"],
    pelo: ["cabello", "shampoo", "acondicionador", "capilar"],
    cabello: ["cabello", "shampoo", "acondicionador", "capilar"],
    labios: ["labial", "boca", "gloss", "labios"],
    nino: ["nature", "infantil", "bebe", "mama"],
    bebe: ["bebe", "mama"],
    regalo: ["kit", "caja", "regalo", "set", "estuche"],
  };
  function matches(p, terms) {
    const hay = p._hay;
    return terms.every((t) => (SYN[t] || [t]).some((s) => hay.includes(s)));
  }
  function filtered() {
    const q = norm($("#q").value).trim();
    const terms = q.split(/\s+/).filter(Boolean);
    let list = products.filter((p) => {
      if (section === "Ofertas" && !(p.promo || discount(p) > 0)) return false;
      if (section !== "Todo" && section !== "Ofertas" && p.section !== section) return false;
      if (!terms.length) return true;
      if (/^\d{3,6}$/.test(q)) return p.code.includes(q);
      return matches(p, terms);
    });
    const s = $("#sort").value;
    const pv = (p) => (p.price == null ? Infinity : p.price);
    if (s === "price-asc") list = list.slice().sort((a, b) => pv(a) - pv(b));
    if (s === "price-desc") list = list.slice().sort((a, b) => (b.price || 0) - (a.price || 0));
    if (s === "discount") list = list.slice().sort((a, b) => discount(b) - discount(a));
    return list;
  }

  // ---------- Catálogo ----------
  function cardHTML(p) {
    const d = discount(p);
    return `<article class="card">
      <button class="thumb" data-detail="${p.code}" aria-label="Ver ${esc(p.name)}">
        <img loading="lazy" src="/revista/s${pad(p.page)}.jpg" alt="">
        ${d > 0 ? `<span class="badge">-${d}%</span>` : ""}
      </button>
      <div class="info">
        <div class="row">
          <p class="name">${esc(p.name)}</p>
          ${priceHTML(p)}
        </div>
        <span class="code">COD ${p.code}${p.pts ? ` · ${p.pts} PTS` : ""}</span>
        <button class="ghost" data-detail="${p.code}">VER EN REVISTA <span class="tag">PÁG ${p.page}</span></button>
        <button class="add" data-add="${p.code}" data-label="AGREGAR">AGREGAR</button>
      </div>
    </article>`;
  }
  function renderGrid() {
    const list = filtered();
    const q = $("#q").value.trim();
    $("#resultsInfo").textContent = `${list.length} producto${list.length === 1 ? "" : "s"}${q ? ` para «${q}»` : ""}${section !== "Todo" ? ` en ${section}` : ""}`;
    $("#grid").innerHTML = list.length
      ? list.slice(0, shown).map(cardHTML).join("")
      : `<div class="empty">No encontramos productos con esa búsqueda.<br>Prueba con el <b>asistente</b> ✦ o con otras palabras.</div>`;
    $("#more").hidden = list.length <= shown;
    list.slice(0, shown).forEach((p) => refreshAddButtons(p.code));
  }

  function renderChips() {
    $("#chips").innerHTML = SECTIONS.map((s) => `<button class="chip ${s === section ? "active" : ""}" data-sec="${s}">${s}</button>`).join("");
  }

  // ---------- Detalle ----------
  function openDetail(code) {
    const p = byCode.get(code);
    if (!p) return;
    $("#productDetail").innerHTML = `<div class="detail">
      <img src="/revista/p${pad(p.page)}.jpg" alt="Página ${p.page} de la revista">
      <div class="body">
        <span class="code">Código ${p.code} · ${esc(p.section)}${p.pts ? ` · ${p.pts} pts` : ""}</span>
        <h2>${esc(p.name)}</h2>
        ${priceHTML(p)}
        ${p.detail && p.detail.length ? `<ul>${p.detail.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : ""}
        <button class="add" data-add="${p.code}" data-label="AGREGAR AL CARRITO">AGREGAR AL CARRITO</button>
        <button class="linkish" data-gopage="${p.page}">Ver la página ${p.page} en la revista →</button>
        <p class="muted" style="font-size:12.5px">Busca en la imagen el código <b>${p.code}</b> para ver el producto exacto.</p>
      </div></div>`;
    refreshAddButtons(p.code);
    $("#productDialog").showModal();
  }

  // ---------- Revista ----------
  function showPage(n) {
    currentPage = Math.max(1, Math.min(totalPages, n));
    $("#pageImg").src = `/revista/p${pad(currentPage)}.jpg`;
    $("#pageNum").value = currentPage;
    const items = products.filter((p) => p.page === currentPage);
    $("#pageProducts").innerHTML = items.length
      ? items.map((p) => `<div class="mini"><div><div class="n">${esc(p.name)}</div><div class="c">${p.code} · ${p.price ? money(p.price) : "precio a confirmar"}</div></div><button data-add="${p.code}" data-label="+">+</button></div>`).join("")
      : `<p class="muted">Esta página no tiene productos para agregar.</p>`;
    items.forEach((p) => refreshAddButtons(p.code));
    $$("#strip img").forEach((im) => im.classList.toggle("cur", +im.dataset.p === currentPage));
    const cur = $(`#strip img[data-p="${currentPage}"]`);
    if (cur) cur.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }
  function setView(v) {
    $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === v));
    $("#view-catalogo").hidden = v !== "catalogo";
    $("#view-revista").hidden = v !== "revista";
    $("#hero").hidden = v !== "catalogo";
    $(".chips").style.visibility = $(".sort").style.visibility = v === "catalogo" ? "visible" : "hidden";
    if (v === "revista") {
      if (!$("#strip").childElementCount)
        $("#strip").innerHTML = Array.from({ length: totalPages }, (_, i) => `<img loading="lazy" data-p="${i + 1}" src="/revista/s${pad(i + 1)}.jpg" alt="Página ${i + 1}">`).join("");
      showPage(currentPage);
    }
    window.scrollTo({ top: 0 });
  }

  // ---------- Carrito (vista) ----------
  function openCart() {
    renderCart();
    $("#drawer").classList.add("open");
    $("#drawer").setAttribute("aria-hidden", "false");
    $("#overlay").hidden = false;
  }
  function closeCart() {
    $("#drawer").classList.remove("open");
    $("#drawer").setAttribute("aria-hidden", "true");
    $("#overlay").hidden = true;
  }
  function renderCart() {
    const codes = Object.keys(cart).filter((c) => byCode.has(c));
    if (!codes.length) {
      $("#cartBody").innerHTML = `<div class="empty">Tu carrito está vacío.<br>Agrega productos desde el catálogo o la revista.</div>`;
      return;
    }
    let total = 0, unknown = false;
    const rows = codes.map((c) => {
      const p = byCode.get(c), q = cart[c];
      if (p.price == null) unknown = true; else total += p.price * q;
      return `<div class="line">
        <img src="/revista/s${pad(p.page)}.jpg" alt="">
        <div><div class="n">${esc(p.name)}</div><div class="c">Cód. ${p.code} · ${p.price ? money(p.price) : "precio a confirmar"}</div>
          <div class="qty"><button data-qty="${c}" data-d="-1" aria-label="Menos">−</button><span>${q}</span><button data-qty="${c}" data-d="1" aria-label="Más">+</button></div></div>
        <div class="sub">${p.price ? money(p.price * q) : "—"}<button class="rm" data-rm="${c}">Quitar</button></div>
      </div>`;
    }).join("");
    const saved = (() => { try { return JSON.parse(localStorage.getItem("cliente") || "{}"); } catch { return {}; } })();
    $("#cartBody").innerHTML = `${rows}
      <div class="total"><span>Total aproximado</span><b>${money(total)}</b></div>
      <p class="note">${unknown ? "Algunos productos tienen precio a confirmar. " : ""}Quien te atienda confirmará precios y disponibilidad por WhatsApp.</p>
      <form class="form" id="orderForm">
        <label>Tu nombre *<input name="customerName" required maxlength="80" value="${esc(saved.customerName || "")}"></label>
        <label>Tu celular<input name="customerPhone" inputmode="tel" maxlength="20" value="${esc(saved.customerPhone || "")}"></label>
        <label>Notas (tonos, dirección, forma de pago…)<textarea name="notes" rows="2" maxlength="500"></textarea></label>
        <p class="error" id="orderError" hidden></p>
        <button class="order-btn" id="orderBtn">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .1-3.3-.8-2.8-1.1-4.5-3.9-4.7-4.1-.1-.2-1.1-1.5-1.1-2.9s.7-2.1 1-2.4c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .5l-.3.5-.4.5c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.6-.1l2 .9c.3.2.5.2.5.4.1.1.1.7-.1 1.4Z"/></svg>
          QUIERO HACER MI PEDIDO
        </button>
      </form>`;
  }

  async function sendOrder(form) {
    const btn = $("#orderBtn"), err = $("#orderError");
    const data = Object.fromEntries(new FormData(form));
    try { localStorage.setItem("cliente", JSON.stringify({ customerName: data.customerName, customerPhone: data.customerPhone })); } catch {}
    // Abrimos la ventana antes de la respuesta para que el navegador no la bloquee
    const win = window.open("", "_blank");
    btn.disabled = true;
    err.hidden = true;
    try {
      const r = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, items: Object.entries(cart).map(([code, qty]) => ({ code, qty })) }),
      });
      const out = await r.json();
      if (!r.ok) throw new Error(out.error || "Error");
      if (win) win.location.href = out.whatsappUrl;
      cart = {};
      saveCart();
      $$("[data-add]").forEach((b) => refreshAddButtons(b.dataset.add));
      $("#cartBody").innerHTML = `<div class="success">
        <p>¡Listo! Tu pedido quedó registrado con el código</p>
        <div class="code">${esc(out.code)}</div>
        <p>Envía el mensaje por WhatsApp para que te confirmen el pedido.</p>
        <a class="order-btn" href="${esc(out.whatsappUrl)}" target="_blank" rel="noopener">Abrir WhatsApp</a>
        <p class="note" style="margin-top:14px">Si WhatsApp no se abrió solo, toca el botón.</p></div>`;
    } catch (e) {
      if (win) win.close();
      err.textContent = e.message;
      err.hidden = false;
      btn.disabled = false;
    }
  }

  // ---------- Asistente ----------
  const aiHistory = [];
  function aiAppend(html, who) {
    const d = document.createElement("div");
    d.className = "msg " + who;
    d.innerHTML = html;
    $("#aiMsgs").appendChild(d);
    $("#aiMsgs").scrollTop = $("#aiMsgs").scrollHeight;
    return d;
  }
  async function aiAsk(text) {
    text = text.trim();
    if (!text) return;
    aiAppend(esc(text), "user");
    aiHistory.push({ role: "user", content: text });
    const wait = aiAppend(`<span class="typing">Buscando…</span>`, "bot");
    try {
      const r = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: aiHistory }) });
      const out = await r.json();
      if (!r.ok) throw new Error(out.error);
      aiHistory.push({ role: "assistant", content: JSON.stringify({ respuesta: out.reply, codigos: out.codes }) });
      const items = (out.codes || []).map((c) => byCode.get(c)).filter(Boolean);
      wait.innerHTML = `${esc(out.reply)}${items.length ? `<div class="ai-results">${items.map((p) => `
        <div class="ai-item"><img src="/revista/s${pad(p.page)}.jpg" data-detail="${p.code}" alt="">
          <div><div class="n">${esc(p.name)}</div><div class="p">${p.code} · ${p.price ? money(p.price) : "precio a confirmar"} · pág. ${p.page}</div></div>
          <button data-add="${p.code}" data-label="+">+</button></div>`).join("")}</div>` : ""}`;
      items.forEach((p) => refreshAddButtons(p.code));
    } catch (e) {
      wait.textContent = e.message || "No pude responder ahora. Intenta de nuevo.";
    }
    $("#aiMsgs").scrollTop = $("#aiMsgs").scrollHeight;
  }

  // ---------- Eventos ----------
  document.addEventListener("click", (e) => {
    const t = e.target.closest("button, img, a");
    if (!t) return;
    if (t.dataset.add) { e.preventDefault(); addToCart(t.dataset.add); }
    else if (t.dataset.detail) openDetail(t.dataset.detail);
    else if (t.dataset.sec) { section = t.dataset.sec; shown = 48; renderChips(); renderGrid(); }
    else if (t.dataset.view) setView(t.dataset.view);
    else if (t.dataset.gopage) { $("#productDialog").close(); currentPage = +t.dataset.gopage; setView("revista"); }
    else if (t.dataset.p) showPage(+t.dataset.p);
    else if (t.dataset.qty) setQty(t.dataset.qty, (cart[t.dataset.qty] || 0) + +t.dataset.d);
    else if (t.dataset.rm) setQty(t.dataset.rm, 0);
    else if (t.hasAttribute("data-close")) t.closest("dialog").close();
    else if (t.closest(".suggest")) aiAsk(t.textContent);
  });
  $("#productDialog").addEventListener("click", (e) => { if (e.target.id === "productDialog") e.target.close(); });
  let qTimer;
  $("#q").addEventListener("input", () => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { shown = 48; if ($("#view-catalogo").hidden) setView("catalogo"); renderGrid(); }, 150);
  });
  $("#sort").addEventListener("change", renderGrid);
  $("#more").addEventListener("click", () => { shown += 48; renderGrid(); });
  $("#openCart").addEventListener("click", openCart);
  $("#closeCart").addEventListener("click", closeCart);
  $("#overlay").addEventListener("click", closeCart);
  $("#cartBody").addEventListener("submit", (e) => { e.preventDefault(); sendOrder(e.target); });
  $("#prevPage").addEventListener("click", () => showPage(currentPage - 1));
  $("#nextPage").addEventListener("click", () => showPage(currentPage + 1));
  $("#pageNum").addEventListener("change", (e) => showPage(+e.target.value));
  document.addEventListener("keydown", (e) => {
    if ($("#view-revista").hidden || e.target.matches("input, textarea")) return;
    if (e.key === "ArrowLeft") showPage(currentPage - 1);
    if (e.key === "ArrowRight") showPage(currentPage + 1);
  });
  $("#aiFab").addEventListener("click", () => { $("#aiPanel").hidden = false; $("#aiFab").hidden = true; $("#aiInput").focus(); });
  $("#aiClose").addEventListener("click", () => { $("#aiPanel").hidden = true; $("#aiFab").hidden = false; });
  $("#aiForm").addEventListener("submit", (e) => { e.preventDefault(); const v = $("#aiInput").value; $("#aiInput").value = ""; aiAsk(v); });

  // ---------- Inicio ----------
  Promise.all([fetch("/api/config").then((r) => r.json()), fetch("/api/products").then((r) => r.json())]).then(([c, list]) => {
    config = c;
    totalPages = c.pages || totalPages;
    document.title = `${c.storeName} · ${c.cycle}`;
    $("#storeName").textContent = c.storeName;
    $("#cycle").textContent = c.cycle;
    $("#pageTotal").textContent = totalPages;
    $("#aiMode").textContent = c.assistantAI ? "Con inteligencia artificial" : "Búsqueda por palabras";
    products = list.map((p) => ({ ...p, _hay: norm(`${p.name} ${p.title} ${p.section} ${p.code} ${(p.detail || []).join(" ")}`) }));
    byCode = new Map(products.map((p) => [p.code, p]));
    renderChips();
    renderGrid();
    renderCartCount();
  });
})();
