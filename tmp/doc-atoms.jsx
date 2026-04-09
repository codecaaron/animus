import { useState, useRef, useEffect, useCallback, useMemo } from "react";

const F = {
  display: "'Space Mono', monospace",
  body: "'DM Sans', sans-serif",
  code: "'JetBrains Mono', monospace",
};

const t = {
  bg: "#0c0b0a", surface: "#151413", raised: "#1a1918", hover: "#221f1e",
  border: "#2a2725", borderActive: "#4a4540",
  text: "#e8e2d9", muted: "#9c9488", dim: "#5c5750",
  accent: "#e8593c", accentDim: "#a33d28", accentGlow: "rgba(232,89,60,0.12)",
  amber: "#ef9f27", amberDim: "#a36d1a",
  teal: "#1d9e75", tealDim: "#0f6e56",
  purple: "#7f77dd", purpleDim: "#534ab7",
  blue: "#378add", pink: "#d4537e",
  green: "#639922",
};

// ─────────────────────────────────────────────
//  ATOMS
// ─────────────────────────────────────────────

const AnchorIcon = ({ visible }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" style={{
    opacity: visible ? 0.5 : 0, transition: "opacity 0.15s",
    flexShrink: 0, marginLeft: 8, cursor: "pointer",
  }}>
    <path d="M6.5 3.5h-2a2 2 0 000 4h2m3-4h2a2 2 0 010 4h-2m-5-2h6"
      stroke={t.accent} strokeWidth="1.2" strokeLinecap="round" fill="none"
      transform="translate(0,2.5)" />
  </svg>
);

const KbdBadge = ({ children }) => (
  <kbd style={{
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    minWidth: 22, height: 22, padding: "0 6px",
    fontFamily: F.code, fontSize: 11, color: t.dim,
    background: t.bg, border: `1px solid ${t.border}`,
    borderRadius: 4, lineHeight: 1, boxShadow: `0 1px 0 ${t.border}`,
  }}>{children}</kbd>
);

const StatusDot = ({ status = "stable" }) => {
  const colors = { stable: t.teal, beta: t.amber, deprecated: t.accent, new: t.blue };
  return (
    <span style={{
      display: "inline-block", width: 6, height: 6, borderRadius: "50%",
      background: colors[status] || t.dim, flexShrink: 0,
      boxShadow: `0 0 6px ${colors[status] || t.dim}44`,
    }} />
  );
};

const VersionBadge = ({ version, status }) => (
  <span style={{
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "3px 10px", fontSize: 11, fontFamily: F.code,
    background: t.surface, border: `1px solid ${t.border}`,
    borderRadius: 4, color: t.muted,
  }}>
    <StatusDot status={status} />
    {version}
  </span>
);

const ColorSwatch = ({ color, token }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
    <div style={{
      width: 28, height: 28, borderRadius: 6, background: color,
      border: `1px solid ${t.border}`, flexShrink: 0,
    }} />
    <div style={{ display: "flex", flexDirection: "column" }}>
      <span style={{ fontFamily: F.code, fontSize: 12, color: t.text }}>{token}</span>
      <span style={{ fontFamily: F.code, fontSize: 10, color: t.dim }}>{color}</span>
    </div>
  </div>
);

const CopyButton = ({ text, size = "sm" }) => {
  const [copied, setCopied] = useState(false);
  const handle = () => {
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={handle} style={{
      background: "none", border: `1px solid ${copied ? t.tealDim : t.border}`,
      color: copied ? t.teal : t.dim, cursor: "pointer",
      fontSize: size === "sm" ? 11 : 13,
      padding: size === "sm" ? "2px 8px" : "4px 12px",
      borderRadius: 4, fontFamily: F.code, transition: "all 0.15s",
      display: "inline-flex", alignItems: "center", gap: 4,
    }}>
      {copied ? (
        <svg width="12" height="12" viewBox="0 0 16 16"><path d="M3 8.5l3 3 7-7" stroke={t.teal} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 16 16"><rect x="5" y="5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" fill="none"/><path d="M3 11V3a1.5 1.5 0 011.5-1.5H11" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round"/></svg>
      )}
      {size !== "sm" && (copied ? "Copied" : "Copy")}
    </button>
  );
};

