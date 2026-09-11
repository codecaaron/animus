import { describe, expect, it } from 'vitest';

import {
  SELECTOR_UNSUPPORTED_SUBJECT,
  hasSelectorSubject,
  collectSelectorAliasDiagnostics,
  surfaceManifestDiagnostics,
  VOCABULARY_COLLISION,
  VOCABULARY_LEGACY_VERB,
  vocabularyWitnessDiagnostics,
} from '../pipeline/manifest-diagnostics';

import type { ManifestDiagnostic } from '../pipeline/manifest-diagnostics';

const errorDiagnostic: ManifestDiagnostic = {
  file: 'a.tsx',
  component: 'Mark',
  kind: 'skip',
  message: `selector '[aria-sort="ascending"] &' places '&' after an ancestor prefix (${SELECTOR_UNSUPPORTED_SUBJECT})`,
  code: SELECTOR_UNSUPPORTED_SUBJECT,
  severity: 'error',
};

describe('hasSelectorSubject', () => {
  it('detects substitutable subjects quote-awarely', () => {
    expect(hasSelectorSubject('[aria-sort="ascending"] &')).toBe(true);
    expect(hasSelectorSubject('.group:hover &:hover')).toBe(true);
    expect(hasSelectorSubject('&:hover')).toBe(true);
    expect(hasSelectorSubject('& + &')).toBe(true);
    expect(hasSelectorSubject(':hover')).toBe(false);
    expect(hasSelectorSubject('[data-x="a&b"]')).toBe(false);
  });

  it('tracks backslash escapes (mirrors the Rust walk)', () => {
    expect(hasSelectorSubject('[data-x="a\\"&b"]')).toBe(false);
    expect(hasSelectorSubject('[data-x="a\\"&b"] &')).toBe(true);
    expect(hasSelectorSubject('[data-x="a\\\\"]')).toBe(false);
    expect(hasSelectorSubject('.a\\& span')).toBe(false);
  });
});

describe('surfaceManifestDiagnostics strict policy', () => {
  it('throws under strict with every error diagnostic named', () => {
    const warned: string[] = [];
    expect(() =>
      surfaceManifestDiagnostics(
        { diagnostics: [errorDiagnostic] },
        (m) => warned.push(m),
        { strict: true }
      )
    ).toThrow(new RegExp(SELECTOR_UNSUPPORTED_SUBJECT.replace(/\./g, '\\.')));
    expect(warned).toHaveLength(0);
  });

  it('warns and proceeds without strict', () => {
    const warned: string[] = [];
    surfaceManifestDiagnostics({ diagnostics: [errorDiagnostic] }, (m) =>
      warned.push(m)
    );
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain(SELECTOR_UNSUPPORTED_SUBJECT);
  });

  it('never escalates warn-severity skips under strict', () => {
    const warned: string[] = [];
    surfaceManifestDiagnostics(
      {
        diagnostics: [
          {
            file: 'a.tsx',
            component: 'Button',
            kind: 'skip',
            message: "property 'gap' — variable reference (non-static)",
          },
        ],
      },
      (m) => warned.push(m),
      { strict: true }
    );
    expect(warned).toHaveLength(1);
  });

  it('appends the code to printed lines only when the message lacks it', () => {
    const warned: string[] = [];
    surfaceManifestDiagnostics(
      {
        diagnostics: [
          { ...errorDiagnostic, message: 'ancestor prefix unsupported' },
        ],
      },
      (m) => warned.push(m)
    );
    expect(warned[0]).toContain(`[${SELECTOR_UNSUPPORTED_SUBJECT}]`);
    const alreadyCoded: string[] = [];
    surfaceManifestDiagnostics({ diagnostics: [errorDiagnostic] }, (m) =>
      alreadyCoded.push(m)
    );
    expect(alreadyCoded[0].endsWith(`[${SELECTOR_UNSUPPORTED_SUBJECT}]`)).toBe(
      false
    );
  });
});

describe('collectSelectorAliasDiagnostics', () => {
  it('accepts ancestor-subject and mixed alias values (supported forms)', () => {
    expect(
      collectSelectorAliasDiagnostics(
        JSON.stringify({
          _hover: '&:hover',
          _groupHover: '.group:hover &',
          _dark: '[data-color-mode="dark"] &',
          _mixed: '&:focus-visible, .group:hover &',
        })
      )
    ).toEqual([]);
  });

  it('accepts leading-subject aliases and empty registries', () => {
    expect(
      collectSelectorAliasDiagnostics(
        JSON.stringify({ _hover: '&:hover, &[data-hover]' })
      )
    ).toEqual([]);
    expect(collectSelectorAliasDiagnostics(null)).toEqual([]);
  });

  it('throws on malformed selector-alias JSON, naming the wire and the cause', () => {
    expect(() => collectSelectorAliasDiagnostics('not-json')).toThrow(
      /selectorAliasesJson/
    );
    expect(() => collectSelectorAliasDiagnostics('not-json')).toThrow(
      /SyntaxError/
    );
  });

  it('flags a value whose every & is quoted with the coded error', () => {
    const diagnostics = collectSelectorAliasDiagnostics(
      JSON.stringify({ _broken: '[data-x="a&b"]' })
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].component).toBe('_broken');
    expect(diagnostics[0].code).toBe(SELECTOR_UNSUPPORTED_SUBJECT);
    expect(diagnostics[0].severity).toBe('error');
  });
});

describe('ingestion failures vs degradation under strict', () => {
  const legacyVerbWitness = JSON.stringify([
    {
      code: VOCABULARY_LEGACY_VERB,
      verb: 'from',
      source: '@acme/kit',
      names: ['dsKitMotion'],
    },
  ]);
  const collisionWitness = JSON.stringify([
    {
      code: VOCABULARY_COLLISION,
      name: 'fade',
      winner: '@acme/kit',
      loser: '@acme/legacy',
    },
  ]);

  const surface = (witnessJson: string, strict: boolean): string[] => {
    const warned: string[] = [];
    surfaceManifestDiagnostics({ diagnostics: [] }, (m) => warned.push(m), {
      strict,
      prepend: vocabularyWitnessDiagnostics(witnessJson),
    });
    return warned;
  };

  it('a deprecated verb dropping registered vocabulary stays a warning under strict', () => {
    const warned = surface(legacyVerbWitness, true);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain(VOCABULARY_LEGACY_VERB);
  });

  it('the same case warns without strict', () => {
    const warned = surface(legacyVerbWitness, false);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain(VOCABULARY_LEGACY_VERB);
  });

  it('a vocabulary name collision stays a warning under strict', () => {
    const warned = surface(collisionWitness, true);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain(VOCABULARY_COLLISION);
  });

  it('an unrecognized witness kind stays a warning under strict', () => {
    const warned = surface(
      JSON.stringify([{ code: 'animus.vocabulary.from-a-newer-system' }]),
      true
    );
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain('animus.vocabulary.from-a-newer-system');
  });
});
