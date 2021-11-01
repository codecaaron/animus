import { PrismTheme } from 'prism-react-renderer';
import { theme as animusTheme } from '@animus/theme';

export const theme: PrismTheme = {
  plain: {
    color: animusTheme.colors.white,
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
        color: '#9580ff',
      },
    },
    {
      types: ['property', 'function', 'attr-name'],
      style: {
        color: '#8aff80',
      },
    },
    {
      types: ['attr-value', 'string'],
      style: {
        color: '#ffff80',
      },
    },
    {
      types: ['tag-id', 'selector', 'atrule-id'],
      style: {
        color: '#ff80bf',
      },
    },
    {
      types: ['keyword', 'tag', 'variable', 'operator'],
      style: {
        color: '#ff80bf',
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
        color: '#AEE938',
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
        color: animusTheme.colors['blue-300'],
      },
    },
  ],
};
