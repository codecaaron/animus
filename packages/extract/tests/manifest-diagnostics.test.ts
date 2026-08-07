import { describe, expect, it } from 'vitest';

import {
  SELECTOR_UNSUPPORTED_SUBJECT,
  ancestorSubjectSelector,
  collectSelectorAliasDiagnostics,
  surfaceManifestDiagnostics,
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

describe('ancestorSubjectSelector', () => {
  it('flags ancestor-prefixed subjects only', () => {
    expect(ancestorSubjectSelector('[aria-sort="ascending"] &')).toBe(true);
    expect(ancestorSubjectSelector('.group:hover &:hover')).toBe(true);
    expect(ancestorSubjectSelector('&:hover')).toBe(false);
    expect(ancestorSubjectSelector('& + &')).toBe(false);
    expect(ancestorSubjectSelector(':hover')).toBe(false);
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
  it('flags ancestor-subject alias values with the coded error', () => {
    const diagnostics = collectSelectorAliasDiagnostics(
      JSON.stringify({
        _hover: '&:hover',
        _groupHover: '.group:hover &',
        _dark: '[data-color-mode="dark"] &',
      })
    );
    expect(diagnostics.map((d) => d.component).sort()).toEqual([
      '_dark',
      '_groupHover',
    ]);
    for (const diagnostic of diagnostics) {
      expect(diagnostic.code).toBe(SELECTOR_UNSUPPORTED_SUBJECT);
      expect(diagnostic.severity).toBe('error');
    }
  });

  it('accepts leading-subject aliases and empty registries', () => {
    expect(
      collectSelectorAliasDiagnostics(
        JSON.stringify({ _hover: '&:hover, &[data-hover]' })
      )
    ).toEqual([]);
    expect(collectSelectorAliasDiagnostics(null)).toEqual([]);
    expect(collectSelectorAliasDiagnostics('not-json')).toEqual([]);
  });

  it('flags a comma list whose second branch is ancestor-subject', () => {
    const diagnostics = collectSelectorAliasDiagnostics(
      JSON.stringify({ _mixed: '&:focus-visible, .group:hover &' })
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].component).toBe('_mixed');
  });
});
