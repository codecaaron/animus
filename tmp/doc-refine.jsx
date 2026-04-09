import { useState, useRef, useEffect, useCallback } from "react";

const F = {
  display: "'Space Mono', monospace",
  body: "'DM Sans', sans-serif",
  code: "'JetBrains Mono', monospace",
};

const t = {
  bg: "#0c0b0a", surface: "#141312", raised: "#1b1918", hover: "#231f1e",
  border: "#2a2725", borderHi: "#3d3935", borderActive: "#524c46",
  text: "#e8e2d9", muted: "#9c9488", dim: "#5c5750", ghost: "#373330",
  accent: "#e8593c", accentDim: "#a33d28", accentGlow: "rgba(232,89,60,0.12)",
  accentGlow2: "rgba(232,89,60,0.06)",
  amber: "#ef9f27", amberDim: "#a36d1a", amberGlow: "rgba(239,159,39,0.10)",
  teal: "#1d9e75", tealDim: "#0f6e56", tealGlow: "rgba(29,158,117,0.10)",
  purple: "#7f77dd", purpleDim: "#534ab7", purpleGlow: "rgba(127,119,221,0.10)",
  blue: "#378add", blueGlow: "rgba(55,138,221,0.10)",
  pink: "#d4537e", pinkGlow: "rgba(212,83,126,0.10)",
  green: "#639922", greenGlow: "rgba(99,153,34,0.10)",
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  1. CHAIN VISUALIZER — the big one
//     Yours is functional but reads flat.
//     This version: glowing active state, animated
//     connector pulses, expanded detail panel with
//     code preview, layer cascade visualization.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const chainData = [
  {
    method: ".styles()", layer: "@layer base", repeat: false,
    desc: "Entry point. Define base CSS that applies unconditionally to every instance.",
    code: `ds.styles(\`
  display: inline-flex;
  align-items: center;
  border-radius: 6px;
  font-weight: 500;
\`)`,
    available: "Entry point",
  },
  {
    method: ".variant()", layer: "@layer variants", repeat: true,
    desc: "Named variant axes. Call multiple times for size, color, shape — each gets its own axis.",
    code: `.variant("size", {
  sm: \`padding: 4px 10px; font-size: 13px;\`,
  md: \`padding: 6px 16px; font-size: 14px;\`,
  lg: \`padding: 10px 24px; font-size: 16px;\`,
})`,
    available: ".styles()",
  },
  {
    method: ".compound()", layer: "@layer compounds", repeat: true,
    desc: "Conditional styles when multiple variants match. Order-sensitive — later compounds win.",
    code: `.compound(
  { size: "lg", intent: "primary" },
  \`box-shadow: 0 2px 8px rgba(0,0,0,0.2);\`
)`,
    available: ".variant()",
  },
  {
    method: ".states()", layer: "@layer states", repeat: false,
    desc: "Map interactive pseudo-states to style rules. Selector-keyed since v2.3.",
    code: `.states({
  "&:hover":    \`filter: brightness(1.1);\`,
  "&:active":   \`transform: scale(0.97);\`,
  "&:disabled": \`opacity: 0.5; pointer-events: none;\`,
})`,
    available: ".compound()",
  },
  {
    method: ".system()", layer: "@layer system", repeat: false,
    desc: "Bind to design system token groups — spacing, colors, breakpoints, typography.",
    code: `.system({
  spacing: ["p", "px", "py", "m", "mx", "my"],
  colors:  ["bg", "color", "borderColor"],
})`,
    available: ".states()",
  },
  {
    method: ".props()", layer: "@layer custom", repeat: false,
    desc: "Runtime props that resolve to CSS at render time. Ends the builder before terminal.",
    code: `.props({
  glow: (v) => \`box-shadow: 0 0 \${v}px currentColor;\`,
  truncate: (v) => v ? \`overflow:hidden;white-space:nowrap;text-overflow:ellipsis;\` : "",
})`,
    available: ".system()",
  },
];

