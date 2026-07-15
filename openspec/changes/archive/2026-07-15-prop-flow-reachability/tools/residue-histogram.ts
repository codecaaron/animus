type ResidueSite = {
  binding: string;
  prop: string;
  file: string;
  span: { start: number; end: number };
  kind: string;
};

type ResidueManifest = {
  usageResidue: ResidueSite[];
};

export type ResidueHistogram = {
  totalSites: number;
  byKind: Record<string, number>;
  byProp: Record<string, number>;
  byBinding: Record<string, number>;
};

function readSites(manifest: unknown): ResidueSite[] {
  if (
    manifest === null ||
    typeof manifest !== 'object' ||
    !Array.isArray((manifest as Partial<ResidueManifest>).usageResidue)
  ) {
    throw new TypeError('manifest usageResidue must be an array');
  }

  return (manifest as ResidueManifest).usageResidue.map((site) => {
    if (
      site === null ||
      typeof site !== 'object' ||
      typeof site.binding !== 'string' ||
      typeof site.prop !== 'string' ||
      typeof site.file !== 'string' ||
      typeof site.kind !== 'string' ||
      site.span === null ||
      typeof site.span !== 'object' ||
      typeof site.span.start !== 'number' ||
      typeof site.span.end !== 'number'
    ) {
      throw new TypeError('usageResidue contains an invalid site record');
    }
    return site;
  });
}

function increment(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

function sortCounts(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right))
  );
}

export function summarize(manifests: unknown[]): ResidueHistogram {
  const uniqueSites = new Map<string, ResidueSite>();
  for (const manifest of manifests) {
    for (const site of readSites(manifest)) {
      const key = JSON.stringify([
        site.file,
        site.span.start,
        site.span.end,
        site.binding,
        site.prop,
        site.kind,
      ]);
      uniqueSites.set(key, site);
    }
  }

  const byKind: Record<string, number> = {};
  const byProp: Record<string, number> = {};
  const byBinding: Record<string, number> = {};
  for (const site of uniqueSites.values()) {
    increment(byKind, site.kind);
    increment(byProp, site.prop);
    increment(byBinding, site.binding);
  }

  return {
    totalSites: uniqueSites.size,
    byKind: sortCounts(byKind),
    byProp: sortCounts(byProp),
    byBinding: sortCounts(byBinding),
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out');
  const outputPath = outIndex >= 0 ? args[outIndex + 1] : undefined;
  const manifestPaths = args.filter(
    (_arg, index) => index !== outIndex && index !== outIndex + 1
  );
  if (!outputPath || manifestPaths.length === 0) {
    throw new Error(
      'usage: bun residue-histogram.ts --out <summary.json> <manifest.json> [...]'
    );
  }

  const manifests = await Promise.all(
    manifestPaths.map((path) => Bun.file(path).json())
  );
  await Bun.write(
    outputPath,
    `${JSON.stringify(summarize(manifests), null, 2)}\n`
  );
}
