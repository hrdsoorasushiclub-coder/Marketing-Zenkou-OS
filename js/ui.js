// Fungsi bantu tampilan: membuat elemen, ikon, dialog, toast.

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "html") el.innerHTML = v; // hanya untuk HTML yang sudah di-escape (md.js)
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "value") el.value = v;
    else if (k === "checked" || k === "disabled" || k === "hidden" || k === "selected") el[k] = !!v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const ICONS = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 5.5v16"/>',
  flow: '<rect x="3" y="3.5" width="7" height="5" rx="1.5"/><rect x="14" y="15.5" width="7" height="5" rx="1.5"/><path d="M6.5 8.5v4.5a2 2 0 0 0 2 2H14"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 2-.9 2-1.8 0-1.3-1-1.6-1-2.7 0-1 .8-1.5 1.8-1.5H17a3.5 3.5 0 0 0 3.5-3.5C20.5 7 16.8 3.5 12 3.5z"/><circle cx="7.8" cy="11" r="1"/><circle cx="10.5" cy="7.5" r="1"/><circle cx="15" cy="7.8" r="1"/>',
  megaphone: '<path d="M3.5 10.5v3a1 1 0 0 0 1 1H7l7 4v-13l-7 4H4.5a1 1 0 0 0-1 1z"/><path d="M18 9.5a4 4 0 0 1 0 5"/>',
  wallet: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H19v14H6.5A2.5 2.5 0 0 1 4 16.5z"/><path d="M19 9.5h-3.5a2 2 0 0 0 0 4H19"/>',
  users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19.5c.6-3 3-4.8 6-4.8s5.4 1.8 6 4.8"/><path d="M16 5.6a3.2 3.2 0 0 1 0 5.8M18.5 14.9c1.5.7 2.5 2.1 2.8 4.1"/>',
  tag: '<path d="M3.5 12.5V4.5h8l9 9-8 8z"/><circle cx="8" cy="9" r="1.2"/>',
  db: '<ellipse cx="12" cy="6" rx="7.5" ry="2.8"/><path d="M4.5 6v6c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V6M4.5 12v6c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-6"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/><path d="m14 7 3 3"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>',
  trash: '<path d="M4.5 7h15M10 7V4.5h4V7M6.5 7l.8 12h9.4l.8-12M10 11v5M14 11v5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  logout: '<path d="M14 4.5h4.5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H14M10 8l-4 4 4 4M6 12h9.5"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  left: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  clipboard: '<rect x="5" y="4.5" width="14" height="16" rx="2"/><path d="M9 4.5h6v3H9z"/><path d="m8.5 13.5 2.2 2.2 4.3-4.4"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4.5v4h4"/><path d="M12 8v4.5l3 1.8"/>',
  send: '<path d="M21 3 10.5 13.5"/><path d="M21 3l-6.5 18-4-7.5L3 9.5z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  camera: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1.5-2.5h5L16 7h2.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.3"/>',
  pin: '<path d="M12 21s6.5-5.6 6.5-11a6.5 6.5 0 0 0-13 0C5.5 15.4 12 21 12 21z"/><circle cx="12" cy="10" r="2.3"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/>',
};

export function icon(name, size = 18) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("width", size);
  s.setAttribute("height", size);
  s.setAttribute("fill", "none");
  s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", "1.75");
  s.setAttribute("stroke-linecap", "round");
  s.setAttribute("stroke-linejoin", "round");
  s.setAttribute("aria-hidden", "true");
  s.innerHTML = ICONS[name] || "";
  return s;
}

export function toast(msg, kind = "ok") {
  let box = document.querySelector(".toasts");
  if (!box) { box = h("div", { class: "toasts", role: "status", "aria-live": "polite" }); document.body.append(box); }
  const t = h("div", { class: "toast" + (kind === "err" ? " err" : "") }, msg);
  box.append(t);
  setTimeout(() => t.remove(), kind === "err" ? 6000 : 3200);
}

export function dialog({ title, body, actions = [], onClose }) {
  const close = () => { scrim.remove(); document.removeEventListener("keydown", onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const foot = h("footer", {}, actions.map((a) =>
    h("button", {
      class: "btn" + (a.kind ? " " + a.kind : ""),
      type: "button",
      onclick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const keep = await a.onClick?.(close);
          if (keep !== false && a.close !== false) close();
        } catch (err) {
          toast(err.message || String(err), "err");
        } finally { btn.disabled = false; }
      },
    }, a.label)
  ));
  const scrim = h("div", { class: "scrim", onmousedown: (e) => { if (e.target === scrim) close(); } },
    h("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": title },
      h("header", {}, h("h2", {}, title)),
      h("div", { class: "bd" }, body),
      foot));
  document.body.append(scrim);
  document.addEventListener("keydown", onKey);
  scrim.querySelector("input, select, textarea, .btn")?.focus();
  return close;
}

export const confirmDialog = (message, okLabel = "Ya, lanjutkan", kind = "danger") =>
  new Promise((resolve) => {
    dialog({
      title: "Konfirmasi",
      body: h("p", {}, message),
      onClose: () => resolve(false),
      actions: [
        { label: "Batal" },
        { label: okLabel, kind, onClick: () => { resolve(true); } },
      ],
    });
  });

export const fmtDate = (iso) => {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }); }
  catch { return ""; }
};

export const ROLES = {
  executive: "Executive",
  supervisor: "Supervisor",
  creator: "Content Creator",
  designer: "Grafis Desainer",
  videographer: "Videographer / Fotografer",
  admin: "Admin",
};
export const isLead = (u) => !!u && (u.role === "supervisor" || u.role === "executive");