const ThemeToggle = () => {
  const [dark, setDark] = useState(true);
  return (
    <button onClick={() => setDark(!dark)} style={{
      width: 36, height: 20, borderRadius: 10, padding: 2,
      background: dark ? t.border : t.amber,
      border: "none", cursor: "pointer", position: "relative",
      transition: "background 0.2s",
    }}>
      <div style={{
        width: 16, height: 16, borderRadius: "50%",
        background: dark ? t.muted : "#fff",
        transform: dark ? "translateX(0)" : "translateX(16px)",
        transition: "all 0.2s",
      }} />
    </button>
  );
};

const ProgressBar = ({ progress = 0.35 }) => (
  <div style={{
    position: "fixed", top: 0, left: 0, right: 0, height: 2,
    background: t.border, zIndex: 100,
  }}>
    <div style={{
      height: "100%", width: `${progress * 100}%`,
      background: `linear-gradient(90deg, ${t.accent}, ${t.amber})`,
      transition: "width 0.15s ease-out",
    }} />
  </div>
);

const LanguagePill = ({ lang, active, onClick }) => (
  <button onClick={onClick} style={{
    padding: "4px 12px", fontSize: 12, fontFamily: F.code,
    background: active ? t.accentGlow : "transparent",
    border: `1px solid ${active ? t.accent : t.border}`,
    color: active ? t.accent : t.dim, borderRadius: 20,
    cursor: "pointer", transition: "all 0.12s",
  }}>{lang}</button>
);

const ChangedBadge = ({ version }) => (
  <span style={{
    display: "inline-flex", alignItems: "center", gap: 4,
    padding: "1px 8px", fontSize: 10, fontFamily: F.code,
    background: "rgba(239,159,39,0.1)", border: `1px solid ${t.amberDim}`,
    color: t.amber, borderRadius: 3, letterSpacing: "0.02em",
    cursor: "pointer", verticalAlign: "middle", marginLeft: 6,
  }}>changed in {version}</span>
);

const Separator = () => (
  <hr style={{ border: "none", borderTop: `1px solid ${t.border}`, margin: "32px 0" }} />
);

// ─────────────────────────────────────────────
//  MOLECULES
// ─────────────────────────────────────────────

