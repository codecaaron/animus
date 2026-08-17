import { analyzeSelector, canonicalCompound } from '../host/animus/selector';

import type { SourceElement } from './source';

/**
 * What an `ancestor:<prefix>` axis demands of an ancestor element — shared by
 * the static structural matcher (source elements) and the observation matcher
 * (rendered elements, PLACES.md §5). One requirement reading, two witnesses.
 */

export type MatchVerdict = 'yes' | 'no' | 'unknown';

export interface AxisRequirement {
  classNames: readonly string[];
  attributes: readonly string[];
  stateful: boolean;
  /** Undefined when the prefix is more than one descendant compound. */
  modeled: boolean;
}

export const requirementOf = (axis: string): AxisRequirement => {
  const prefix = axis.slice('ancestor:'.length);
  const analyzed = analyzeSelector(`${prefix} .__axis-probe__`);
  const links = analyzed.model.ancestry ?? [];
  if (links.length !== 1 || links[0].combinator !== 'descendant') {
    return { classNames: [], attributes: [], stateful: false, modeled: false };
  }
  const model = links[0].model;
  return {
    classNames: model.classNames,
    attributes: (model.attributes ?? []).map(canonicalCompound),
    stateful: (model.pseudo ?? []).length > 0,
    modeled: true,
  };
};

export interface AttributeRequirement {
  name: string;
  /** Absent for a bare `[name]` requirement. */
  value?: string;
}

export const parseAttributeRequirement = (
  raw: string
): AttributeRequirement | undefined => {
  const parsed = /^\[([^\]=]+)(?:=([^\]]*))?\]$/.exec(raw);
  if (parsed === null) return undefined;
  const value = parsed[2]?.replace(/^["']|["']$/g, '');
  // A bare `[name]` requirement has no `value` key at all — `elementSatisfies`
  // reads its absence as "any value satisfies".
  const requirement: AttributeRequirement = { name: parsed[1] };
  if (value !== undefined) requirement.value = value;
  return requirement;
};

const classListOf = (element: SourceElement): readonly string[] | undefined => {
  const className = element.attributes.find((a) => a.name === 'className');
  if (className === undefined) return element.hasSpread ? undefined : [];
  if (className.kind !== 'static') return undefined;
  return (className.value ?? '').split(/\s+/).filter((name) => name !== '');
};

const attributeMatch = (
  element: SourceElement,
  required: string
): MatchVerdict => {
  const requirement = parseAttributeRequirement(required);
  if (requirement === undefined) return 'unknown';
  const attr = element.attributes.find((a) => a.name === requirement.name);
  if (attr === undefined) return element.hasSpread ? 'unknown' : 'no';
  if (attr.kind !== 'static') return 'unknown';
  if (requirement.value === undefined) return 'yes';
  return attr.value === requirement.value ? 'yes' : 'no';
};

/** How one structural ancestor relates to one axis requirement. */
export const elementSatisfies = (
  element: SourceElement,
  requirement: AxisRequirement
): MatchVerdict => {
  let unknown = false;

  for (const attribute of requirement.attributes) {
    const verdict = attributeMatch(element, attribute);
    if (verdict === 'no') return 'no';
    if (verdict === 'unknown') unknown = true;
  }
  if (requirement.classNames.length > 0) {
    const classes = classListOf(element);
    if (classes === undefined) unknown = true;
    else if (!requirement.classNames.every((name) => classes.includes(name))) {
      return 'no';
    }
  }
  return unknown ? 'unknown' : 'yes';
};
