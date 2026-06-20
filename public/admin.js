// ZoQR Admin SPA
// Plain JS + React + htm — no build step.
// Communicates with /admin/api/* using a bearer token from localStorage.

const { useState, useEffect, useCallback, useMemo, useRef } = React;
const html = htm.bind(React.createElement);

const API_BASE = "/admin/api";

// ---------- API client ----------
function useApi(token, tenant) {
  return useCallback(
    async (path, opts = {}) => {
      const url = new URL(API_BASE + path, window.location.origin);
      if (tenant && !/[?&]tenant=/.test(path)) {
        url.searchParams.set("tenant", tenant);
      }
      const res = await fetch(url, {
        ...opts,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
          ...(opts.headers || {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || res.statusText);
      }
      return res.json();
    },
    [token, tenant]
  );
}

// ---------- Toast hook ----------
function useToasts() {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, kind = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  }, []);
  return { toasts, push };
}

function Toasts({ toasts }) {
  return html`
    <div>
      ${toasts.map(
        (t) => html`<div key=${t.id} class=${"toast " + t.kind}>${t.msg}</div>`
      )}
    </div>
  `;
}

// ---------- Login ----------
function Login({ onLogin }) {
  const [token, setToken] = useState(localStorage.getItem("zoqr_token") || "");
  const [tenant, setTenant] = useState(
    localStorage.getItem("zoqr_tenant") || "demo"
  );
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(
        API_BASE + "/qrs?tenant=" + encodeURIComponent(tenant),
        { headers: { Authorization: "Bearer " + token } }
      );
      if (!res.ok) throw new Error("Invalid token or tenant");
      localStorage.setItem("zoqr_token", token);
      localStorage.setItem("zoqr_tenant", tenant);
      onLogin(token, tenant);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return html`
    <div
      style=${{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
    >
      <form
        onSubmit=${submit}
        style=${{
          width: 360,
          padding: 24,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 8,
        }}
      >
        <h1 style=${{ marginTop: 0 }}>ZoQR Admin</h1>
        <p style=${{ color: "var(--muted)", marginTop: 0 }}>
          Sign in with your ZoQR API token.
        </p>
        <div class="form-field">
          <label>API token</label>
          <input
            type="password"
            value=${token}
            onInput=${(e) => setToken(e.target.value)}
            placeholder="Bearer token"
            required
            autofocus
          />
        </div>
        <div class="form-field">
          <label>Tenant</label>
          <input
            value=${tenant}
            onInput=${(e) => setTenant(e.target.value)}
            placeholder="demo"
            required
          />
        </div>
        ${err && html`<div style=${{ color: "var(--danger)", marginBottom: 12 }}>${err}</div>`}
        <button type="submit" style=${{ width: "100%" }} disabled=${busy}>
          ${busy ? html`<span class="spinner" />` : "Sign in"}
        </button>
      </form>
    </div>
  `;
}

// ---------- QR list ----------
function QRList({ qrs, activeSlug, onSelect, onCreate, wedges, onBrowseRegistry }) {
  return html`
    <aside>
      <div style=${{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
        <div class="row">
          <span class="grow" style=${{ fontWeight: 600, fontSize: 13 }}>
            QRs (${qrs.length})
          </span>
          <button onClick=${onCreate}>+ New</button>
        </div>
        <div style=${{ marginTop: 8 }}>
          <button
            class="secondary"
            style=${{ width: "100%", fontSize: 12 }}
            onClick=${onBrowseRegistry}
          >
            Browse wedge registry →
          </button>
        </div>
      </div>
      ${qrs.length === 0
        ? html`
            <div class="empty">
              No QRs yet. Click <b>+ New</b> to create your first one.
            </div>
          `
        : qrs.map(
            (q) => html`
              <div
                key=${q.slug}
                class=${"qr-item" + (q.slug === activeSlug ? " active" : "")}
                onClick=${() => onSelect(q.slug)}
              >
                <div class="title">${q.title || q.slug}</div>
                <div class="slug">${q.slug}</div>
                <div class="stats">
                  ${q.wedge_id ? "▲ " + q.wedge_id : "no wedge"} · ${q.status}
                </div>
              </div>
            `
          )}
    </aside>
  `;
}

