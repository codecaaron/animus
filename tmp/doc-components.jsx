import { useState, useRef, useEffect, useCallback } from "react";

const FONT_DISPLAY = "'Space Mono', monospace";
const FONT_BODY = "'DM Sans', sans-serif";
const FONT_CODE = "'JetBrains Mono', monospace";

const theme = {
  bg: "#0c0b0a",
  surface: "#151413",
  surfaceRaised: "#1a1918",
  surfaceHover: "#221f1e",
  border: "#2a2725",
  borderActive: "#4a4540",
  text: "#e8e2d9",
  textMuted: "#9c9488",
  textDim: "#5c5750",
  accent: "#e8593c",
  accentDim: "#a33d28",
  accentGlow: "rgba(232,89,60,0.12)",
  amber: "#ef9f27",
  amberDim: "#a36d1a",
  teal: "#1d9e75",
  tealDim: "#0f6e56",
  purple: "#7f77dd",
  purpleDim: "#534ab7",
  blue: "#378add",
  pink: "#d4537e",
};

const TokenBadge = ({ children, variant = "method" }) => {
  const colors = {
    method: { bg: theme.accentGlow, border: theme.accentDim, text: theme.accent },
    layer: { bg: "rgba(29,158,117,0.12)", border: theme.tealDim, text: theme.teal },
    type: { bg: "rgba(127,119,221,0.12)", border: theme.purpleDim, text: theme.purple },
    prop: { bg: "rgba(239,159,39,0.12)", border: theme.amberDim, text: theme.amber },
    tag: { bg: "rgba(55,138,221,0.12)", border: "#185fa5", text: theme.blue },
    danger: { bg: "rgba(232,89,60,0.08)", border: theme.accentDim, text: theme.accent },
    success: { bg: "rgba(29,158,117,0.08)", border: theme.tealDim, text: theme.teal },
  };
  const c = colors[variant] || colors.method;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 10px", fontSize: 12, fontFamily: FONT_CODE,
      background: c.bg, border: `1px solid ${c.border}`,
      color: c.text, borderRadius: 4, lineHeight: "20px",
      letterSpacing: "0.02em", whiteSpace: "nowrap",
    }}>{children}</span>
  );
};

const ChainStep = ({ label, layer, active, onClick, connector }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
    <button onClick={onClick} style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
      padding: "10px 16px", background: active ? theme.accentGlow : "transparent",
      border: `1px solid ${active ? theme.accent : theme.border}`,
      borderRadius: 6, cursor: "pointer", transition: "all 0.15s",
      minWidth: 90,
    }}>
      <span style={{ fontFamily: FONT_CODE, fontSize: 13, color: active ? theme.accent : theme.text, fontWeight: 500 }}>{label}</span>
      <span style={{ fontFamily: FONT_CODE, fontSize: 10, color: active ? theme.accentDim : theme.textDim, textTransform: "uppercase", letterSpacing: "0.08em" }}>{layer}</span>
    </button>
    {connector && (
      <svg width="28" height="12" style={{ flexShrink: 0 }}>
        <line x1="2" y1="6" x2="20" y2="6" stroke={theme.textDim} strokeWidth="1" />
        <polygon points="19,3 25,6 19,9" fill={theme.textDim} />
      </svg>
    )}
  </div>
);

const SyntaxLine = ({ tokens }) => (
  <div style={{ display: "flex", flexWrap: "wrap", gap: 0, lineHeight: "24px" }}>
    {tokens.map((t, i) => (
      <span key={i} style={{
        color: t.type === "keyword" ? theme.accent :
               t.type === "method" ? theme.amber :
               t.type === "string" ? theme.teal :
               t.type === "comment" ? theme.textDim :
               t.type === "type" ? theme.purple :
               t.type === "punct" ? theme.textDim :
               t.type === "param" ? theme.blue :
               theme.text,
        fontStyle: t.type === "comment" ? "italic" : "normal",
      }}>{t.value}</span>
    ))}
  </div>
);

