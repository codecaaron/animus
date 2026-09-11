import { createPlaceAnalysis } from './analysis';

import type { AxisBinding, Place } from './model';
import type { Snapshot } from './snapshot';

export interface BindingChange {
  axis: string;
  before?: AxisBinding['state'];
  after?: AxisBinding['state'];
}

export interface ComparedPlace {
  component: string;
  file: string;
  occurrence: number;
  status: 'persisted' | 'added' | 'removed';
  bindingChanges?: readonly BindingChange[];
}

export interface CompareRefusal {
  side: 'before' | 'after';
  file: string;
  reason: string;
  detail: string;
}

export interface SnapshotComparison {
  identical: boolean;
  generations: {
    before: { hash: string; label?: string };
    after: { hash: string; label?: string };
  };
  components: {
    persisted: readonly string[];
    added: readonly string[];
    removed: readonly string[];
  };
  places: readonly ComparedPlace[];
  refusals: readonly CompareRefusal[];
}

type Generation = SnapshotComparison['generations']['before'];

const generationOf = (snapshot: Snapshot): Generation => {
  const generation: Generation = { hash: snapshot.host.program.hash };
  if (snapshot.host.program.label !== undefined) {
    generation.label = snapshot.host.program.label;
  }
  return generation;
};

const bindingChanges = (
  before: Place,
  after: Place
): readonly BindingChange[] => {
  const axes = new Set([
    ...before.bindings.map((binding) => binding.axis),
    ...after.bindings.map((binding) => binding.axis),
  ]);
  const changes: BindingChange[] = [];
  for (const axis of Array.from(axes).sort()) {
    const beforeState = before.bindings.find(
      (binding) => binding.axis === axis
    )?.state;
    const afterState = after.bindings.find(
      (binding) => binding.axis === axis
    )?.state;
    if (beforeState !== afterState) {
      const change: BindingChange = { axis };
      if (beforeState !== undefined) change.before = beforeState;
      if (afterState !== undefined) change.after = afterState;
      changes.push(change);
    }
  }
  return changes;
};

export const compareSnapshots = (
  before: Snapshot,
  after: Snapshot
): SnapshotComparison => {
  const beforeIds = new Set(
    before.host.identity.components().map((component) => component.id)
  );
  const afterIds = new Set(
    after.host.identity.components().map((component) => component.id)
  );

  const refusals: CompareRefusal[] = [];
  const refusedFiles = new Set<string>();
  for (const [side, snapshot] of [
    ['before', before],
    ['after', after],
  ] as const) {
    for (const file of snapshot.files()) {
      const result = snapshot.structureOf(file);
      if (!result.ok) {
        refusals.push({
          side,
          file,
          reason: result.reason,
          detail: result.detail,
        });
        refusedFiles.add(file);
      }
    }
  }

  const beforeAnalysis = createPlaceAnalysis(before);
  const afterAnalysis = createPlaceAnalysis(after);

  interface Row {
    file: string;
    occurrence: number;
    beforePlace?: Place;
    afterPlace?: Place;
  }

  const places: ComparedPlace[] = [];
  const componentIds = Array.from(new Set([...beforeIds, ...afterIds])).sort();
  for (const componentId of componentIds) {
    const rows = new Map<string, Row>();
    for (const [side, analysis, present] of [
      ['before', beforeAnalysis, beforeIds.has(componentId)],
      ['after', afterAnalysis, afterIds.has(componentId)],
    ] as const) {
      if (!present) continue;
      const perFile = new Map<string, number>();
      for (const ref of analysis.invocationsOf(componentId)) {
        if (refusedFiles.has(ref.file)) continue;
        const occurrence = perFile.get(ref.file) ?? 0;
        perFile.set(ref.file, occurrence + 1);
        const key = `${ref.file}\0${occurrence}`;
        const row = rows.get(key) ?? { file: ref.file, occurrence };
        const place = analysis.placeOf(ref);
        if (side === 'before') row.beforePlace = place;
        else row.afterPlace = place;
        rows.set(key, row);
      }
    }

    const ordered = Array.from(rows.values()).sort(
      (a, b) => a.file.localeCompare(b.file) || a.occurrence - b.occurrence
    );
    for (const row of ordered) {
      if (row.beforePlace !== undefined && row.afterPlace !== undefined) {
        const changes = bindingChanges(row.beforePlace, row.afterPlace);
        const persisted: ComparedPlace = {
          component: componentId,
          file: row.file,
          occurrence: row.occurrence,
          status: 'persisted',
        };
        if (changes.length > 0) persisted.bindingChanges = changes;
        places.push(persisted);
      } else {
        places.push({
          component: componentId,
          file: row.file,
          occurrence: row.occurrence,
          status: row.beforePlace !== undefined ? 'removed' : 'added',
        });
      }
    }
  }

  return {
    identical: before.host.program.hash === after.host.program.hash,
    generations: {
      before: generationOf(before),
      after: generationOf(after),
    },
    components: {
      persisted: Array.from(beforeIds)
        .filter((id) => afterIds.has(id))
        .sort(),
      added: Array.from(afterIds)
        .filter((id) => !beforeIds.has(id))
        .sort(),
      removed: Array.from(beforeIds)
        .filter((id) => !afterIds.has(id))
        .sort(),
    },
    places,
    refusals,
  };
};