// ---------- Registry browser ----------
function RegistryBrowser({ onInstall, onClose, busy }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState("All");

  useEffect(() => {
    let cancelled = false;
    fetch("/admin/registry", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setErr(e.message); });
    return () => { cancelled = true; };
  }, []);

  const wedges = data?.wedges || [];
  const categories = ["All", ...new Set(wedges.map((w) => w.category || "Other"))];
  const q = query.trim().toLowerCase();
  const filtered = wedges.filter((w) => {
    if (activeCat !== "All" && (w.category || "Other") !== activeCat) return false;
    if (!q) return true;
    return (
      (w.id || "").toLowerCase().includes(q) ||
      (w.name || "").toLowerCase().includes(q) ||
      (w.description || "").toLowerCase().includes(q)
    );
  });

  return html`
    <div class="modal-backdrop" onClick=${onClose}>
      <div
        class="modal"
        style=${{ maxWidth: 720, width: "92vw", maxHeight: "85vh" }}
        onClick=${(e) => e.stopPropagation()}
      >
        <div class="modal-header">
          <h2>Wedge registry</h2>
          <button class="secondary" onClick=${onClose}>Close</button>
        </div>
        <div style=${{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
          <input
            type="search"
            placeholder="Search by id, name, or description…"
            value=${query}
            onInput=${(e) => setQuery(e.target.value)}
            style=${{ width: "100%" }}
          />
          <div style=${{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            ${categories.map(
              (c) => html`
                <button
                  key=${c}
                  class=${"chip" + (c === activeCat ? " active" : "")}
                  onClick=${() => setActiveCat(c)}
                >
                  ${c}
                </button>
              `
            )}
          </div>
        </div>
        <div style=${{ padding: "0 16px 16px", overflowY: "auto", maxHeight: "60vh" }}>
          ${err && html`<div class="err">Failed to load registry: ${err}</div>`}
          ${data?.stale && html`
            <div class="warn" style=${{ padding: 10, margin: "12px 0", borderRadius: 6 }}>
              ⚠ Showing cached registry (upstream unavailable, ${Math.round((data.age_ms || 0) / 1000)}s old).
            </div>
          `}
          ${data && !err && filtered.length === 0 && html`
            <div class="empty">No wedges match this filter.</div>
          `}
          ${filtered.map(
            (w) => html`
              <div
                key=${w.id}
                style=${{
                  padding: "12px 0",
                  borderBottom: "1px solid var(--border)",
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                }}
              >
                <div style=${{ flex: 1 }}>
                  <div style=${{ fontWeight: 600 }}>${w.name || w.id}</div>
                  <div style=${{ fontSize: 12, color: "var(--muted)", fontFamily: "var(--mono)" }}>
                    ${w.id} · ${w.category || "Other"}
                  </div>
                  <div style=${{ marginTop: 4, fontSize: 13 }}>${w.description || ""}</div>
                </div>
                <button
                  disabled=${busy}
                  onClick=${() => onInstall(w)}
                  title=${"Install " + w.id}
                >
                  Install
                </button>
              </div>
            `
          )}
        </div>
        <div style=${{ padding: "8px 16px", borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--muted)" }}>
          ${wedges.length} wedges · last fetch ${data ? new Date(Date.now() - (data.age_ms || 0)).toLocaleTimeString() : "—"}</div>
      </div>
    </div>
  `;
}

// ---------- Block editor ----------
const BLOCK_TYPES = [
  { type: "text", label: "Text" },
  { type: "image", label: "Image" },
  { type: "file", label: "File" },
  { type: "link", label: "Link button" },
  { type: "video", label: "Video" },
];

