/**
 * Custom-property semantics as a browser computes them. Each case is a page of
 * plain CSS and markup, and each probe reads one computed value. Only the
 * showcase cases use Animus output; the rest document platform behaviour.
 */

interface ProbeTarget {
  label: string;
  selector: string;
  pseudo?: '::before';
  property: string;
}

/** A probe expects a literal, or another element's computed value. */
export type Probe = ProbeTarget &
  ({ expected: string } | { sameAs: string; sameAsProperty?: string });

export interface FixtureCase {
  name: string;
  css: string;
  body: string;
  probes: Probe[];
}

const RED = 'rgb(255, 0, 0)';
const GREEN = 'rgb(0, 128, 0)';
const BLUE = 'rgb(0, 0, 255)';
const BLACK = 'rgb(0, 0, 0)';

const KEYWORDS = [
  'initial',
  'inherit',
  'unset',
  'revert',
  'revert-layer',
] as const;

/**
 * The fix gives a runtime keyword the class a static write of it selects: a
 * direct declaration in the system layer, above the component's base. Through
 * the inline variable the keyword acts on the variable instead: `initial`
 * leaves it invalid, so `color` inherits the parent's red, and the others
 * hand `color` the parent's own `--slot`, blue.
 */
const KEYWORD_EXPECTATIONS = {
  initial: { keywordClass: BLACK, transport: RED },
  inherit: { keywordClass: RED, transport: BLUE },
  unset: { keywordClass: RED, transport: BLUE },
  revert: { keywordClass: RED, transport: BLUE },
  'revert-layer': { keywordClass: GREEN, transport: BLUE },
} satisfies Record<
  (typeof KEYWORDS)[number],
  { keywordClass: string; transport: string }
>;

const keywordTransport: FixtureCase = {
  name: 'a runtime CSS-wide keyword through its keyword class versus the inline variable',
  css: `
    @layer anm-base, anm-system;
    @layer anm-base { .box { color: ${GREEN}; } }
    @layer anm-system {
      .slot { color: var(--slot); }
      ${KEYWORDS.map((keyword) => `.keyword-${keyword} { color: ${keyword}; }`).join('\n')}
    }
    .parent { color: ${RED}; --slot: ${BLUE}; }
  `,
  body: `<div class="parent">${KEYWORDS.map(
    (keyword) =>
      `<div class="box keyword-${keyword}" id="keyword-${keyword}"></div>` +
      `<div class="box slot" id="transport-${keyword}" style="--slot: ${keyword}"></div>`
  ).join('')}</div>`,
  probes: KEYWORDS.flatMap((keyword) => [
    {
      label: `${keyword}, static or runtime, through the keyword class`,
      selector: `#keyword-${keyword}`,
      property: 'color',
      expected: KEYWORD_EXPECTATIONS[keyword].keywordClass,
    },
    {
      label: `${keyword} through the inline variable, as before the fix`,
      selector: `#transport-${keyword}`,
      property: 'color',
      expected: KEYWORD_EXPECTATIONS[keyword].transport,
    },
  ]),
};

/**
 * A responsive runtime value mixes keyword classes with slot classes. They
 * share the system layer, where base rules come before breakpoint rules, so
 * the entry for the widest matching breakpoint wins either way round.
 */
const responsiveKeywordMix: FixtureCase = {
  name: 'a responsive runtime value mixing keyword classes and the inline variable',
  css: `
    @layer anm-system {
      .slot { color: var(--slot); }
      .keyword-inherit { color: inherit; }
      @media (min-width: 768px) { .slot-sm { color: var(--slot-sm); } }
      @media (min-width: 768px) { .keyword-sm-inherit { color: inherit; } }
    }
    .parent { color: ${RED}; }
  `,
  body: `<div class="parent">
    <div class="slot keyword-sm-inherit" id="slot-then-keyword" style="--slot: ${BLUE}"></div>
    <div class="keyword-inherit slot-sm" id="keyword-then-slot" style="--slot-sm: ${GREEN}"></div>
  </div>`,
  probes: [
    {
      label: '{ _: blue, sm: inherit } at a wide viewport',
      selector: '#slot-then-keyword',
      property: 'color',
      expected: RED,
    },
    {
      label: '{ _: inherit, sm: green } at a wide viewport',
      selector: '#keyword-then-slot',
      property: 'color',
      expected: GREEN,
    },
  ],
};