const AnchorHeading = ({ level = 2, id, children, changed }) => {
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const Tag = `h${level}`;
  const sizes = { 1: 32, 2: 22, 3: 17, 4: 15 };

  const handleClick = () => {
    navigator.clipboard?.writeText(`#${id}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "center", gap: 0,
        margin: `${level <= 2 ? 40 : 24}px 0 12px`, position: "relative",
      }}
    >
      <span id={id} style={{ position: "absolute", top: -80 }} />
      <span style={{
        fontFamily: F.display, fontSize: sizes[level], fontWeight: 700,
        color: t.text, letterSpacing: level <= 2 ? "-0.02em" : 0,
        cursor: "pointer",
      }}>
        {children}
      </span>
      {changed && <ChangedBadge version={changed} />}
      <span onClick={handleClick} style={{ cursor: "pointer", display: "flex", alignItems: "center" }}>
        {copied ? (
          <svg width="16" height="16" viewBox="0 0 16 16" style={{ marginLeft: 8, opacity: 0.6 }}>
            <path d="M3 8.5l3 3 7-7" stroke={t.teal} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        ) : (
          <AnchorIcon visible={hovered} />
        )}
      </span>
    </div>
  );
};

const Breadcrumb = ({ items }) => (
  <nav style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
    {items.map((item, i) => (
      <span key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{
          fontFamily: F.code, fontSize: 11, color: i === items.length - 1 ? t.muted : t.dim,
          textTransform: "uppercase", letterSpacing: "0.1em",
          cursor: i < items.length - 1 ? "pointer" : "default",
          transition: "color 0.1s",
        }}>{item}</span>
        {i < items.length - 1 && (
          <svg width="10" height="10" viewBox="0 0 10 10" style={{ opacity: 0.3 }}>
            <path d="M3.5 2L6.5 5L3.5 8" stroke={t.dim} strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </span>
    ))}
  </nav>
);

const PrevNextNav = ({ prev, next }) => (
  <div style={{
    display: "grid", gridTemplateColumns: prev && next ? "1fr 1fr" : "1fr",
    gap: 12, marginTop: 48,
  }}>
    {prev && (
      <button style={{
        display: "flex", flexDirection: "column", gap: 4,
        padding: "16px 20px", background: t.surface,
        border: `1px solid ${t.border}`, borderRadius: 8,
        cursor: "pointer", textAlign: "left", transition: "border-color 0.15s",
      }}
        onMouseEnter={e => e.currentTarget.style.borderColor = t.borderActive}
        onMouseLeave={e => e.currentTarget.style.borderColor = t.border}
      >
        <span style={{ fontFamily: F.code, fontSize: 11, color: t.dim, display: "flex", alignItems: "center", gap: 4 }}>
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M6.5 2L3.5 5L6.5 8" stroke={t.dim} strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
          Previous
        </span>
        <span style={{ fontFamily: F.body, fontSize: 14, color: t.text, fontWeight: 500 }}>{prev}</span>
      </button>
    )}
    {next && (
      <button style={{
        display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end",
        padding: "16px 20px", background: t.surface,
        border: `1px solid ${t.border}`, borderRadius: 8,
        cursor: "pointer", textAlign: "right", transition: "border-color 0.15s",
        gridColumn: !prev ? "1" : "auto",
      }}
        onMouseEnter={e => e.currentTarget.style.borderColor = t.borderActive}
        onMouseLeave={e => e.currentTarget.style.borderColor = t.border}
      >
        <span style={{ fontFamily: F.code, fontSize: 11, color: t.dim, display: "flex", alignItems: "center", gap: 4 }}>
          Next
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M3.5 2L6.5 5L3.5 8" stroke={t.dim} strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </span>
        <span style={{ fontFamily: F.body, fontSize: 14, color: t.text, fontWeight: 500 }}>{next}</span>
      </button>
    )}
  </div>
);

const FeedbackWidget = () => {
  const [state, setState] = useState(null); // null | "yes" | "no" | "submitted"
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "16px 0", borderTop: `1px solid ${t.border}`,
    }}>
      {state === "submitted" ? (
        <span style={{ fontFamily: F.body, fontSize: 13, color: t.teal }}>Thanks for your feedback</span>
      ) : (
        <>
          <span style={{ fontFamily: F.body, fontSize: 13, color: t.muted }}>Was this page helpful?</span>
          <div style={{ display: "flex", gap: 4 }}>
            {["yes", "no"].map(v => (
              <button key={v} onClick={() => setState("submitted")} style={{
                width: 32, height: 32, borderRadius: 6,
                background: state === v ? (v === "yes" ? "rgba(29,158,117,0.12)" : t.accentGlow) : "transparent",
                border: `1px solid ${state === v ? (v === "yes" ? t.tealDim : t.accentDim) : t.border}`,
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.15s", fontSize: 14,
              }}
                onMouseEnter={e => { if (!state) e.currentTarget.style.borderColor = t.borderActive; }}
                onMouseLeave={e => { if (!state) e.currentTarget.style.borderColor = t.border; }}
              >
                {v === "yes" ? (
                  <svg width="16" height="16" viewBox="0 0 16 16"><path d="M3 9l2.5 3L13 4" stroke={state === v ? t.teal : t.dim} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 16 16"><path d="M4 4l8 8m0-8l-8 8" stroke={state === v ? t.accent : t.dim} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

const VersionSelector = () => {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("v2.4.0");
  const versions = [
    { v: "v2.4.0", status: "stable" },
    { v: "v2.3.2", status: "stable" },
    { v: "v3.0.0-beta.2", status: "beta" },
    { v: "v1.9.8", status: "deprecated" },
  ];
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen(!open)} style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "6px 12px", background: t.surface,
        border: `1px solid ${open ? t.borderActive : t.border}`,
        borderRadius: 6, cursor: "pointer", transition: "border-color 0.15s",
        minWidth: 150,
      }}>
        <StatusDot status={versions.find(v => v.v === selected)?.status} />
        <span style={{ fontFamily: F.code, fontSize: 12, color: t.text, flex: 1, textAlign: "left" }}>{selected}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
          <path d="M2.5 3.5L5 6.5L7.5 3.5" stroke={t.dim} strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
          background: t.raised, border: `1px solid ${t.border}`,
          borderRadius: 8, overflow: "hidden", zIndex: 50,
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        }}>
          {versions.map(v => (
            <button key={v.v} onClick={() => { setSelected(v.v); setOpen(false); }} style={{
              display: "flex", alignItems: "center", gap: 8, width: "100%",
              padding: "8px 12px", background: v.v === selected ? t.hover : "transparent",
              border: "none", cursor: "pointer", transition: "background 0.1s",
            }}
              onMouseEnter={e => e.currentTarget.style.background = t.hover}
              onMouseLeave={e => e.currentTarget.style.background = v.v === selected ? t.hover : "transparent"}
            >
              <StatusDot status={v.status} />
              <span style={{ fontFamily: F.code, fontSize: 12, color: v.v === selected ? t.text : t.muted }}>{v.v}</span>
              {v.status !== "stable" && (
                <span style={{ fontFamily: F.code, fontSize: 9, color: t.dim, textTransform: "uppercase", letterSpacing: "0.08em", marginLeft: "auto" }}>{v.status}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const LanguageSwitcher = () => {
  const [lang, setLang] = useState("TypeScript");
  return (
    <div style={{ display: "flex", gap: 4, padding: 2, background: t.surface, borderRadius: 22, border: `1px solid ${t.border}` }}>
      {["TypeScript", "JavaScript", "Vue", "Svelte"].map(l => (
        <LanguagePill key={l} lang={l} active={lang === l} onClick={() => setLang(l)} />
      ))}
    </div>
  );
};

const TokenSwatchRow = ({ tokens }) => (
  <div style={{
    display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
    gap: 12, padding: 20, background: t.surface,
    border: `1px solid ${t.border}`, borderRadius: 8,
  }}>
    {tokens.map((tk, i) => <ColorSwatch key={i} color={tk.color} token={tk.token} />)}
  </div>
);

const SearchResultItem = ({ title, section, snippet, active }) => (
  <div style={{
    padding: "10px 16px", cursor: "pointer",
    background: active ? t.hover : "transparent",
    borderLeft: active ? `2px solid ${t.accent}` : "2px solid transparent",
    transition: "all 0.08s",
  }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
      <span style={{ fontFamily: F.body, fontSize: 14, color: t.text, fontWeight: 500 }}>{title}</span>
      <span style={{ fontFamily: F.code, fontSize: 10, color: t.dim, textTransform: "uppercase", letterSpacing: "0.08em" }}>{section}</span>
    </div>
    <div style={{ fontFamily: F.body, fontSize: 12, color: t.dim, lineHeight: "18px" }}>{snippet}</div>
  </div>
);

const KeyboardShortcut = ({ keys, label }) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0" }}>
    <span style={{ fontFamily: F.body, fontSize: 13, color: t.muted }}>{label}</span>
    <div style={{ display: "flex", gap: 4 }}>
      {keys.map((k, i) => <KbdBadge key={i}>{k}</KbdBadge>)}
    </div>
  </div>
);

// ─────────────────────────────────────────────
//  ORGANISMS
// ─────────────────────────────────────────────

const CommandPalette = ({ open, onClose }) => {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);

  const allResults = [
    { title: ".styles()", section: "Reference", snippet: "Define base CSS that applies to all instances of a component" },
    { title: ".variant()", section: "Reference", snippet: "Define named variants with CSS for each option" },
    { title: ".compound()", section: "Reference", snippet: "Apply CSS when specific variant combinations are active" },
    { title: "Theming & Tokens", section: "Architecture", snippet: "Configure design tokens, color scales, and spacing" },
    { title: "createTheme()", section: "Reference", snippet: "Generate a theme from token definitions" },
    { title: "Vite Plugin", section: "Integration", snippet: "Zero-config setup for Vite-based projects" },
    { title: "Color Modes", section: "Architecture", snippet: "Light, dark, and custom color mode support" },
    { title: "Base Styling", section: "Authoring", snippet: "Start with base styles before adding variants" },
  ];

  const filtered = query
    ? allResults.filter(r => (r.title + r.snippet).toLowerCase().includes(query.toLowerCase()))
    : allResults;

  useEffect(() => {
    if (open) { inputRef.current?.focus(); setQuery(""); setActiveIdx(0); }
  }, [open]);

  useEffect(() => { setActiveIdx(0); }, [query]);

  if (!open) return null;

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      paddingTop: 120, zIndex: 200, backdropFilter: "blur(4px)",
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 520, background: t.raised, border: `1px solid ${t.border}`,
        borderRadius: 12, overflow: "hidden",
        boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
      }}>
        {/* Search input */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "14px 18px", borderBottom: `1px solid ${t.border}`,
        }}>
          <svg width="16" height="16" viewBox="0 0 16 16" style={{ flexShrink: 0 }}>
            <circle cx="7" cy="7" r="4.5" stroke={t.dim} strokeWidth="1.3" fill="none"/>
            <path d="M10.5 10.5L14 14" stroke={t.dim} strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          <input
            ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search documentation..."
            style={{
              flex: 1, background: "none", border: "none", outline: "none",
              color: t.text, fontFamily: F.body, fontSize: 15,
            }}
          />
          <KbdBadge>esc</KbdBadge>
        </div>

        {/* Results */}
        <div style={{ maxHeight: 360, overflowY: "auto", padding: "4px 0" }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "32px 18px", textAlign: "center", color: t.dim, fontFamily: F.body, fontSize: 13 }}>
              No results for "{query}"
            </div>
          ) : (
            filtered.map((r, i) => (
              <SearchResultItem key={i} {...r} active={i === activeIdx} />
            ))
          )}
        </div>

        {/* Footer shortcuts */}
        <div style={{
          display: "flex", gap: 16, padding: "8px 18px",
          borderTop: `1px solid ${t.border}`, background: t.surface,
        }}>
          {[
            { keys: ["↑", "↓"], label: "navigate" },
            { keys: ["↵"], label: "open" },
            { keys: ["esc"], label: "close" },
          ].map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ display: "flex", gap: 2 }}>{s.keys.map((k, j) => <KbdBadge key={j}>{k}</KbdBadge>)}</div>
              <span style={{ fontFamily: F.code, fontSize: 10, color: t.dim }}>{s.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const ScrollSpyTOC = ({ items, activeId }) => (
  <nav style={{ position: "sticky", top: 40 }}>
    <div style={{ fontFamily: F.display, fontSize: 10, fontWeight: 700, color: t.dim, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 12 }}>
      On this page
    </div>
    <div style={{ borderLeft: `1px solid ${t.border}` }}>
      {items.map((item, i) => (
        <a key={i} href={`#${item.id}`} style={{
          display: "block", padding: `5px 16px 5px ${16 + (item.depth || 0) * 12}px`,
          fontFamily: item.id.startsWith(".") || item.id.startsWith("create") ? F.code : F.body,
          fontSize: 13, textDecoration: "none",
          color: activeId === item.id ? t.accent : t.dim,
          borderLeft: activeId === item.id ? `2px solid ${t.accent}` : "2px solid transparent",
          marginLeft: -1, transition: "all 0.1s",
        }}>{item.label}</a>
      ))}
    </div>
  </nav>
);

