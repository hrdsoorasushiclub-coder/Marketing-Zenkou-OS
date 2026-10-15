// Penerjemah markdown kecil. Semua teks di-escape dulu, jadi aman dari injeksi HTML.

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const slug = (s) =>
  String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "bagian";

export function inline(src) {
  let s = esc(src);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>");
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  return s;
}

const splitRow = (line) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

/**
 * @param {string} md
 * @param {{checkKey?: string, checked?: Record<string, boolean>}} [opts]
 * @returns {{html: string, toc: {level:number,id:string,text:string}[]}}
 */
export function render(md, opts = {}) {
  const lines = String(md || "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  const toc = [];
  const used = new Map();
  let taskIndex = 0;
  let i = 0;

  const uniqueId = (text) => {
    const base = slug(text);
    const n = used.get(base) || 0;
    used.set(base, n + 1);
    return n ? `${base}-${n + 1}` : base;
  };

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    let m = line.match(/^(#{1,4})\s+(.*)$/);
    if (m) {
      const level = m[1].length;
      const id = uniqueId(m[2].replace(/[*`]/g, ""));
      if (level === 2 || level === 3) toc.push({ level, id, text: m[2].replace(/[*`]/g, "") });
      out.push(`<h${level} id="${id}">${inline(m[2])}</h${level}>`);
      i++; continue;
    }

    if (/^\s*---+\s*$/.test(line)) { out.push("<hr>"); i++; continue; }

    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, "")); i++; }
      out.push(`<blockquote>${inline(buf.join(" "))}</blockquote>`);
      continue;
    }

    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(splitRow(lines[i])); i++; }
      let t = '<div class="tablewrap"><table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>";
      for (const r of rows) {
        t += "<tr>" + head.map((_, k) => `<td>${inline(r[k] || "")}</td>`).join("") + "</tr>";
      }
      out.push(t + "</tbody></table></div>");
      continue;
    }

    m = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (m) {
      const ordered = /\d/.test(m[2]);
      const items = [];
      while (i < lines.length) {
        const mm = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
        if (!mm || /\d/.test(mm[2]) !== ordered) break;
        items.push(mm[3]);
        i++;
      }
      const tasks = !ordered && items.every((t) => /^\[( |x|X)\]\s/.test(t));
      if (tasks) {
        out.push(
          '<ul class="tasks">' +
            items
              .map((t) => {
                const done = /^\[(x|X)\]/.test(t);
                const label = t.replace(/^\[( |x|X)\]\s/, "");
                const key = `${opts.checkKey || "chk"}:${taskIndex++}`;
                const on = opts.checked ? !!opts.checked[key] : done;
                return `<li><input type="checkbox" data-key="${esc(key)}" ${on ? "checked" : ""} ${opts.checkKey ? "" : "disabled"} aria-label="${esc(label)}"><span>${inline(label)}</span></li>`;
              })
              .join("") +
            "</ul>"
        );
      } else {
        const tag = ordered ? "ol" : "ul";
        out.push(`<${tag}>` + items.map((t) => `<li>${inline(t)}</li>`).join("") + `</${tag}>`);
      }
      continue;
    }

    const buf = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^\s*\|/.test(lines[i]) &&
      !/^(\s*)([-*]|\d+\.)\s+/.test(lines[i])
    ) { buf.push(lines[i]); i++; }
    if (buf.length) out.push(`<p>${inline(buf.join(" "))}</p>`);
    else i++;
  }
  return { html: out.join("\n"), toc };
}

export const plainText = (md) =>
  String(md || "").replace(/[#>*`|\-\[\]]/g, " ").replace(/\s+/g, " ").trim();