const MiniCode = ({ code }) => {
  const [copied, setCopied] = useState(false);
  const lines = code.split("\n");
  return (
    <div style={{ position: "relative", background: t.bg, borderRadius: 6, border: `1px solid ${t.border}`, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "6px 10px", borderBottom: `1px solid ${t.border}`, background: t.surface }}>
        <button onClick={() => { navigator.clipboard?.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1200); }} style={{
          background: "none", border: `1px solid ${copied ? t.tealDim : t.border}`, color: copied ? t.teal : t.dim,
          fontFamily: F.code, fontSize: 10, padding: "1px 7px", borderRadius: 3, cursor: "pointer", transition: "all 0.15s",
        }}>{copied ? "✓ copied" : "copy"}</button>
      </div>
      <pre style={{ margin: 0, padding: "12px 14px", fontFamily: F.code, fontSize: 12, lineHeight: "20px", overflowX: "auto", color: t.muted }}>
        {lines.map((line, i) => {
          // Minimal syntax coloring
          const colored = line
            .replace(/(\.(?:styles|variant|compound|states|system|props))/g, `\x01$1\x02`)
            .replace(/(`[^`]*`)/g, `\x03$1\x04`)
            .replace(/(\/\/.*)/g, `\x05$1\x06`)
            .replace(/("[\w-]+")/g, `\x07$1\x08`);
          const parts = [];
          let buf = "", mode = "default";
          for (const ch of colored) {
            if (ch === "\x01") { if (buf) parts.push({ t: buf, c: "default" }); buf = ""; mode = "method"; continue; }
            if (ch === "\x02") { parts.push({ t: buf, c: "method" }); buf = ""; mode = "default"; continue; }
            if (ch === "\x03") { if (buf) parts.push({ t: buf, c: "default" }); buf = ""; mode = "string"; continue; }
            if (ch === "\x04") { parts.push({ t: buf, c: "string" }); buf = ""; mode = "default"; continue; }
            if (ch === "\x05") { if (buf) parts.push({ t: buf, c: "default" }); buf = ""; mode = "comment"; continue; }
            if (ch === "\x06") { parts.push({ t: buf, c: "comment" }); buf = ""; mode = "default"; continue; }
            if (ch === "\x07") { if (buf) parts.push({ t: buf, c: "default" }); buf = ""; mode = "str2"; continue; }
            if (ch === "\x08") { parts.push({ t: buf, c: "str2" }); buf = ""; mode = "default"; continue; }
            buf += ch;
          }
          if (buf) parts.push({ t: buf, c: mode });
          const colorMap = { default: t.muted, method: t.accent, string: t.teal, comment: t.dim, str2: t.amber };
          return (
            <div key={i} style={{ display: "flex" }}>
              <span style={{ color: t.ghost, minWidth: 22, textAlign: "right", marginRight: 14, userSelect: "none", fontSize: 11 }}>{i + 1}</span>
              <span>{parts.map((p, j) => <span key={j} style={{ color: colorMap[p.c] }}>{p.t}</span>)}</span>
            </div>
          );
        })}
      </pre>
    </div>
  );
};

const ChainVisualizer = () => {
  const [active, setActive] = useState(0);
  const step = chainData[active];

  return (
    <div style={{ marginBottom: 48 }}>
      {/* Chain strip */}
      <div style={{
        display: "flex", alignItems: "center", gap: 0,
        padding: "20px 20px", background: t.surface,
        borderRadius: "10px 10px 0 0", border: `1px solid ${t.border}`,
        borderBottom: "none", overflowX: "auto",
      }}>
        {chainData.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
            <button onClick={() => setActive(i)} style={{
              position: "relative", padding: "10px 14px",
              background: i === active ? t.accentGlow : "transparent",
              border: `1px solid ${i === active ? t.accent : t.border}`,
              borderRadius: 6, cursor: "pointer",
              transition: "all 0.2s ease",
              boxShadow: i === active ? `0 0 20px ${t.accentGlow}, inset 0 0 20px ${t.accentGlow2}` : "none",
              transform: i === active ? "scale(1.04)" : "scale(1)",
            }}>
              {/* glow ring */}
              {i === active && <div style={{
                position: "absolute", inset: -2, borderRadius: 8,
                border: `1px solid ${t.accent}`, opacity: 0.3,
                animation: "pulse-ring 2s ease-in-out infinite",
              }} />}
              <div style={{ fontFamily: F.code, fontSize: 13, color: i === active ? t.accent : i < active ? t.muted : t.dim, fontWeight: i === active ? 600 : 400, transition: "color 0.15s" }}>
                {s.method}
              </div>
              <div style={{ fontFamily: F.code, fontSize: 9, color: i === active ? t.accentDim : t.ghost, textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 3 }}>
                {s.layer.replace("@layer ", "")}
              </div>
            </button>
            {i < chainData.length - 1 && (
              <svg width="32" height="12" style={{ flexShrink: 0, overflow: "visible" }}>
                <line x1="4" y1="6" x2="22" y2="6" stroke={i < active ? t.accent : t.ghost} strokeWidth="1"
                  strokeDasharray={i < active ? "none" : "3 3"}
                  style={{ transition: "stroke 0.3s" }} />
                <polygon points="21,3 27,6 21,9" fill={i < active ? t.accent : t.ghost} style={{ transition: "fill 0.3s" }} />
                {i === active && (
                  <circle r="2" fill={t.accent} opacity="0.8">
                    <animateMotion dur="1s" repeatCount="indefinite" path="M4,6 L22,6" />
                  </circle>
                )}
              </svg>
            )}
          </div>
        ))}
      </div>

      {/* Detail panel */}
      <div style={{
        background: t.bg, border: `1px solid ${t.border}`,
        borderRadius: "0 0 10px 10px", overflow: "hidden",
      }}>
        {/* Info bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 20px", borderBottom: `1px solid ${t.border}`, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{
              display: "inline-flex", padding: "2px 10px", fontFamily: F.code, fontSize: 12,
              background: t.accentGlow, border: `1px solid ${t.accentDim}`, color: t.accent,
              borderRadius: 4, fontWeight: 600,
            }}>{step.method}</span>
            <svg width="14" height="8"><path d="M2 4H10" stroke={t.dim} strokeWidth="1"/><polygon points="9,2 13,4 9,6" fill={t.dim}/></svg>
            <span style={{
              display: "inline-flex", padding: "2px 10px", fontFamily: F.code, fontSize: 12,
              background: t.tealGlow, border: `1px solid ${t.tealDim}`, color: t.teal,
              borderRadius: 4,
            }}>{step.layer}</span>
          </div>
          <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
            <span style={{
              fontFamily: F.code, fontSize: 10, padding: "2px 8px", borderRadius: 3,
              background: step.repeat ? t.amberGlow : t.surface,
              border: `1px solid ${step.repeat ? t.amberDim : t.border}`,
              color: step.repeat ? t.amber : t.dim,
            }}>{step.repeat ? "repeatable" : "once"}</span>
            <span style={{
              fontFamily: F.code, fontSize: 10, padding: "2px 8px", borderRadius: 3,
              background: t.surface, border: `1px solid ${t.border}`, color: t.dim,
            }}>after {step.available}</span>
          </div>
        </div>

        {/* Description + code */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
          <div style={{ padding: "18px 20px", borderRight: `1px solid ${t.border}` }}>
            <p style={{ fontFamily: F.body, fontSize: 14, color: t.muted, lineHeight: "22px", margin: 0 }}>
              {step.desc}
            </p>
            {/* Layer cascade indicator */}
            <div style={{ marginTop: 16, display: "flex", gap: 3, alignItems: "flex-end" }}>
              {chainData.map((_, i) => (
                <div key={i} style={{
                  width: 28, height: 4 + (i + 1) * 4,
                  borderRadius: 2,
                  background: i === active ? t.accent : i < active ? `${t.accent}33` : t.ghost,
                  transition: "all 0.3s ease",
                }} />
              ))}
              <span style={{ fontFamily: F.code, fontSize: 9, color: t.dim, marginLeft: 8, alignSelf: "center" }}>cascade specificity</span>
            </div>
          </div>
          <div style={{ padding: "14px 16px" }}>
            <MiniCode code={step.code} />
          </div>
        </div>
      </div>

      <style>{`@keyframes pulse-ring { 0%,100% { opacity: 0.2; transform: scale(1); } 50% { opacity: 0.5; transform: scale(1.03); } }`}</style>
    </div>
  );
};


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  2. TOKEN BADGES TABLE
//     Yours is a plain table. This version:
//     clickable rows, live copy, visual swatch
//     for each badge, grouped by function.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const badgeConfig = [
  { variant: "method", label: ".styles()", color: t.accent, bg: t.accentGlow, border: t.accentDim, desc: "Chain methods", group: "API" },
  { variant: "method", label: ".variant()", color: t.accent, bg: t.accentGlow, border: t.accentDim, desc: "Chain methods", group: "API" },
  { variant: "layer", label: "@layer base", color: t.teal, bg: t.tealGlow, border: t.tealDim, desc: "Cascade layers", group: "API" },
  { variant: "type", label: "VariantMap", color: t.purple, bg: t.purpleGlow, border: t.purpleDim, desc: "TypeScript types", group: "Types" },
  { variant: "type", label: "CSS", color: t.purple, bg: t.purpleGlow, border: t.purpleDim, desc: "TypeScript types", group: "Types" },
  { variant: "prop", label: "size", color: t.amber, bg: t.amberGlow, border: t.amberDim, desc: "Variant props", group: "Props" },
  { variant: "tag", label: "HTMLButton", color: t.blue, bg: t.blueGlow, border: "#185fa5", desc: "Element types", group: "Props" },
  { variant: "danger", label: "deprecated", color: t.accent, bg: t.accentGlow2, border: t.accentDim, desc: "Lifecycle status", group: "Status" },
  { variant: "success", label: "stable", color: t.teal, bg: t.tealGlow, border: t.tealDim, desc: "Lifecycle status", group: "Status" },
  { variant: "new", label: "v2.4", color: t.blue, bg: t.blueGlow, border: "#185fa5", desc: "Version marker", group: "Status" },
];

const TokenBadge = ({ color, bg, border, children }) => (
  <span style={{
    display: "inline-flex", alignItems: "center", gap: 4,
    padding: "2px 10px", fontSize: 12, fontFamily: F.code,
    background: bg, border: `1px solid ${border}`,
    color, borderRadius: 4, lineHeight: "20px",
    letterSpacing: "0.02em", whiteSpace: "nowrap",
  }}>{children}</span>
);

const TokenBadgeTable = () => {
  const [copiedIdx, setCopiedIdx] = useState(null);
  const groups = [...new Set(badgeConfig.map(b => b.group))];

  return (
    <div style={{ border: `1px solid ${t.border}`, borderRadius: 10, overflow: "hidden" }}>
      {groups.map((group, gi) => (
        <div key={group}>
          {/* Group header */}
          <div style={{
            padding: "8px 18px", background: t.surface,
            borderTop: gi > 0 ? `1px solid ${t.border}` : "none",
            borderBottom: `1px solid ${t.border}`,
          }}>
            <span style={{ fontFamily: F.display, fontSize: 10, fontWeight: 700, color: t.dim, textTransform: "uppercase", letterSpacing: "0.1em" }}>{group}</span>
          </div>
          {/* Rows */}
          {badgeConfig.filter(b => b.group === group).map((badge, i) => {
            const globalIdx = badgeConfig.indexOf(badge);
            return (
              <div key={i}
                onClick={() => { navigator.clipboard?.writeText(`<Badge variant="${badge.variant}">${badge.label}</Badge>`); setCopiedIdx(globalIdx); setTimeout(() => setCopiedIdx(null), 1200); }}
                style={{
                  display: "grid", gridTemplateColumns: "140px 1fr 90px",
                  alignItems: "center", padding: "10px 18px", cursor: "pointer",
                  borderBottom: `1px solid ${t.border}`,
                  background: copiedIdx === globalIdx ? t.accentGlow2 : "transparent",
                  transition: "background 0.15s",
                }}
                onMouseEnter={e => { if (copiedIdx !== globalIdx) e.currentTarget.style.background = t.hover; }}
                onMouseLeave={e => { if (copiedIdx !== globalIdx) e.currentTarget.style.background = "transparent"; }}
              >
                <div><TokenBadge color={badge.color} bg={badge.bg} border={badge.border}>{badge.label}</TokenBadge></div>
                <div style={{ fontFamily: F.body, fontSize: 13, color: t.dim }}>{badge.desc}</div>
                <div style={{ textAlign: "right", fontFamily: F.code, fontSize: 10, color: copiedIdx === globalIdx ? t.teal : t.ghost, transition: "color 0.15s" }}>
                  {copiedIdx === globalIdx ? "✓ copied" : "click to copy"}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
};


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  3. CODE BLOCK — upgraded
//     Line highlighting, diff markers,
//     filename tab, language badge, focused
//     line gutter glow.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const syntaxColor = (text) => {
  const parts = [];
  const patterns = [
    { re: /(\/\/.*)/, c: t.dim },
    { re: /(\.(?:styles|variant|compound|states|system|props|asElement|asComponent|asClass))\b/, c: t.accent },
    { re: /(`[^`]*`)/, c: t.teal },
    { re: /("[\w\-. ]+")/,  c: t.amber },
    { re: /('[\w\-. ]+')/,  c: t.amber },
    { re: /\b(const|let|var|import|from|export|default|return|function|if|else)\b/, c: t.purple },
    { re: /\b(true|false|null|undefined)\b/, c: t.accent },
    { re: /\b(\d+(?:\.\d+)?)\b/, c: t.blue },
  ];
  let remaining = text;
  while (remaining.length > 0) {
    let earliest = null, earliestIdx = Infinity, earliestPattern = null;
    for (const p of patterns) {
      const m = remaining.match(p.re);
      if (m && m.index < earliestIdx) { earliest = m; earliestIdx = m.index; earliestPattern = p; }
    }
    if (!earliest) { parts.push({ t: remaining, c: t.muted }); break; }
    if (earliestIdx > 0) parts.push({ t: remaining.slice(0, earliestIdx), c: t.muted });
    parts.push({ t: earliest[1], c: earliestPattern.c });
    remaining = remaining.slice(earliestIdx + earliest[0].length);
  }
  return parts;
};

const CodeBlockPro = ({ code, title, language = "ts", highlights = [], diffs = {} }) => {
  const [copied, setCopied] = useState(false);
  const lines = code.split("\n");

  return (
    <div style={{ border: `1px solid ${t.border}`, borderRadius: 10, overflow: "hidden", background: t.bg }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 4px 0 0", background: t.surface,
        borderBottom: `1px solid ${t.border}`,
      }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          {/* File tab */}
          {title && (
            <div style={{
              padding: "9px 18px", borderRight: `1px solid ${t.border}`,
              borderBottom: `2px solid ${t.accent}`, marginBottom: -1,
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <svg width="12" height="12" viewBox="0 0 16 16">
                <path d="M3 2h6l4 4v8H3V2z" fill="none" stroke={t.dim} strokeWidth="1.2" strokeLinejoin="round"/>
                <path d="M9 2v4h4" fill="none" stroke={t.dim} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span style={{ fontFamily: F.code, fontSize: 12, color: t.text }}>{title}</span>
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px" }}>
          <span style={{
            fontFamily: F.code, fontSize: 9, color: t.ghost, textTransform: "uppercase",
            letterSpacing: "0.12em", padding: "2px 6px", background: t.bg,
            borderRadius: 3, border: `1px solid ${t.border}`,
          }}>{language}</span>
          <button onClick={() => { navigator.clipboard?.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1400); }} style={{
            background: "none", border: `1px solid ${copied ? t.tealDim : t.border}`,
            color: copied ? t.teal : t.dim, fontFamily: F.code, fontSize: 10,
            padding: "2px 8px", borderRadius: 3, cursor: "pointer", transition: "all 0.15s",
            display: "flex", alignItems: "center", gap: 4,
          }}>
            {copied ? (
              <svg width="10" height="10" viewBox="0 0 16 16"><path d="M3 8.5l3 3 7-7" stroke={t.teal} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 16 16"><rect x="5" y="5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" fill="none"/><path d="M3 11V3a1.5 1.5 0 011.5-1.5H11" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round"/></svg>
            )}
            {copied ? "copied" : "copy"}
          </button>
        </div>
      </div>

      {/* Code */}
      <div style={{ padding: "2px 0", overflowX: "auto" }}>
        {lines.map((line, i) => {
          const lineNum = i + 1;
          const isHighlight = highlights.includes(lineNum);
          const diff = diffs[lineNum]; // "+" | "-" | undefined
          return (
            <div key={i} style={{
              display: "flex", alignItems: "stretch", minHeight: 26,
              background: diff === "+" ? "rgba(29,158,117,0.08)" : diff === "-" ? "rgba(232,89,60,0.06)" : isHighlight ? "rgba(239,159,39,0.06)" : "transparent",
              borderLeft: isHighlight ? `2px solid ${t.amber}` : diff === "+" ? `2px solid ${t.teal}` : diff === "-" ? `2px solid ${t.accent}` : "2px solid transparent",
              transition: "background 0.15s",
            }}
              onMouseEnter={e => { if (!isHighlight && !diff) e.currentTarget.style.background = t.hover + "44"; }}
              onMouseLeave={e => { if (!isHighlight && !diff) e.currentTarget.style.background = "transparent"; }}
            >
              {/* Diff marker */}
              <span style={{
                width: 16, textAlign: "center", fontFamily: F.code, fontSize: 11, lineHeight: "26px",
                color: diff === "+" ? t.teal : diff === "-" ? t.accent : "transparent",
                userSelect: "none", flexShrink: 0,
              }}>{diff || " "}</span>
              {/* Line number */}
              <span style={{
                width: 32, textAlign: "right", paddingRight: 14,
                fontFamily: F.code, fontSize: 11, lineHeight: "26px",
                color: isHighlight ? t.amber : t.ghost,
                userSelect: "none", flexShrink: 0,
                transition: "color 0.15s",
              }}>{lineNum}</span>
              {/* Code */}
              <span style={{ fontFamily: F.code, fontSize: 13, lineHeight: "26px", whiteSpace: "pre" }}>
                {syntaxColor(line).map((p, j) => (
                  <span key={j} style={{ color: p.c, fontStyle: p.c === t.dim ? "italic" : "normal" }}>{p.t}</span>
                ))}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  4. LIVE PREVIEW
//     Yours has the tab idea but the preview
//     area feels empty. This version: proper
//     toolbar with variant controls, grid bg
//     pattern, responsive viewport toggle.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const LivePreviewPro = () => {
  const [tab, setTab] = useState("preview");
  const [variant, setVariant] = useState("default");
  const [viewport, setViewport] = useState("full");

  const variants = {
    default: { pad: "8px 20px", size: 14, radius: 6 },
    sm: { pad: "5px 12px", size: 12, radius: 4 },
    lg: { pad: "12px 32px", size: 16, radius: 8 },
  };

  const code = `// Using the button component

// Renders a <button> with variant classes
<Button size="${variant}">
  Click me
</Button>

// Generated CSS (${variant}):
// padding: ${variants[variant].pad};
// font-size: ${variants[variant].size}px;
// border-radius: ${variants[variant].radius}px;`;

  return (
    <div style={{ border: `1px solid ${t.border}`, borderRadius: 10, overflow: "hidden" }}>
      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 6px 0 0", background: t.surface, borderBottom: `1px solid ${t.border}`,
        flexWrap: "wrap",
      }}>
        <div style={{ display: "flex" }}>
          {["preview", "code", "CSS output"].map(label => (
            <button key={label} onClick={() => setTab(label)} style={{
              padding: "10px 18px", background: "none", border: "none",
              borderBottom: tab === label ? `2px solid ${t.accent}` : "2px solid transparent",
              color: tab === label ? t.text : t.dim,
              fontFamily: F.code, fontSize: 12, cursor: "pointer",
              transition: "all 0.12s", marginBottom: -1,
            }}>{label}</button>
          ))}
        </div>
        {tab === "preview" && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 0" }}>
            {/* Viewport toggle */}
            {["full", "tablet", "mobile"].map(vp => (
              <button key={vp} onClick={() => setViewport(vp)} style={{
                width: 28, height: 24, display: "flex", alignItems: "center", justifyContent: "center",
                background: viewport === vp ? t.hover : "transparent",
                border: `1px solid ${viewport === vp ? t.borderHi : "transparent"}`,
                borderRadius: 4, cursor: "pointer", transition: "all 0.12s",
              }}>
                <svg width="14" height="14" viewBox="0 0 16 16">
                  {vp === "full" && <rect x="1" y="3" width="14" height="10" rx="1.5" stroke={viewport === vp ? t.muted : t.ghost} strokeWidth="1.2" fill="none"/>}
                  {vp === "tablet" && <rect x="3" y="2" width="10" height="12" rx="1.5" stroke={viewport === vp ? t.muted : t.ghost} strokeWidth="1.2" fill="none"/>}
                  {vp === "mobile" && <rect x="5" y="1" width="6" height="14" rx="1.5" stroke={viewport === vp ? t.muted : t.ghost} strokeWidth="1.2" fill="none"/>}
                </svg>
              </button>
            ))}
            <div style={{ width: 1, height: 16, background: t.border, margin: "0 4px" }} />
            {/* Variant selector */}
            <div style={{ display: "flex", gap: 3, padding: 2, background: t.bg, borderRadius: 6, border: `1px solid ${t.border}` }}>
              {Object.keys(variants).map(v => (
                <button key={v} onClick={() => setVariant(v)} style={{
                  padding: "2px 10px", fontFamily: F.code, fontSize: 11,
                  background: variant === v ? t.accentGlow : "transparent",
                  border: `1px solid ${variant === v ? t.accent : "transparent"}`,
                  color: variant === v ? t.accent : t.dim,
                  borderRadius: 4, cursor: "pointer", transition: "all 0.12s",
                }}>{v}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Content area */}
      {tab === "preview" ? (
        <div style={{
          padding: 40, display: "flex", alignItems: "center", justifyContent: "center",
          minHeight: 140, background: t.bg, position: "relative",
          // Dot grid background
          backgroundImage: `radial-gradient(circle, ${t.ghost} 0.5px, transparent 0.5px)`,
          backgroundSize: "20px 20px",
        }}>
          <div style={{
            maxWidth: viewport === "mobile" ? 200 : viewport === "tablet" ? 400 : "none",
            transition: "max-width 0.3s ease",
            display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center",
          }}>
            <button style={{
              padding: variants[variant].pad,
              borderRadius: variants[variant].radius,
              fontSize: variants[variant].size,
              border: "none", background: t.accent, color: "#fff",
              fontFamily: F.body, fontWeight: 500, cursor: "pointer",
              transition: "all 0.2s ease",
              boxShadow: `0 2px 12px ${t.accentGlow}`,
            }}>Primary</button>
            <button style={{
              padding: variants[variant].pad,
              borderRadius: variants[variant].radius,
              fontSize: variants[variant].size,
              border: `1px solid ${t.border}`, background: "transparent", color: t.text,
              fontFamily: F.body, fontWeight: 500, cursor: "pointer",
              transition: "all 0.2s ease",
            }}>Secondary</button>
            <button style={{
              padding: variants[variant].pad,
              borderRadius: variants[variant].radius,
              fontSize: variants[variant].size,
              border: `1px solid ${t.border}`, background: "transparent", color: t.dim,
              fontFamily: F.body, fontWeight: 500, cursor: "pointer",
              transition: "all 0.2s ease", opacity: 0.5,
            }}>Disabled</button>
          </div>
        </div>
      ) : tab === "code" ? (
        <CodeBlockPro
          code={code}
          language="tsx"
          highlights={[4, 5, 6]}
        />
      ) : (
        <CodeBlockPro
          code={`.btn {
  display: inline-flex;
  align-items: center;
  border-radius: ${variants[variant].radius}px;
  font-weight: 500;
}
.btn--size-${variant} {
  padding: ${variants[variant].pad};
  font-size: ${variants[variant].size}px;
}`}
          language="css"
        />
      )}
    </div>
  );
};


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  5. SIDEBAR — more opinionated
//     Indented groups, method signatures
//     in code font, active glow, collapse
//     animation, search pulse.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const SidebarItem = ({ label, active, code, depth = 0, items, status }) => {
  const [open, setOpen] = useState(active || items?.some(i => i.active));
  const [hovered, setHovered] = useState(false);

  return (
    <div>
      <button
        onClick={() => items ? setOpen(!open) : null}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex", alignItems: "center", gap: 6, width: "100%",
          padding: `7px 14px 7px ${14 + depth * 16}px`,
          background: active ? t.accentGlow : hovered ? t.hover : "transparent",
          border: "none",
          borderLeft: active ? `2px solid ${t.accent}` : hovered ? `2px solid ${t.ghost}` : "2px solid transparent",
          color: active ? t.text : hovered ? t.muted : code ? t.dim : t.muted,
          fontFamily: code ? F.code : F.body,
          fontSize: code ? 13 : 14,
          cursor: "pointer", textAlign: "left",
          transition: "all 0.1s",
        }}
      >
        {items && (
          <svg width="8" height="8" viewBox="0 0 8 8" style={{ flexShrink: 0, transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>
            <path d="M2 1L6 4L2 7" fill="none" stroke={t.dim} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        {status && (
          <span style={{
            width: 5, height: 5, borderRadius: "50%", flexShrink: 0,
            background: status === "new" ? t.blue : status === "beta" ? t.amber : "transparent",
            boxShadow: status === "new" ? `0 0 4px ${t.blueGlow}` : undefined,
          }} />
        )}
      </button>
      {open && items && (
        <div style={{ overflow: "hidden" }}>
          {items.map((item, i) => <SidebarItem key={i} {...item} depth={depth + 1} />)}
        </div>
      )}
    </div>
  );
};

const SidebarPro = () => (
  <aside style={{
    width: 260, background: t.surface, borderRight: `1px solid ${t.border}`,
    padding: "20px 0", flexShrink: 0, overflowY: "auto",
  }}>
    {/* Logo */}
    <div style={{ padding: "0 14px 16px", display: "flex", alignItems: "baseline", gap: 8 }}>
      <span style={{ fontFamily: F.display, fontSize: 18, fontWeight: 700, color: t.accent, letterSpacing: "-0.03em" }}>ds</span>
      <span style={{ fontFamily: F.code, fontSize: 10, color: t.ghost, padding: "1px 6px", background: t.bg, borderRadius: 3, border: `1px solid ${t.border}` }}>v2.4.0</span>
    </div>

    {/* Search */}
    <div style={{ padding: "0 10px 16px" }}>
      <button style={{
        display: "flex", alignItems: "center", gap: 8, width: "100%",
        padding: "8px 12px", background: t.bg, border: `1px solid ${t.border}`,
        borderRadius: 8, cursor: "pointer", transition: "border-color 0.15s",
      }}>
        <svg width="13" height="13" viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5" stroke={t.dim} strokeWidth="1.3" fill="none"/><path d="M10.5 10.5L14 14" stroke={t.dim} strokeWidth="1.3" strokeLinecap="round"/></svg>
        <span style={{ fontFamily: F.body, fontSize: 13, color: t.ghost, flex: 1, textAlign: "left" }}>Search...</span>
        <span style={{ display: "flex", gap: 2 }}>
          <kbd style={{ fontFamily: F.code, fontSize: 10, color: t.ghost, padding: "1px 5px", background: t.surface, borderRadius: 3, border: `1px solid ${t.border}`, boxShadow: `0 1px 0 ${t.border}` }}>⌘K</kbd>
        </span>
      </button>
    </div>

    <nav>
      {/* Category */}
      <div style={{ padding: "16px 14px 6px", fontFamily: F.display, fontSize: 9, fontWeight: 700, color: t.ghost, textTransform: "uppercase", letterSpacing: "0.14em" }}>Getting started</div>
      <SidebarItem label="Introduction" />
      <SidebarItem label="Installation" />
      <SidebarItem label="Quick start" status="new" />

      <div style={{ padding: "16px 14px 6px", fontFamily: F.display, fontSize: 9, fontWeight: 700, color: t.ghost, textTransform: "uppercase", letterSpacing: "0.14em" }}>Architecture</div>
      <SidebarItem label="Theming & Tokens" />
      <SidebarItem label="Cascade Layers" />
      <SidebarItem label="Color Modes" />

      <div style={{ padding: "16px 14px 6px", fontFamily: F.display, fontSize: 9, fontWeight: 700, color: t.ghost, textTransform: "uppercase", letterSpacing: "0.14em" }}>Component authoring</div>
      <SidebarItem label="Base Styling" />
      <SidebarItem label="Variants & States" />
      <SidebarItem label="Composition" />

      <div style={{ padding: "16px 14px 6px", fontFamily: F.display, fontSize: 9, fontWeight: 700, color: t.ghost, textTransform: "uppercase", letterSpacing: "0.14em" }}>Reference</div>
      <SidebarItem label="Builder Chain" active items={[
        { label: ".styles()", code: true },
        { label: ".variant()", code: true, active: true },
        { label: ".compound()", code: true, status: "beta" },
        { label: ".states()", code: true },
        { label: ".system()", code: true },
        { label: ".props()", code: true },
      ]} />
      <SidebarItem label="createTheme()" code />
      <SidebarItem label="createSystem()" code />
      <SidebarItem label="compose()" code />

      <div style={{ padding: "16px 14px 6px", fontFamily: F.display, fontSize: 9, fontWeight: 700, color: t.ghost, textTransform: "uppercase", letterSpacing: "0.14em" }}>Support</div>
      <SidebarItem label="Troubleshooting" />
      <SidebarItem label="Examples" />
      <SidebarItem label="Migration Guide" status="new" />
    </nav>
  </aside>
);


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  SHOWCASE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const Section = ({ title, children }) => (
  <div style={{ marginBottom: 56 }}>
    <div style={{
      fontFamily: F.display, fontSize: 10, fontWeight: 700, color: t.ghost,
      textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: 20,
      display: "flex", alignItems: "center", gap: 12,
    }}>
      <span style={{ display: "inline-block", width: 20, height: 1, background: t.ghost }} />
      {title}
    </div>
    {children}
  </div>
);

export default function PunchedUp() {
  return (
    <div style={{ fontFamily: F.body, color: t.text, background: t.bg, minHeight: "100vh" }}>
      <link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />

      <div style={{ display: "flex" }}>
        {/* Sidebar */}
        <SidebarPro />

        {/* Main */}
        <main style={{ flex: 1, padding: "32px 48px 80px", maxWidth: 820, minWidth: 0 }}>

          <Section title="Chain visualizer — interactive">
            <ChainVisualizer />
          </Section>

          <Section title="Code block — diff + highlighting">
            <CodeBlockPro
              title="migration.ts"
              language="ts"
              highlights={[5, 6]}
              diffs={{ 3: "-", 4: "-", 5: "+", 6: "+" }}
              code={`// Migration from v2.2 to v2.3

const card = ds.styles(\`border-radius: 8px\`)
  .states({ hover: \`opacity: 0.8\` })       // v2.2 syntax
  .states({ disabled: \`opacity: 0.5\` })     // v2.2 syntax
  .states({ "&:hover": \`opacity: 0.8\` })    // v2.3 syntax
  .states({ "&:disabled": \`opacity: 0.5\` }) // v2.3 syntax
  .asElement('div')`}
            />
          </Section>

          <Section title="Token badges — grouped + copyable">
            <TokenBadgeTable />
          </Section>

          <Section title="Live preview — variant controls + viewport">
            <LivePreviewPro />
          </Section>

        </main>
      </div>
    </div>
  );
}