const PageFooter = ({ prev, next }) => (
  <footer style={{ marginTop: 64, paddingTop: 0 }}>
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "12px 0", borderTop: `1px solid ${t.border}`,
      marginBottom: 16,
    }}>
      <FeedbackWidget />
      <a href="#" style={{
        display: "flex", alignItems: "center", gap: 6,
        fontFamily: F.code, fontSize: 12, color: t.dim,
        textDecoration: "none", transition: "color 0.1s",
      }}
        onMouseEnter={e => e.currentTarget.style.color = t.muted}
        onMouseLeave={e => e.currentTarget.style.color = t.dim}
      >
        <svg width="14" height="14" viewBox="0 0 16 16"><path d="M8 1C4.13 1 1 4.13 1 8s3.13 7 7 7 7-3.13 7-7-3.13-7-7-7zM5.5 10.5L4 9l4-4 4 4-1.5 1.5L8 8l-2.5 2.5z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        Edit on GitHub
      </a>
    </div>
    <PrevNextNav prev={prev} next={next} />
  </footer>
);

const MobileNavHeader = () => {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "12px 20px", background: t.surface,
      borderBottom: `1px solid ${t.border}`,
      position: "sticky", top: 0, zIndex: 100,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => setMenuOpen(!menuOpen)} style={{
          background: "none", border: "none", cursor: "pointer", padding: 4,
          display: "flex", flexDirection: "column", gap: 3,
        }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: 18, height: 1.5, background: t.muted, borderRadius: 1,
              transform: menuOpen
                ? i === 0 ? "rotate(45deg) translate(3px,3px)" : i === 2 ? "rotate(-45deg) translate(3px,-3px)" : "scaleX(0)"
                : "none",
              transition: "all 0.2s",
            }} />
          ))}
        </button>
        <span style={{ fontFamily: F.display, fontSize: 15, fontWeight: 700, color: t.accent }}>ds</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <ThemeToggle />
        <VersionSelector />
      </div>
    </header>
  );
};