function newBlock(type) {
  if (type === "text") return { type, html: "<p>Hello!</p>" };
  if (type === "image") return { type, src: "", alt: "" };
  if (type === "file") return { type, src: "", label: "Download" };
  if (type === "link") return { type, href: "https://", label: "Open" };
  if (type === "video") return { type, src: "", poster: "" };
  return { type };
}

function BlockEditor({
  block,
  onChange,
  onRemove,
  onUp,
  onDown,
  isFirst,
  isLast,
}) {
  function update(field, value) {
    onChange({ ...block, [field]: value });
  }
  return html`
    <div class="block">
      <div class="block-header">
        <span class="block-type">${block.type}</span>
        <div class="row">
          <button class="secondary" onClick=${onUp} disabled=${isFirst} title="Move up">↑</button>
          <button class="secondary" onClick=${onDown} disabled=${isLast} title="Move down">↓</button>
          <button class="danger" onClick=${onRemove} title="Remove">×</button>
        </div>
      </div>
      ${block.type === "text" &&
      html`<textarea rows="4" value=${block.html} onInput=${(e) => update("html", e.target.value)} />`}
      ${block.type === "image" &&
      html`
        <div>
          <label>Image URL</label>
          <input value=${block.src} onInput=${(e) => update("src", e.target.value)} placeholder="https://..." />
          <label style=${{ marginTop: 8 }}>Alt text</label>
          <input value=${block.alt || ""} onInput=${(e) => update("alt", e.target.value)} />
        </div>
      `}
      ${block.type === "file" &&
      html`
        <div>
          <label>File URL</label>
          <input value=${block.src} onInput=${(e) => update("src", e.target.value)} placeholder="https://..." />
          <label style=${{ marginTop: 8 }}>Label</label>
          <input value=${block.label} onInput=${(e) => update("label", e.target.value)} />
        </div>
      `}
      ${block.type === "link" &&
      html`
        <div>
          <label>URL</label>
          <input value=${block.href} onInput=${(e) => update("href", e.target.value)} placeholder="https://..." />
          <label style=${{ marginTop: 8 }}>Label</label>
          <input value=${block.label} onInput=${(e) => update("label", e.target.value)} />
        </div>
      `}
      ${block.type === "video" &&
      html`
        <div>
          <label>Video URL</label>
          <input value=${block.src} onInput=${(e) => update("src", e.target.value)} placeholder="https://...mp4" />
          <label style=${{ marginTop: 8 }}>Poster (optional)</label>
          <input value=${block.poster || ""} onInput=${(e) => update("poster", e.target.value)} />
        </div>
      `}
    </div>
  `;
}

