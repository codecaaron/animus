/**
 * ANIMUS — Narrative React Wrappers
 *
 * Thin composition logic over builder chain primitives.
 * The primitives handle CSS (extractable). These handle behavior.
 */
import type { ReactNode } from 'react';

import {
  AltarCaption,
  AltarFile,
  AltarHeader,
  AltarLang,
  AltarSurround,
  CodeAltarFrame,
  CodeBlock,
  IndictmentBlock,
  IndictmentEmphasis,
  IndictmentLine,
  IndictmentVerdict,
  Label,
  ProofHash,
  ProofLayer,
  ProofMeta,
  ProofSpecimen,
  ProofStage,
  ScarChapter,
  ScarContainer,
  ScarLine,
  ScarTitle,
} from './components';

// ─── Indictment ─────────────────────────────────────────────

interface IndictmentEntry {
  text: string;
  type?: 'line' | 'code' | 'verdict';
}

interface IndictmentProps {
  lines: IndictmentEntry[];
  baseDelay?: number;
  stagger?: number;
}

export function Indictment({
  lines,
  baseDelay = 0.3,
  stagger = 0.35,
}: IndictmentProps) {
  return (
    <IndictmentBlock>
      {lines.map((entry, i) => {
        const delay = `${baseDelay + i * stagger}s`;

        if (entry.type === 'code') {
          return (
            <IndictmentEmphasis key={i} style={{ animationDelay: delay }}>
              {entry.text}
            </IndictmentEmphasis>
          );
        }

        if (entry.type === 'verdict') {
          return (
            <IndictmentVerdict key={i} style={{ animationDelay: delay }}>
              {entry.text}
            </IndictmentVerdict>
          );
        }

        return (
          <IndictmentLine key={i} style={{ animationDelay: delay }}>
            {entry.text}
          </IndictmentLine>
        );
      })}
    </IndictmentBlock>
  );
}

// ─── Section Scar ───────────────────────────────────────────

interface SectionScarProps {
  chapter: string;
  title?: string;
  delay?: number;
}

export function SectionScar({
  chapter,
  title,
  delay = 0,
}: SectionScarProps) {
  return (
    <ScarContainer>
      <ScarChapter>{chapter}</ScarChapter>
      <ScarLine
        style={delay ? { animationDelay: `${delay}s` } : undefined}
      />
      {title && <ScarTitle>{title}</ScarTitle>}
    </ScarContainer>
  );
}

// ─── Code Altar ─────────────────────────────────────────────

interface CodeAltarProps {
  file?: string;
  language?: 'tsx' | 'css' | 'typescript';
  caption?: string;
  children: string;
}

export function CodeAltar({
  file,
  language,
  caption,
  children,
}: CodeAltarProps) {
  return (
    <AltarSurround>
      <CodeAltarFrame>
        {file && (
          <AltarHeader>
            <AltarFile>{file}</AltarFile>
            {language && <AltarLang>{language}</AltarLang>}
          </AltarHeader>
        )}
        <CodeBlock language={language}>{children}</CodeBlock>
      </CodeAltarFrame>
      {caption && <AltarCaption>{caption}</AltarCaption>}
    </AltarSurround>
  );
}

// ─── Proof Specimen ─────────────────────────────────────────

interface ProofSpecimenBlockProps {
  title: string;
  hash: string;
  layer: string;
  css: string;
  children: ReactNode;
}

export function ProofSpecimenBlock({
  title,
  hash,
  layer,
  css,
  children,
}: ProofSpecimenBlockProps) {
  return (
    <ProofSpecimen>
      <ProofStage>{children}</ProofStage>
      <ProofMeta>
        <ProofHash>{hash}</ProofHash>
        <ProofLayer>@layer {layer}</ProofLayer>
        <Label mt={8}>{title}</Label>
        <CodeBlock language="css">{css}</CodeBlock>
      </ProofMeta>
    </ProofSpecimen>
  );
}
