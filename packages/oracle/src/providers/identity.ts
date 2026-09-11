import type { SourceRef } from '../core/fact';
import type { TargetId } from '../core/identity';
import type { ScenarioDomain, ScenarioPoint } from '../core/scenario';

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

export interface TargetResolution {
  target: TargetId;
  component: ComponentRecord;
  dimensions: ScenarioDomain;
  classes(point: ScenarioPoint): readonly string[];
}

export interface IdentityProvider {
  components(): readonly ComponentRecord[];
  componentById(id: string): ComponentRecord | undefined;
  resolveTarget(selector: string): TargetResolution | undefined;
}