// ---------- Form editor ----------
function FormEditor({ form, onChange }) {
  function addField() {
    onChange({
      ...form,
      fields: [...(form?.fields || []), { name: "", label: "", type: "text", required: false }],
    });
  }
  function update(i, patch) {
    const fields = [...(form?.fields || [])];
    fields[i] = { ...fields[i], ...patch };
    onChange({ ...form, fields });
  }
  function remove(i) {
    onChange({ ...form, fields: form.fields.filter((_, j) => j !== i) });
  }
  return html`
    <div>
      <div class="row" style=${{ marginBottom: 8 }}>
        <label class="grow">
          <input
            type="checkbox"
            checked=${!!form?.enabled}
            onChange=${(e) => onChange({ ...(form || {}), enabled: e.target.checked })}
          />
          ${" "} Enable form
        </label>
        ${form?.enabled &&
        html`<button class="secondary" onClick=${addField}>+ Add field</button>`}
      </div>
      ${form?.enabled &&
      (form.fields || []).map(
        (f, i) => html`
          <div key=${i} class="block">
            <div class="block-header">
              <span class="block-type">field ${i + 1}</span>
              <button class="danger" onClick=${() => remove(i)}>×</button>
            </div>
            <div style=${{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <label>Name (key)</label>
                <input value=${f.name} onInput=${(e) => update(i, { name: e.target.value })} />
              </div>
              <div>
                <label>Label</label>
                <input value=${f.label} onInput=${(e) => update(i, { label: e.target.value })} />
              </div>
              <div>
                <label>Type</label>
                <select value=${f.type} onChange=${(e) => update(i, { type: e.target.value })}>
                  <option value="text">text</option>
                  <option value="email">email</option>
                  <option value="tel">tel</option>
                  <option value="number">number</option>
                  <option value="textarea">textarea</option>
                </select>
              </div>
              <div>
                <label>Required</label>
                <select value=${f.required ? "yes" : "no"} onChange=${(e) => update(i, { required: e.target.value === "yes" })}>
                  <option value="no">no</option>
                  <option value="yes">yes</option>
                </select>
              </div>
            </div>
          </div>
        `
      )}
    </div>
  `;
}

// ---------- Detail editor ----------
function QREditor({ qr, onChange, onSave, onDelete, onCopyQR, publicBase, busy }) {
  const content = qr.content || { blocks: [] };
  function setContent(patch) { onChange({ ...qr, content: { ...content, ...patch } }); }
  function setBlock(i, b) {
    const blocks = [...(content.blocks || [])];
    blocks[i] = b;
    setContent({ blocks });
  }
  function addBlock(type) {
    setContent({ blocks: [...(content.blocks || []), newBlock(type)] });
  }
  function removeBlock(i) {
    setContent({ blocks: content.blocks.filter((_, j) => j !== i) });
  }
  function move(i, dir) {
    const blocks = [...(content.blocks || [])];
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
    setContent({ blocks });
  }
  const publicUrl = publicBase ? publicBase + "/q/" + qr.slug : "";
  const qrImgUrl = publicUrl
    ? "https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=" + encodeURIComponent(publicUrl)
    : "";

  return html`
    <section>
      <div class="row" style=${{ marginBottom: 16 }}>
        <h2 style=${{ margin: 0 }}>${qr.slug}</h2>
        <span class="grow" />
        <button class="secondary" onClick=${() => onCopyQR(qr)}>Copy QR</button>
        <button onClick=${onSave} disabled=${busy}>
          ${busy ? html`<span class="spinner" />` : "Save"}
        </button>
        <button class="danger" onClick=${onDelete}>Delete</button>
      </div>

      <div class="stats-grid">
        <div class="stat">
          <div class="num">${qr.scans ?? 0}</div>
          <div class="label">Scans</div>
        </div>
        <div class="stat">
          <div class="num">${qr.submissions ?? 0}</div>
          <div class="label">Submissions</div>
        </div>
        <div class="stat">
          <div class="num">${qr.status}</div>
          <div class="label">Status</div>
        </div>
      </div>

      <div class="form-field">
        <label>Title</label>
        <input
          value=${qr.title || ""}
          onInput=${(e) => onChange({ ...qr, title: e.target.value })}
        />
      </div>

      <div class="form-field">
        <label>Wedge (rendering config)</label>
        <select
          value=${qr.wedge_id || ""}
          onChange=${(e) => onChange({ ...qr, wedge_id: e.target.value || null })}
        >
          <option value="">— No wedge (raw) —</option>
          ${(qr._wedges || []).map(
            (w) => html`
              <option value=${w.id}>${w.id} @${w.version}</option>
            `
          )}
        </select>
      </div>

      <div class="section-title">Content blocks</div>
      ${(content.blocks || []).map(
        (b, i) => html`
          <${BlockEditor}
            key=${i}
            block=${b}
            onChange=${(b) => setBlock(i, b)}
            onRemove=${() => removeBlock(i)}
            onUp=${() => move(i, -1)}
            onDown=${() => move(i, 1)}
            isFirst=${i === 0}
            isLast=${i === content.blocks.length - 1}
          />
        `
      )}
      <div class="row" style=${{ marginTop: 8, flexWrap: "wrap", gap: 4 }}>
        ${BLOCK_TYPES.map(
          (t) => html`
            <button
              key=${t.type}
              class="secondary"
              onClick=${() => addBlock(t.type)}
            >
              + ${t.label}
            </button>
          `
        )}
      </div>

      <div class="section-title">Form (optional)</div>
      <${FormEditor} form=${content.form} onChange=${(f) => setContent({ form: f })} />

      <div class="section-title">Public URL</div>
      ${publicUrl
        ? html`
            <div style=${{ display: "flex", gap: 16, alignItems: "flex-start" }}>
              <div class="qr-image">
                <img src=${qrImgUrl} width="240" height="240" alt="QR" />
              </div>
              <div>
                <input value=${publicUrl} readOnly onFocus=${(e) => e.target.select()} />
                <p style=${{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>
                  Print this QR. Scanning it loads the public page.
                </p>
              </div>
            </div>
          `
        : html`
            <p style=${{ color: "var(--muted)" }}>
              Set ZOQR_PAGES_BASE to enable the public URL + QR.
            </p>
          `}
    </section>
  `;
}

// ---------- New QR modal ----------
function NewQR({ onCreate, onCancel, busy }) {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  return html`
    <div
      style=${{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
      onClick=${onCancel}
    >
      <form
        onClick=${(e) => e.stopPropagation()}
        onSubmit=${(e) => {
          e.preventDefault();
          onCreate({ title, slug: slug || undefined });
        }}
        style=${{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 24,
          width: 400,
        }}
      >
        <h2 style=${{ marginTop: 0 }}>New QR</h2>
        <div class="form-field">
          <label>Title</label>
          <input
            value=${title}
            onInput=${(e) => {
              setTitle(e.target.value);
              if (!slug) {
                setSlug(
                  e.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-+|-+$/g, "")
                );
              }
            }}
            required
            autofocus
          />
        </div>
        <div class="form-field">
          <label>Slug (auto, editable)</label>
          <input
            value=${slug}
            onInput=${(e) => setSlug(e.target.value)}
            placeholder="auto from title"
          />
        </div>
        <div class="row" style=${{ justifyContent: "flex-end" }}>
          <button type="button" class="secondary" onClick=${onCancel}>
            Cancel
          </button>
          <button type="submit" disabled=${busy}>
            ${busy ? html`<span class="spinner" />` : "Create"}
          </button>
        </div>
      </form>
    </div>
  `;
}

// ---------- Main app ----------
function App() {
  const [auth, setAuth] = useState(() => {
    const token = localStorage.getItem("zoqr_token");
    const tenant = localStorage.getItem("zoqr_tenant") || "demo";
    return token ? { token, tenant } : null;
  });
  const { toasts, push } = useToasts();
  const api = useApi(auth?.token, auth?.tenant);
  const [qrs, setQrs] = useState([]);
  const [wedges, setWedges] = useState([]);
  const [activeSlug, setActiveSlug] = useState(null);
  const [draft, setDraft] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [showRegistry, setShowRegistry] = useState(false);
  const [busy, setBusy] = useState(false);
  const publicBase = (typeof window !== "undefined" && window.ZOQR_PAGES_BASE) || "";

  const refresh = useCallback(async () => {
    if (!auth) return;
    try {
      const [qrs, wedges] = await Promise.all([api("/qrs"), api("/wedges")]);
      setQrs(qrs);
      setWedges(wedges);
      if (!activeSlug && qrs[0]) setActiveSlug(qrs[0].slug);
    } catch (e) {
      push(e.message, "err");
    }
  }, [auth, api, activeSlug, push]);

  useEffect(() => {
    refresh();
  }, [auth]);

  useEffect(() => {
    if (!activeSlug) return;
    if (draft && draft.slug === activeSlug) return;
    const qr = qrs.find((q) => q.slug === activeSlug);
    if (qr) setDraft({ ...qr, _wedges: wedges });
  }, [activeSlug, qrs, wedges, draft]);

  if (!auth) {
    return html`<${Login} onLogin=${(t, ten) => setAuth({ token: t, tenant: ten })} />`;
  }

  async function createQR(body) {
    setBusy(true);
    try {
      const qr = await api("/qrs", { method: "POST", body });
      setShowNew(false);
      await refresh();
      setActiveSlug(qr.slug);
      push("QR created");
    } catch (e) {
      push(e.message, "err");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      await api("/qrs/" + draft.slug, {
        method: "PATCH",
        body: {
          title: draft.title,
          wedge_id: draft.wedge_id,
          content: draft.content,
        },
      });
      await refresh();
      push("Saved");
    } catch (e) {
      push(e.message, "err");
    } finally {
      setBusy(false);
    }
  }

  async function installWedge(w) {
    setBusy(true);
    try {
      const version = w.latest || "1.0.0";
      const base_url = w.homepage
        ? w.homepage.replace(/\/[^/]+\/[^/]+\/[^/]+\/[^/]+$/, "")
        : "";
      const res = await api("/wedges", { method: "POST", body: { id: w.id, name: w.name, version, base_url } });
      await refresh();
      setShowRegistry(false);
      push("Installed " + w.id + (res.version ? " v" + res.version : ""));
    } catch (e) {
      push(e.message, "err");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!draft) return;
    if (!confirm("Delete " + draft.slug + "?")) return;
    setBusy(true);
    try {
      await api("/qrs/" + draft.slug, { method: "DELETE" });
      setDraft(null);
      setActiveSlug(null);
      await refresh();
      push("Deleted");
    } catch (e) {
      push(e.message, "err");
    } finally {
      setBusy(false);
    }
  }

  function copyQR(qr) {
    const url = publicBase + "/q/" + qr.slug;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url);
      push("URL copied: " + url);
    }
  }

  return html`
    <${React.Fragment}>
      <header>
        <h1>ZoQR Admin</h1>
        <div class="meta">
          Tenant: <b>${auth.tenant}</b> ·
          <a
            href="#"
            onClick=${(e) => {
              e.preventDefault();
              localStorage.removeItem("zoqr_token");
              localStorage.removeItem("zoqr_tenant");
              setAuth(null);
            }}
            style=${{ color: "var(--muted)", marginLeft: 8 }}
          >sign out</a>
        </div>
      </header>
      <main>
        <${QRList}
          qrs=${qrs}
          activeSlug=${activeSlug}
          onSelect=${(s) => setActiveSlug(s)}
          onCreate=${() => setShowNew(true)}
          onBrowseRegistry=${() => setShowRegistry(true)}
          wedges=${wedges}
        />
        ${draft
          ? html`
              <${QREditor}
                qr=${draft}
                onChange=${setDraft}
                onSave=${save}
                onDelete=${remove}
                onCopyQR=${copyQR}
                publicBase=${publicBase}
                busy=${busy}
              />
            `
          : html`
              <section>
                <div class="empty">
                  ${qrs.length === 0
                    ? "No QRs yet. Create your first one."
                    : "Select a QR to edit."}
                </div>
              </section>
            `}
      </main>
      ${showNew &&
      html`<${NewQR}
        onCreate=${createQR}
        onCancel=${() => setShowNew(false)}
        busy=${busy}
      />`}
      ${showRegistry &&
      html`<${RegistryBrowser}
        onInstall=${installWedge}
        onClose=${() => setShowRegistry(false)}
        busy=${busy}
      />`}
      <${Toasts} toasts=${toasts} />
    <//>
  `;
}

ReactDOM.createRoot(document.getElementById("root")).render(html`<${App} />`);