const CodeBlock = ({ lines, title, language = "ts", collapsible = false }) => {
  const [collapsed, setCollapsed] = useState(collapsible);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const raw = lines.map(l => l.map(t => t.value).join("")).join("\n");
    navigator.clipboard?.writeText(raw);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div style={{
      border: `1px solid ${theme.border}`, borderRadius: 8,
      overflow: "hidden", background: theme.bg,
    }}>
      {title && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 16px", borderBottom: `1px solid ${theme.border}`,
          background: theme.surface,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {collapsible && (
              <button onClick={() => setCollapsed(!collapsed)} style={{
                background: "none", border: "none", color: theme.textDim,
                cursor: "pointer", fontSize: 11, padding: 0, fontFamily: FONT_CODE,
                transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
                transition: "transform 0.15s",
              }}>▼</button>
            )}
            <span style={{ fontFamily: FONT_CODE, fontSize: 12, color: theme.textMuted }}>{title}</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontFamily: FONT_CODE, fontSize: 10, color: theme.textDim, textTransform: "uppercase", letterSpacing: "0.1em" }}>{language}</span>
            <button onClick={handleCopy} style={{
              background: "none", border: `1px solid ${theme.border}`,
              color: copied ? theme.teal : theme.textDim, cursor: "pointer",
              fontSize: 11, padding: "2px 8px", borderRadius: 4, fontFamily: FONT_CODE,
              transition: "all 0.15s",
            }}>{copied ? "✓" : "copy"}</button>
          </div>
        </div>
      )}
      {!collapsed && (
        <div style={{ padding: "14px 16px", fontFamily: FONT_CODE, fontSize: 13, overflowX: "auto" }}>
          {lines.map((line, i) => (
            <div key={i} style={{ display: "flex", gap: 16, minHeight: 24 }}>
              <span style={{ color: theme.textDim, minWidth: 24, textAlign: "right", userSelect: "none", fontSize: 12, lineHeight: "24px" }}>{i + 1}</span>
              <SyntaxLine tokens={line} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const ParamTable = ({ params }) => (
  <div style={{ border: `1px solid ${theme.border}`, borderRadius: 8, overflow: "hidden" }}>
    <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: FONT_CODE, fontSize: 13 }}>
      <thead>
        <tr style={{ background: theme.surface }}>
          {["Parameter", "Type", "Default", "Description"].map(h => (
            <th key={h} style={{
              textAlign: "left", padding: "10px 14px", color: theme.textDim,
              fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em",
              fontWeight: 500, borderBottom: `1px solid ${theme.border}`,
            }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {params.map((p, i) => (
          <tr key={i} style={{ borderBottom: i < params.length - 1 ? `1px solid ${theme.border}` : "none" }}>
            <td style={{ padding: "10px 14px", color: theme.amber }}>{p.name}</td>
            <td style={{ padding: "10px 14px" }}><TokenBadge variant="type">{p.type}</TokenBadge></td>
            <td style={{ padding: "10px 14px", color: p.default === "required" ? theme.accent : theme.textDim }}>{p.default}</td>
            <td style={{ padding: "10px 14px", color: theme.textMuted, fontFamily: FONT_BODY, fontSize: 13 }}>{p.desc}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const TypeSignature = ({ name, generics, params, returns }) => (
  <div style={{
    padding: "14px 18px", background: theme.surface,
    border: `1px solid ${theme.border}`, borderLeft: `3px solid ${theme.accent}`,
    borderRadius: "0 8px 8px 0", fontFamily: FONT_CODE, fontSize: 13,
    display: "flex", flexWrap: "wrap", gap: 2, lineHeight: "26px",
  }}>
    <span style={{ color: theme.accent, fontWeight: 600 }}>{name}</span>
    {generics && <span style={{ color: theme.purple }}>&lt;{generics}&gt;</span>}
    <span style={{ color: theme.textDim }}>(</span>
    {params.map((p, i) => (
      <span key={i}>
        <span style={{ color: theme.blue }}>{p.name}</span>
        <span style={{ color: theme.textDim }}>: </span>
        <span style={{ color: theme.purple }}>{p.type}</span>
        {i < params.length - 1 && <span style={{ color: theme.textDim }}>, </span>}
      </span>
    ))}
    <span style={{ color: theme.textDim }}>)</span>
    <span style={{ color: theme.textDim }}> → </span>
    <span style={{ color: theme.teal }}>{returns}</span>
  </div>
);

const Callout = ({ variant = "info", title, children }) => {
  const styles = {
    info: { border: theme.blue, bg: "rgba(55,138,221,0.06)", icon: "ℹ", color: theme.blue },
    warn: { border: theme.amber, bg: "rgba(239,159,39,0.06)", icon: "⚠", color: theme.amber },
    danger: { border: theme.accent, bg: "rgba(232,89,60,0.06)", icon: "✕", color: theme.accent },
    tip: { border: theme.teal, bg: "rgba(29,158,117,0.06)", icon: "→", color: theme.teal },
  };
  const s = styles[variant];
  return (
    <div style={{
      borderLeft: `3px solid ${s.border}`, background: s.bg,
      padding: "14px 18px", borderRadius: "0 8px 8px 0",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: title ? 6 : 0 }}>
        <span style={{ color: s.color, fontFamily: FONT_CODE, fontSize: 14, fontWeight: 700 }}>{s.icon}</span>
        {title && <span style={{ color: s.color, fontFamily: FONT_DISPLAY, fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>{title}</span>}
      </div>
      <div style={{ color: theme.textMuted, fontFamily: FONT_BODY, fontSize: 14, lineHeight: "22px" }}>{children}</div>
    </div>
  );
};

const TabGroup = ({ tabs, activeTab, onChange }) => (
  <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${theme.border}` }}>
    {tabs.map(t => (
      <button key={t} onClick={() => onChange(t)} style={{
        padding: "10px 20px", background: "none", border: "none",
        borderBottom: activeTab === t ? `2px solid ${theme.accent}` : "2px solid transparent",
        color: activeTab === t ? theme.text : theme.textDim,
        fontFamily: FONT_CODE, fontSize: 13, cursor: "pointer",
        transition: "all 0.12s", marginBottom: -1,
      }}>{t}</button>
    ))}
  </div>
);

const LivePreview = ({ code, preview }) => {
  const [tab, setTab] = useState("preview");
  return (
    <div style={{ border: `1px solid ${theme.border}`, borderRadius: 8, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 4px", background: theme.surface, borderBottom: `1px solid ${theme.border}` }}>
        <TabGroup tabs={["preview", "code"]} activeTab={tab} onChange={setTab} />
      </div>
      {tab === "preview" ? (
        <div style={{ padding: 24, background: theme.bg, minHeight: 80 }}>
          {preview}
        </div>
      ) : (
        <div style={{ background: theme.bg }}>{code}</div>
      )}
    </div>
  );
};

const NavItem = ({ label, active, depth = 0, items, category }) => {
  const [open, setOpen] = useState(active || false);
  if (category) {
    return (
      <div style={{ marginTop: 20, marginBottom: 6 }}>
        <span style={{
          fontFamily: FONT_DISPLAY, fontSize: 10, fontWeight: 700,
          color: theme.textDim, textTransform: "uppercase", letterSpacing: "0.12em",
          paddingLeft: 16,
        }}>{label}</span>
      </div>
    );
  }
  return (
    <div>
      <button onClick={() => items ? setOpen(!open) : null} style={{
        display: "flex", alignItems: "center", gap: 8, width: "100%",
        padding: `6px 16px 6px ${16 + depth * 14}px`,
        background: active ? theme.accentGlow : "transparent",
        border: "none", borderLeft: active ? `2px solid ${theme.accent}` : "2px solid transparent",
        color: active ? theme.text : theme.textMuted,
        fontFamily: FONT_BODY, fontSize: 13, cursor: "pointer",
        transition: "all 0.1s", textAlign: "left",
      }}>
        {items && <span style={{ fontSize: 9, color: theme.textDim, transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>▶</span>}
        {label}
      </button>
      {open && items?.map((item, i) => <NavItem key={i} {...item} depth={depth + 1} />)}
    </div>
  );
};

const MethodCard = ({ name, description, returnType, example, available }) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{
      border: `1px solid ${theme.border}`, borderRadius: 8,
      overflow: "hidden", transition: "border-color 0.15s",
    }}>
      <button onClick={() => setExpanded(!expanded)} style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        width: "100%", padding: "14px 18px", background: theme.surface,
        border: "none", cursor: "pointer", gap: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
          <span style={{ fontFamily: FONT_CODE, fontSize: 14, color: theme.accent, fontWeight: 600 }}>.{name}</span>
          <span style={{ color: theme.textDim, fontSize: 13, fontFamily: FONT_BODY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{description}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <TokenBadge variant="type">{returnType}</TokenBadge>
          <span style={{
            fontSize: 12, color: theme.textDim, fontFamily: FONT_CODE,
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.15s",
          }}>▼</span>
        </div>
      </button>
      {expanded && (
        <div style={{ padding: "0 18px 18px", background: theme.surface, borderTop: `1px solid ${theme.border}` }}>
          <div style={{ paddingTop: 14 }}>
            {available && (
              <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontFamily: FONT_CODE, fontSize: 11, color: theme.textDim }}>available after</span>
                <TokenBadge variant="method">{available}</TokenBadge>
              </div>
            )}
            {example}
          </div>
        </div>
      )}
    </div>
  );
};

const StepIndicator = ({ steps, current }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
    {steps.map((s, i) => (
      <div key={i} style={{ display: "flex", alignItems: "center" }}>
        <div style={{
          width: 28, height: 28, borderRadius: "50%", display: "flex",
          alignItems: "center", justifyContent: "center",
          background: i <= current ? theme.accent : theme.surface,
          border: `1px solid ${i <= current ? theme.accent : theme.border}`,
          color: i <= current ? "#fff" : theme.textDim,
          fontFamily: FONT_CODE, fontSize: 11, fontWeight: 600,
          transition: "all 0.2s",
        }}>{i + 1}</div>
        {i < steps.length - 1 && (
          <div style={{
            width: 32, height: 1,
            background: i < current ? theme.accent : theme.border,
            transition: "background 0.2s",
          }} />
        )}
      </div>
    ))}
  </div>
);

const SearchInput = () => {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, padding: "8px 14px",
      background: theme.surface, border: `1px solid ${focused ? theme.borderActive : theme.border}`,
      borderRadius: 8, transition: "border-color 0.15s",
    }}>
      <span style={{ color: theme.textDim, fontSize: 14 }}>⌕</span>
      <input
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        placeholder="Search docs..."
        style={{
          background: "none", border: "none", outline: "none", flex: 1,
          color: theme.text, fontFamily: FONT_BODY, fontSize: 14,
        }}
      />
      <span style={{
        fontFamily: FONT_CODE, fontSize: 11, color: theme.textDim,
        padding: "2px 6px", background: theme.bg, borderRadius: 4,
        border: `1px solid ${theme.border}`,
      }}>⌘K</span>
    </div>
  );
};

export default function DocComponents() {
  const [activeChainStep, setActiveChainStep] = useState(2);
  const [activeTab, setActiveTab] = useState("preview");

  const chainSteps = [
    { label: ".styles()", layer: "base" },
    { label: ".variant()", layer: "variants" },
    { label: ".compound()", layer: "compounds" },
    { label: ".states()", layer: "states" },
    { label: ".system()", layer: "system" },
    { label: ".props()", layer: "custom" },
  ];

  const exampleCode = [
    [{ type: "keyword", value: "const " }, { type: "text", value: "button " }, { type: "punct", value: "= " }, { type: "method", value: "ds" }, { type: "punct", value: "." }, { type: "method", value: "styles" }, { type: "punct", value: "({" }],
    [{ type: "text", value: "  " }, { type: "param", value: "base" }, { type: "punct", value: ": " }, { type: "string", value: "`" }],
    [{ type: "text", value: "    " }, { type: "string", value: "padding: 0.5rem 1rem;" }],
    [{ type: "text", value: "    " }, { type: "string", value: "border-radius: 6px;" }],
    [{ type: "text", value: "  " }, { type: "string", value: "`" }],
    [{ type: "punct", value: "})" }],
    [{ type: "punct", value: "." }, { type: "method", value: "variant" }, { type: "punct", value: "(" }, { type: "string", value: "'size'" }, { type: "punct", value: ", {" }],
    [{ type: "text", value: "  " }, { type: "param", value: "sm" }, { type: "punct", value: ": " }, { type: "string", value: "`font-size: 0.75rem`" }],
    [{ type: "text", value: "  " }, { type: "param", value: "lg" }, { type: "punct", value: ": " }, { type: "string", value: "`font-size: 1.125rem`" }],
    [{ type: "punct", value: "})" }],
    [{ type: "punct", value: "." }, { type: "method", value: "asElement" }, { type: "punct", value: "(" }, { type: "string", value: "'button'" }, { type: "punct", value: ")" }],
  ];

  const sampleParams = [
    { name: "condition", type: "string | string[]", default: "required", desc: "Variant keys to match against. Accepts single or multiple conditions." },
    { name: "css", type: "CSS", default: "required", desc: "Styles applied when all conditions match." },
    { name: "specificity", type: "number", default: "0", desc: "Override layer specificity for edge cases." },
  ];

  return (
    <div style={{ fontFamily: FONT_BODY, color: theme.text, background: theme.bg, minHeight: "100vh" }}>
      <link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />

      <div style={{ display: "flex", minHeight: "100vh" }}>
        {/* Sidebar */}
        <aside style={{
          width: 240, flexShrink: 0, borderRight: `1px solid ${theme.border}`,
          padding: "20px 0", background: theme.surface, overflowY: "auto",
          position: "sticky", top: 0, height: "100vh",
        }}>
          <div style={{ padding: "0 16px 20px" }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 700, color: theme.accent, marginBottom: 4, letterSpacing: "-0.02em" }}>ds</div>
            <div style={{ fontFamily: FONT_CODE, fontSize: 10, color: theme.textDim }}>v2.4.0</div>
          </div>
          <div style={{ padding: "0 12px 16px" }}>
            <SearchInput />
          </div>
          <nav>
            <NavItem label="Getting started" category />
            <NavItem label="Introduction" />
            <NavItem label="Installation" />
            <NavItem label="Architecture" category />
            <NavItem label="Theming & Tokens" />
            <NavItem label="Color Modes" />
            <NavItem label="Cascade Layers" />
            <NavItem label="Component authoring" category />
            <NavItem label="Base Styling" />
            <NavItem label="Variants & States" />
            <NavItem label="System Props" />
            <NavItem label="Composition" />
            <NavItem label="Reference" category />
            <NavItem label="Builder Chain" active items={[
              { label: ".styles()", active: true },
              { label: ".variant()" },
              { label: ".compound()" },
              { label: ".states()" },
            ]} />
            <NavItem label="createTheme()" />
            <NavItem label="compose()" />
          </nav>
        </aside>

        {/* Main Content */}
        <main style={{ flex: 1, padding: "40px 48px", maxWidth: 820, minWidth: 0 }}>
          {/* Page Header */}
          <div style={{ marginBottom: 48 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span style={{ fontFamily: FONT_CODE, fontSize: 11, color: theme.textDim, textTransform: "uppercase", letterSpacing: "0.1em" }}>Reference</span>
              <span style={{ color: theme.textDim }}>/</span>
            </div>
            <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 32, fontWeight: 700, color: theme.text, margin: "0 0 12px", letterSpacing: "-0.03em" }}>
              Builder Chain
            </h1>
            <p style={{ color: theme.textMuted, fontSize: 16, lineHeight: "26px", margin: 0, maxWidth: 560 }}>
              The builder chain is a type-state machine. Each method returns a narrower type, enforcing cascade order at the type level.
            </p>
          </div>

          {/* Section: Chain Order */}
          <section style={{ marginBottom: 48 }}>
            <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, color: theme.text, margin: "0 0 20px", letterSpacing: "-0.01em" }}>
              Chain order
            </h2>

            {/* Interactive Chain Visualization */}
            <div style={{
              padding: 24, background: theme.surface, borderRadius: 12,
              border: `1px solid ${theme.border}`, marginBottom: 20,
            }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0, marginBottom: 20 }}>
                {chainSteps.map((s, i) => (
                  <ChainStep
                    key={i}
                    label={s.label}
                    layer={s.layer}
                    active={i === activeChainStep}
                    onClick={() => setActiveChainStep(i)}
                    connector={i < chainSteps.length - 1}
                  />
                ))}
              </div>

              <div style={{
                padding: 16, background: theme.bg, borderRadius: 8,
                border: `1px solid ${theme.border}`,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <TokenBadge variant="method">{chainSteps[activeChainStep].label}</TokenBadge>
                  <span style={{ color: theme.textDim, fontFamily: FONT_CODE, fontSize: 12 }}>→</span>
                  <TokenBadge variant="layer">@layer {chainSteps[activeChainStep].layer}</TokenBadge>
                </div>
                <p style={{ color: theme.textMuted, fontSize: 13, margin: 0, lineHeight: "20px" }}>
                  {activeChainStep === 0 && "Entry point. Define base CSS that applies to all instances. Cannot be repeated."}
                  {activeChainStep === 1 && "Define named variants with CSS for each option. Repeatable for multiple variant axes."}
                  {activeChainStep === 2 && "Apply CSS when specific variant combinations are active. Repeatable."}
                  {activeChainStep === 3 && "Map interactive states (hover, focus, disabled) to style changes."}
                  {activeChainStep === 4 && "Bind design system tokens like spacing, colors, breakpoints."}
                  {activeChainStep === 5 && "Custom props passed at runtime. Ends the chain before terminal."}
                </p>
              </div>
            </div>

            <Callout variant="tip" title="Terminal methods">
              <code style={{ fontFamily: FONT_CODE, color: theme.amber, fontSize: 13 }}>.asElement()</code>, <code style={{ fontFamily: FONT_CODE, color: theme.amber, fontSize: 13 }}>.asComponent()</code>, and <code style={{ fontFamily: FONT_CODE, color: theme.amber, fontSize: 13 }}>.asClass()</code> are available at any point after <code style={{ fontFamily: FONT_CODE, color: theme.accent, fontSize: 13 }}>.styles()</code>.
            </Callout>
          </section>

          {/* Section: Type Signature */}
          <section style={{ marginBottom: 48 }}>
            <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, color: theme.text, margin: "0 0 16px" }}>
              .compound()
            </h2>
            <TypeSignature
              name=".compound"
              generics="V extends VariantMap"
              params={[
                { name: "condition", type: "keyof V | (keyof V)[]" },
                { name: "css", type: "CSS" },
              ]}
              returns="CompoundBuilder<V>"
            />

            <div style={{ marginTop: 20 }}>
              <ParamTable params={sampleParams} />
            </div>
          </section>

          {/* Section: Live Example */}
          <section style={{ marginBottom: 48 }}>
            <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, color: theme.text, margin: "0 0 16px" }}>
              Usage
            </h2>
            <LivePreview
              preview={
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <button style={{
                    padding: "8px 20px", borderRadius: 6, border: "none",
                    background: theme.accent, color: "#fff", fontFamily: FONT_BODY,
                    fontSize: 14, cursor: "pointer",
                  }}>Default</button>
                  <button style={{
                    padding: "6px 14px", borderRadius: 6, border: "none",
                    background: theme.accent, color: "#fff", fontFamily: FONT_BODY,
                    fontSize: 12, cursor: "pointer",
                  }}>Small</button>
                  <button style={{
                    padding: "10px 28px", borderRadius: 6, border: "none",
                    background: theme.accent, color: "#fff", fontFamily: FONT_BODY,
                    fontSize: 16, cursor: "pointer",
                  }}>Large</button>
                </div>
              }
              code={
                <CodeBlock lines={exampleCode} title="button.ts" language="ts" />
              }
            />
          </section>

          {/* Section: Method Cards (Expandable API Reference) */}
          <section style={{ marginBottom: 48 }}>
            <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, color: theme.text, margin: "0 0 16px" }}>
              API reference
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <MethodCard
                name="styles(css)"
                description="Define base styles for the component"
                returnType="StylesBuilder"
                available="entry point"
                example={
                  <CodeBlock lines={exampleCode.slice(0, 6)} title="example" language="ts" />
                }
              />
              <MethodCard
                name="variant(name, map)"
                description="Add a named variant axis with style options"
                returnType="VariantBuilder"
                available=".styles()"
                example={
                  <CodeBlock lines={exampleCode.slice(6, 10)} title="example" language="ts" />
                }
              />
              <MethodCard
                name="compound(condition, css)"
                description="Apply styles when multiple variants match"
                returnType="CompoundBuilder"
                available=".variant()"
                example={
                  <Callout variant="info">
                    Compound conditions are checked in declaration order. Later compounds override earlier ones when conditions overlap.
                  </Callout>
                }
              />
            </div>
          </section>

          {/* Callout Variants */}
          <section style={{ marginBottom: 48 }}>
            <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, color: theme.text, margin: "0 0 16px" }}>
              Callout variants
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Callout variant="info" title="Info">Use this for supplementary context and cross-references.</Callout>
              <Callout variant="tip" title="Tip">Highlight best practices and recommended patterns.</Callout>
              <Callout variant="warn" title="Warning">Flag potential pitfalls or breaking changes.</Callout>
              <Callout variant="danger" title="Breaking">Critical information about migration or deprecation.</Callout>
            </div>
          </section>

          {/* Badge Inventory */}
          <section style={{ marginBottom: 48 }}>
            <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, color: theme.text, margin: "0 0 16px" }}>
              Token badges
            </h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: 20, background: theme.surface, borderRadius: 12, border: `1px solid ${theme.border}` }}>
              <TokenBadge variant="method">.styles()</TokenBadge>
              <TokenBadge variant="layer">@layer base</TokenBadge>
              <TokenBadge variant="type">VariantMap</TokenBadge>
              <TokenBadge variant="prop">size</TokenBadge>
              <TokenBadge variant="tag">HTMLButton</TokenBadge>
              <TokenBadge variant="danger">deprecated</TokenBadge>
              <TokenBadge variant="success">stable</TokenBadge>
            </div>
          </section>

          {/* Step Indicator */}
          <section style={{ marginBottom: 48 }}>
            <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, color: theme.text, margin: "0 0 16px" }}>
              Progress indicator
            </h2>
            <div style={{ padding: 24, background: theme.surface, borderRadius: 12, border: `1px solid ${theme.border}`, display: "flex", flexDirection: "column", gap: 20 }}>
              <StepIndicator steps={["Install", "Configure", "Create theme", "Author", "Ship"]} current={2} />
              <p style={{ color: theme.textMuted, fontSize: 13, margin: 0 }}>
                Step 3 of 5 — Creating your first theme using <code style={{ fontFamily: FONT_CODE, color: theme.amber }}>createTheme()</code>
              </p>
            </div>
          </section>

          {/* On This Page (TOC) */}
          <section style={{ marginBottom: 48 }}>
            <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 700, color: theme.text, margin: "0 0 16px" }}>
              Page TOC
            </h2>
            <div style={{
              padding: "16px 0", borderLeft: `1px solid ${theme.border}`,
            }}>
              {[
                { label: "Chain order", active: true },
                { label: ".styles(css)" },
                { label: ".variant(config)" },
                { label: ".compound(condition, css)" },
                { label: ".states(map)" },
                { label: ".system(groups)" },
                { label: ".props(config)" },
                { label: "Terminals" },
              ].map((item, i) => (
                <div key={i} style={{
                  padding: "5px 16px", fontSize: 13,
                  color: item.active ? theme.accent : theme.textMuted,
                  fontFamily: item.label.startsWith(".") ? FONT_CODE : FONT_BODY,
                  borderLeft: item.active ? `2px solid ${theme.accent}` : "2px solid transparent",
                  marginLeft: -1, cursor: "pointer",
                  transition: "color 0.1s",
                }}>{item.label}</div>
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
