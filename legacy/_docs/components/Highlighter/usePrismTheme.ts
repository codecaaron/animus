import { PrismTheme } from 'prism-react-renderer';
import { useMemo } from 'react';

import { theme } from '~theme';

const { colors } = theme;

export const usePrismTheme = () => {
  return useMemo<PrismTheme>(
    () => ({
      plain: {
        color: colors['syntax-text'],
      },
      styles: [
        {
          types: ['namespace', 'comment', 'prolog', 'doctype', 'cdata'],
          style: {
            opacity: 0.8,
          },
        },
        {
          types: ['number', 'boolean'],
          style: {
            color: colors['syntax-number'],
          },
        },
        {
          types: ['property', 'function', 'attr-name'],
          style: {
            color: colors['syntax-property'],
          },
        },
        {
          types: ['attr-value', 'string'],
          style: {
            color: colors['syntax-value'],
          },
        },
        {
          types: [
            'keyword',
            'tag',
            'variable',
            'operator',
            'tag-id',
            'selector',
            'atrule-id',
          ],
          style: {
            color: colors['syntax-keyword'],
          },
        },
        {
          types: [
            'entity',
            'url',
            'control',
            'directive',
            'unit',
            'statement',
            'regex',
            'at-rule',
            'placeholder',
          ],
          style: {
            color: colors['syntax-unit'],
          },
        },
        {
          types: ['deleted'],
          style: {
            textDecorationLine: 'line-through',
          },
        },
        {
          types: ['inserted'],
          style: {
            textDecorationLine: 'underline',
          },
        },
        {
          types: ['italic'],
          style: {
            fontStyle: 'italic',
          },
        },
        {
          types: ['important', 'bold'],
          style: {
            fontWeight: 'bold',
          },
        },
        {
          types: ['important'],
          style: {
            color: colors['syntax-important'],
          },
        },
      ],
    }),
    []
  );
};