const nonInheritingRegistration: FixtureCase = {
  name: "a non-inheriting registration blocks an ancestor's value",
  css: `
    @property --blocked { syntax: '<color>'; inherits: false; initial-value: ${GREEN}; }
    .parent { --blocked: ${RED}; --plain: ${RED}; }
    #registered { color: var(--blocked); }
    #unregistered { color: var(--plain); }
  `,
  body: `<div class="parent"><div id="registered"></div><div id="unregistered"></div></div>`,
  probes: [
    {
      label: 'registered, inherits: false',
      selector: '#registered',
      property: 'color',
      expected: GREEN,
    },
    {
      label: 'unregistered control',
      selector: '#unregistered',
      property: 'color',
      expected: RED,
    },
  ],
};

const initialValueAndFallback: FixtureCase = {
  name: 'a registered initial value suppresses a var() fallback',
  css: `
    @property --with-initial { syntax: '<color>'; inherits: true; initial-value: ${GREEN}; }
    @property --universal { syntax: '*'; inherits: true; }
    #with-initial { color: var(--with-initial, ${RED}); }
    #universal { color: var(--universal, ${RED}); }
  `,
  body: `<div id="with-initial"></div><div id="universal"></div>`,
  probes: [
    {
      label: 'typed registration with an initial value',
      selector: '#with-initial',
      property: 'color',
      expected: GREEN,
    },
    {
      label: 'universal registration without an initial value',
      selector: '#universal',
      property: 'color',
      expected: RED,
    },
  ],
};

/** The runner fixes the viewport at this width. */
export const VIEWPORT_WIDTH = 1000;

const relativeInitialValues: FixtureCase = {
  name: 'viewport-relative initial values register; font- and container-relative ones do not',
  css: `
    @property --viewport { syntax: '<length>'; inherits: false; initial-value: 10vw; }
    @property --font { syntax: '<length>'; inherits: false; initial-value: 2em; }
    @property --root-font { syntax: '<length>'; inherits: false; initial-value: 2rem; }
    @property --container { syntax: '<length>'; inherits: false; initial-value: 10cqw; }
    #viewport { width: var(--viewport, 7px); }
    #font { width: var(--font, 7px); }
    #root-font { width: var(--root-font, 7px); }
    #container { width: var(--container, 7px); }
  `,
  body: `<div id="viewport"></div><div id="font"></div><div id="root-font"></div><div id="container"></div>`,
  probes: [
    {
      label: '10vw registers',
      selector: '#viewport',
      property: 'width',
      expected: `${VIEWPORT_WIDTH / 10}px`,
    },
    {
      label: '2em is rejected, so the fallback applies',
      selector: '#font',
      property: 'width',
      expected: '7px',
    },
    {
      label: '2rem is rejected, so the fallback applies',
      selector: '#root-font',
      property: 'width',
      expected: '7px',
    },
    {
      label: '10cqw is rejected, so the fallback applies',
      selector: '#container',
      property: 'width',
      expected: '7px',
    },
  ],
};

const laterInvalidWrite: FixtureCase = {
  name: 'a later invalid write resolves to the initial value, not an earlier declaration',
  css: `
    @property --length { syntax: '<length>'; inherits: false; initial-value: 3px; }
    .box { --length: 20px; width: var(--length); }
    #literal { --length: ${RED}; }
    #substituted { --source: ${RED}; --length: var(--source); }
    #unregistered { --plain: 20px; --plain: ${RED}; width: var(--plain, 7px); }
  `,
  body: `<div class="box" id="valid"></div><div class="box" id="literal"></div><div class="box" id="substituted"></div><div id="unregistered"></div>`,
  probes: [
    {
      label: 'valid control',
      selector: '#valid',
      property: 'width',
      expected: '20px',
    },
    {
      label: 'later literal of the wrong type',
      selector: '#literal',
      property: 'width',
      expected: '3px',
    },
    {
      label: 'later var() substitution of the wrong type',
      selector: '#substituted',
      property: 'width',
      expected: '3px',
    },
    {
      label: 'unregistered: the later value wins and makes width invalid',
      selector: '#unregistered',
      property: 'width',
      expected: `${VIEWPORT_WIDTH}px`,
    },
  ],
};

const inheritedTypedLength: FixtureCase = {
  name: 'an inherited typed length keeps the value computed at its declaration',
  css: `
    @property --typed { syntax: '<length>'; inherits: true; initial-value: 0px; }
    .parent { font-size: 10px; --typed: 2em; --plain: 2em; }
    .child { font-size: 30px; }
    #typed { width: var(--typed); }
    #plain { width: var(--plain); }
  `,
  body: `<div class="parent"><div class="child" id="typed"></div><div class="child" id="plain"></div></div>`,
  probes: [
    {
      label: 'registered: 2em at the 10px parent',
      selector: '#typed',
      property: 'width',
      expected: '20px',
    },
    {
      label: 'unregistered: 2em re-resolved at the 30px child',
      selector: '#plain',
      property: 'width',
      expected: '60px',
    },
  ],
};