const KeyboardShortcutsPanel = () => (
  <div style={{
    padding: 20, background: t.surface, border: `1px solid ${t.border}`,
    borderRadius: 8, maxWidth: 320,
  }}>
    <div style={{ fontFamily: F.display, fontSize: 12, fontWeight: 700, color: t.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
      Keyboard shortcuts
    </div>
    <div style={{ display: "flex", flexDirection: "column" }}>
      <KeyboardShortcut keys={["⌘", "K"]} label="Open search" />
      <KeyboardShortcut keys={["/"]} label="Focus search" />
      <KeyboardShortcut keys={["←"]} label="Previous page" />
      <KeyboardShortcut keys={["→"]} label="Next page" />
      <KeyboardShortcut keys={["t"]} label="Toggle theme" />
      <KeyboardShortcut keys={["?"]} label="Show shortcuts" />
    </div>
  </div>
);

const ChangelogTimeline = ({ entries }) => (
  <div style={{ position: "relative", paddingLeft: 28 }}>
    <div style={{ position: "absolute", left: 7, top: 8, bottom: 8, width: 1, background: t.border }} />
    {entries.map((entry, i) => (
      <div key={i} style={{ position: "relative", marginBottom: 28 }}>
        <div style={{
          position: "absolute", left: -22, top: 6, width: 10, height: 10,
          borderRadius: "50%", border: `2px solid ${
            entry.type === "breaking" ? t.accent : entry.type === "feature" ? t.teal : t.dim
          }`,
          background: t.bg,
        }} />
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <VersionBadge version={entry.version} status={entry.type === "breaking" ? "deprecated" : "stable"} />
          <span style={{ fontFamily: F.code, fontSize: 11, color: t.dim }}>{entry.date}</span>
        </div>
        <div style={{ fontFamily: F.body, fontSize: 14, color: t.text, fontWeight: 500, marginBottom: 4 }}>
          {entry.title}
        </div>
        <div style={{ fontFamily: F.body, fontSize: 13, color: t.muted, lineHeight: "20px" }}>
          {entry.description}
        </div>
      </div>
    ))}
  </div>
);


// ─────────────────────────────────────────────
//  SHOWCASE
// ─────────────────────────────────────────────

export default function DocAtoms() {
  const [cmdOpen, setCmdOpen] = useState(false);
  const [activeTocId, setActiveTocId] = useState("chain-order");

  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setCmdOpen(true); }
      if (e.key === "Escape") setCmdOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const tocItems = [
    { id: "chain-order", label: "Chain order" },
    { id: ".styles", label: ".styles(css)", depth: 1 },
    { id: ".variant", label: ".variant(config)", depth: 1 },
    { id: ".compound", label: ".compound()", depth: 1 },
    { id: "terminals", label: "Terminals" },
    { id: "changelog", label: "Changelog" },
  ];

  const changelogEntries = [
    { version: "v2.4.0", date: "2025-12-01", type: "feature", title: "Conditional compound shorthand", description: "Compound variants now accept array conditions for matching multiple variant keys simultaneously." },
    { version: "v2.3.0", date: "2025-10-15", type: "breaking", title: ".states() map signature changed", description: "The states map now uses CSS selectors as keys instead of state names. Migration guide available." },
    { version: "v2.2.1", date: "2025-09-28", type: "fix", title: "Layer specificity fix", description: "Fixed edge case where compound styles could leak into the base layer." },
  ];

  const swatches = [
    { token: "--ds-accent", color: t.accent },
    { token: "--ds-teal", color: t.teal },
    { token: "--ds-amber", color: t.amber },
    { token: "--ds-purple", color: t.purple },
    { token: "--ds-blue", color: t.blue },
    { token: "--ds-pink", color: t.pink },
  ];

  return (
    <div style={{ fontFamily: F.body, color: t.text, background: t.bg, minHeight: "100vh" }}>
      <link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />

      <ProgressBar progress={0.38} />
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />

      <div style={{ display: "flex", gap: 0 }}>
        {/* Main column */}
        <div style={{ flex: 1, maxWidth: 780, padding: "24px 48px 80px", minWidth: 0 }}>

          {/* Mobile Header demo */}
          <div style={{ marginBottom: 48 }}>
            <div style={{ fontFamily: F.display, fontSize: 10, fontWeight: 700, color: t.dim, textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: 20 }}>
              ━━ Organisms
            </div>

            <div style={{ fontFamily: F.display, fontSize: 13, color: t.muted, fontWeight: 700, marginBottom: 10 }}>Mobile nav header</div>
            <div style={{ borderRadius: 8, overflow: "hidden", border: `1px solid ${t.border}` }}>
              <MobileNavHeader />
            </div>
          </div>

          {/* Command palette trigger */}
          <div style={{ marginBottom: 48 }}>
            <div style={{ fontFamily: F.display, fontSize: 13, color: t.muted, fontWeight: 700, marginBottom: 10 }}>Command palette</div>
            <button onClick={() => setCmdOpen(true)} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 16px", width: "100%", maxWidth: 380,
              background: t.surface, border: `1px solid ${t.border}`,
              borderRadius: 8, cursor: "pointer", transition: "border-color 0.15s",
            }}
              onMouseEnter={e => e.currentTarget.style.borderColor = t.borderActive}
              onMouseLeave={e => e.currentTarget.style.borderColor = t.border}
            >
              <svg width="14" height="14" viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5" stroke={t.dim} strokeWidth="1.3" fill="none"/><path d="M10.5 10.5L14 14" stroke={t.dim} strokeWidth="1.3" strokeLinecap="round"/></svg>
              <span style={{ fontFamily: F.body, fontSize: 14, color: t.dim, flex: 1, textAlign: "left" }}>Search documentation...</span>
              <div style={{ display: "flex", gap: 3 }}><KbdBadge>⌘</KbdBadge><KbdBadge>K</KbdBadge></div>
            </button>
          </div>

          <Separator />

          {/* Atoms */}
          <div style={{ marginBottom: 48 }}>
            <div style={{ fontFamily: F.display, fontSize: 10, fontWeight: 700, color: t.dim, textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: 20 }}>
              ━━ Atoms
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
              {/* Status dots & version badges */}
              <div>
                <div style={{ fontFamily: F.display, fontSize: 13, color: t.muted, fontWeight: 700, marginBottom: 12 }}>Status indicators</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                  <VersionBadge version="v2.4.0" status="stable" />
                  <VersionBadge version="v3.0.0-beta" status="beta" />
                  <VersionBadge version="v1.9.8" status="deprecated" />
                  <VersionBadge version="v2.5.0-next" status="new" />
                </div>
              </div>

              {/* Kbd badges */}
              <div>
                <div style={{ fontFamily: F.display, fontSize: 13, color: t.muted, fontWeight: 700, marginBottom: 12 }}>Keyboard hints</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                  <KbdBadge>⌘</KbdBadge><KbdBadge>K</KbdBadge>
                  <span style={{ color: t.dim, margin: "0 8px" }}>|</span>
                  <KbdBadge>↑</KbdBadge><KbdBadge>↓</KbdBadge><KbdBadge>↵</KbdBadge>
                  <span style={{ color: t.dim, margin: "0 8px" }}>|</span>
                  <KbdBadge>esc</KbdBadge>
                  <span style={{ color: t.dim, margin: "0 8px" }}>|</span>
                  <KbdBadge>shift</KbdBadge><KbdBadge>?</KbdBadge>
                </div>
              </div>

              {/* Copy buttons */}
              <div>
                <div style={{ fontFamily: F.display, fontSize: 13, color: t.muted, fontWeight: 700, marginBottom: 12 }}>Copy actions</div>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <CopyButton text="npm install ds" size="sm" />
                  <CopyButton text="npm install ds" size="md" />
                  <ThemeToggle />
                </div>
              </div>

              {/* Changed badge */}
              <div>
                <div style={{ fontFamily: F.display, fontSize: 13, color: t.muted, fontWeight: 700, marginBottom: 12 }}>Inline changelog markers</div>
                <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: F.code, fontSize: 14, color: t.amber }}>.compound()</span>
                  <ChangedBadge version="v2.3" />
                  <span style={{ fontFamily: F.body, fontSize: 13, color: t.dim, marginLeft: 12 }}>— hover for migration notes</span>
                </div>
              </div>

              {/* Language pills */}
              <div>
                <div style={{ fontFamily: F.display, fontSize: 13, color: t.muted, fontWeight: 700, marginBottom: 12 }}>Language switcher (persistent)</div>
                <LanguageSwitcher />
              </div>

              {/* Token swatches */}
              <div>
                <div style={{ fontFamily: F.display, fontSize: 13, color: t.muted, fontWeight: 700, marginBottom: 12 }}>Token swatches</div>
                <TokenSwatchRow tokens={swatches} />
              </div>
            </div>
          </div>

          <Separator />

          {/* Molecules */}
          <div style={{ marginBottom: 48 }}>
            <div style={{ fontFamily: F.display, fontSize: 10, fontWeight: 700, color: t.dim, textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: 20 }}>
              ━━ Molecules
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
              {/* Breadcrumb */}
              <div>
                <div style={{ fontFamily: F.display, fontSize: 13, color: t.muted, fontWeight: 700, marginBottom: 12 }}>Breadcrumb</div>
                <Breadcrumb items={["Docs", "Reference", "Builder Chain", ".compound()"]} />
              </div>

              {/* Anchor headings */}
              <div>
                <div style={{ fontFamily: F.display, fontSize: 13, color: t.muted, fontWeight: 700, marginBottom: 0 }}>Anchor headings (hover for link)</div>
                <AnchorHeading level={2} id="chain-order">Chain order</AnchorHeading>
                <AnchorHeading level={3} id="styles">.styles(css)</AnchorHeading>
                <AnchorHeading level={3} id="compound" changed="v2.3">.compound(condition, css)</AnchorHeading>
              </div>

              {/* Version selector */}
              <div>
                <div style={{ fontFamily: F.display, fontSize: 13, color: t.muted, fontWeight: 700, marginBottom: 12 }}>Version selector</div>
                <VersionSelector />
              </div>

              {/* Feedback */}
              <div>
                <div style={{ fontFamily: F.display, fontSize: 13, color: t.muted, fontWeight: 700, marginBottom: 4 }}>Page feedback</div>
                <FeedbackWidget />
              </div>

              {/* Keyboard shortcuts panel */}
              <div>
                <div style={{ fontFamily: F.display, fontSize: 13, color: t.muted, fontWeight: 700, marginBottom: 12 }}>Shortcuts panel</div>
                <KeyboardShortcutsPanel />
              </div>
            </div>
          </div>

          <Separator />

          {/* Organisms */}
          <div style={{ marginBottom: 48 }}>
            <div style={{ fontFamily: F.display, fontSize: 10, fontWeight: 700, color: t.dim, textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: 20 }}>
              ━━ Organisms
            </div>

            {/* Changelog */}
            <div style={{ marginBottom: 40 }}>
              <div style={{ fontFamily: F.display, fontSize: 13, color: t.muted, fontWeight: 700, marginBottom: 16 }}>Changelog timeline</div>
              <ChangelogTimeline entries={changelogEntries} />
            </div>

            {/* Page footer */}
            <div>
              <div style={{ fontFamily: F.display, fontSize: 13, color: t.muted, fontWeight: 700, marginBottom: 8 }}>Page footer</div>
              <PageFooter prev="Variants & States" next="createTheme()" />
            </div>
          </div>
        </div>

        {/* Right rail - Scroll Spy TOC */}
        <div style={{ width: 200, flexShrink: 0, padding: "40px 20px 40px 0" }}>
          <ScrollSpyTOC items={tocItems} activeId={activeTocId} />
        </div>
      </div>
    </div>
  );
}
