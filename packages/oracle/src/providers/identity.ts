import type { SourceRef } from '../core/fact';
import type { TargetId } from '../core/identity';
import type { ScenarioDomain, ScenarioPoint } from '../core/scenario';

/**
 * Provider 2 (DESIGN §9): the stable link from source symbol to generated
 * class. `id` is `<file>::<binding>`.
 */
export interface ComponentRecord {
  id: string;
  file: string;
  binding: string;
  className: string;
  extendsFrom?: string;
  terminal: 'asElement' | 'asComponent' | 'asClass';
  tag?: string;
  source?: SourceRef;
}

/**
 * A resolved target: which component, which scenario axes actually apply to
 * it, and which classes it carries at a given point. `classes` is the seam
 * where scenario coordinates become selector matches — cascade resolution
 * needs nothing else from the host.
 */
export interface TargetResolution {
  target: TargetId;
  component: ComponentRecord;
  dimensions: ScenarioDomain;
  classes(point: ScenarioPoint): readonly string[];
}

export interface IdentityProvider {
  components(): readonly ComponentRecord[];
  componentById(id: string): ComponentRecord | undefined;
  /**
   * Accepts a component id (`file::binding`) or a bare binding name. A bare
   * name that matches more than one component resolves to nothing rather than
   * to an arbitrary winner — an ambiguous target would silently scope an
   * answer to the wrong component.
   */
  resolveTarget(selector: string): TargetResolution | undefined;
}
