import * as crypto from 'node:crypto';

let componentCounter = 0;

export function generateComponentId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const counter = componentCounter++;
  
  return `animus-${timestamp}-${random}-${counter}`;
}

export function generateClassName(input: string): string {
  const hash = crypto.createHash('md5').update(input).digest('hex');
  return `animus-${hash.substring(0, 8)}`;
}

export function generateAtomicClassName(prop: string, value: any, breakpoint?: string): string {
  const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
  const base = `${prop}-${valueStr}`.replace(/[^a-zA-Z0-9-]/g, '-');
  
  return breakpoint ? `${breakpoint}:${base}` : base;
}

export function camelToKebab(str: string): string {
  return str.replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, '$1-$2').toLowerCase();
}

export function isStaticValue(value: any): boolean {
  // Check if the value can be determined at build time
  if (value === null || value === undefined) return true;
  
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') return true;
  
  if (Array.isArray(value)) {
    return value.every(isStaticValue);
  }
  
  if (type === 'object') {
    return Object.values(value).every(isStaticValue);
  }
  
  return false;
}

export function escapeSelector(str: string): string {
  // Escape special characters for CSS selectors
  return str.replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\\\$1');
}