const pseudoElementSlot: FixtureCase = {
  name: 'a non-inheriting inline slot does not reach ::before',
  css: `
    @property --slot-color { syntax: '<color>'; inherits: false; initial-value: ${GREEN}; }
    .host::before { content: 'x'; }
    #registered::before { color: var(--slot-color); }
    #unregistered::before { color: var(--plain); }
  `,
  body: `<div class="host" id="registered" style="--slot-color: ${RED}"></div><div class="host" id="unregistered" style="--plain: ${RED}"></div>`,
  probes: [
    {
      label: 'registered, inherits: false',
      selector: '#registered',
      pseudo: '::before',
      property: 'color',
      expected: GREEN,
    },
    {
      label: 'unregistered control',
      selector: '#unregistered',
      pseudo: '::before',
      property: 'color',
      expected: RED,
    },
  ],
};

/**
 * The showcase's `bg` writes `--current-bg` on the element it styles, and its
 * card footer and container-card media read it from a child.
 */
export function showcaseCurrentBg(registration: string): FixtureCase {
  return {
    name: "the showcase's current-bg registration with a child reader",
    css: `
      ${registration}
      .surface { --current-bg: ${RED}; border-top: 1px solid var(--current-bg); }
      .footer { border-top: 1px solid var(--current-bg); }
    `,
    body: `<div class="surface" id="surface"><footer class="footer" id="footer"></footer></div>`,
    probes: [
      {
        label: 'the writing element reads its own value',
        selector: '#surface',
        property: 'border-top-color',
        expected: RED,
      },
      {
        label: 'a child reader gets the written colour',
        selector: '#footer',
        property: 'border-top-color',
        expected: RED,
      },
    ],
  };
}

/** The runtime configuration the showcase build emits for its `bg` prop. */
export const SHOWCASE_BG_SLOT = {
  varName: '--animus-bg',
  slotClass: 'animus-dyn-bg',
  property: 'backgroundColor',
  currentVar: '--current-bg',
};

export interface RuntimeWrite {
  className: string;
  style: string;
}

/**
 * The showcase stylesheet with a runtime `bg` as the runtime resolver applies
 * it. Its slot writes `--current-bg` as a static `bg` write does, and a value
 * that reads `--current-bg` takes the slot that leaves it alone: writing it
 * would make the variable cyclic and the background transparent.
 */
export function showcaseRuntimeCurrentBg(
  css: string,
  staticWrite: { className: string; value: string },
  write: (value: string) => RuntimeWrite
): FixtureCase {
  const runtime = write(staticWrite.value);
  const selfReading = write('var(--current-bg)');
  return {
    name: "the showcase's runtime bg and the current-bg its children read",
    css: `${css}
      .reader { border-top: 1px solid var(--current-bg); }`,
    body: `<div style="--current-bg: ${RED}">
      <div class="${staticWrite.className}" id="static"><div class="reader" id="static-reader"></div></div>
      <div class="${runtime.className}" style="${runtime.style}" id="runtime"><div class="reader" id="runtime-reader"></div></div>
      <div class="${selfReading.className}" style="${selfReading.style}" id="self"><div class="reader" id="self-reader"></div></div>
    </div>`,
    probes: [
      {
        label: 'a static bg reaches its child reader',
        selector: '#static-reader',
        property: 'border-top-color',
        sameAs: '#static',
        sameAsProperty: 'background-color',
      },
      {
        label: 'the same runtime bg reaches its child reader',
        selector: '#runtime-reader',
        property: 'border-top-color',
        sameAs: '#static-reader',
      },
      {
        label: 'a runtime bg reading current-bg paints the context colour',
        selector: '#self',
        property: 'background-color',
        expected: RED,
      },
      {
        label: 'and its child still reads the context colour',
        selector: '#self-reader',
        property: 'border-top-color',
        expected: RED,
      },
    ],
  };
}

export const PLATFORM_CASES: FixtureCase[] = [
  keywordTransport,
  responsiveKeywordMix,
  nonInheritingRegistration,
  initialValueAndFallback,
  relativeInitialValues,
  laterInvalidWrite,
  inheritedTypedLength,
  pseudoElementSlot,
];
