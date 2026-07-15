type BaselineConsumer = {
  cssBytes: number;
  systemBytes: number;
  dynamicProps: number;
};

type FloorBaseline = {
  capturedAt: string;
  engine: string;
  consumers: Record<string, BaselineConsumer>;
};

type Manifest = {
  css?: unknown;
  sheets?: { system?: unknown };
  dynamic_props?: unknown;
  dynamicProps?: unknown;
};

type Metric = {
  before: number;
  after: number;
  delta: number;
  percent: number | null;
};

const encoder = new TextEncoder();

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function metric(before: number, after: number): Metric {
  const delta = after - before;
  return {
    before,
    after,
    delta,
    percent: before === 0 ? null : Number(((delta / before) * 100).toFixed(2)),
  };
}

function manifestCounts(manifest: Manifest, label: string): BaselineConsumer {
  if (typeof manifest.css !== 'string') {
    throw new TypeError(`${label}.css must be a string`);
  }
  if (typeof manifest.sheets?.system !== 'string') {
    throw new TypeError(`${label}.sheets.system must be a string`);
  }
  const dynamicProps = manifest.dynamic_props ?? manifest.dynamicProps;
  assertRecord(dynamicProps, `${label}.dynamic_props`);
  return {
    cssBytes: encoder.encode(manifest.css).byteLength,
    systemBytes: encoder.encode(manifest.sheets.system).byteLength,
    dynamicProps: Object.keys(dynamicProps).length,
  };
}

export function measureFloorCss(
  baseline: FloorBaseline,
  manifests: Record<string, Manifest>
) {
  const consumers: Record<
    string,
    { cssBytes: Metric; systemBytes: Metric; dynamicProps: Metric }
  > = {};

  for (const label of Object.keys(baseline.consumers).sort()) {
    const before = baseline.consumers[label];
    const manifest = manifests[label];
    if (!before || !manifest) {
      throw new Error(`missing baseline or manifest for consumer '${label}'`);
    }
    const after = manifestCounts(manifest, label);
    consumers[label] = {
      cssBytes: metric(before.cssBytes, after.cssBytes),
      systemBytes: metric(before.systemBytes, after.systemBytes),
      dynamicProps: metric(before.dynamicProps, after.dynamicProps),
    };
  }

  return {
    baselineCapturedAt: baseline.capturedAt,
    engine: baseline.engine,
    consumers,
  };
}

async function main(args: string[]): Promise<void> {
  let baselinePath: string | undefined;
  let outputPath: string | undefined;
  const inputs: Array<[string, string]> = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--baseline') {
      baselinePath = args[++index];
    } else if (arg === '--out') {
      outputPath = args[++index];
    } else if (arg?.includes('=')) {
      const separator = arg.indexOf('=');
      inputs.push([arg.slice(0, separator), arg.slice(separator + 1)]);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (!baselinePath || !outputPath || inputs.length === 0) {
    throw new Error('usage: --baseline <file> --out <file> label=manifest.json [...]');
  }

  const baseline = (await Bun.file(baselinePath).json()) as FloorBaseline;
  const manifests: Record<string, Manifest> = {};
  for (const [label, path] of inputs) {
    manifests[label] = (await Bun.file(path).json()) as Manifest;
  }
  const output = `${JSON.stringify(measureFloorCss(baseline, manifests), null, 2)}\n`;
  await Bun.write(outputPath, output);
}

if (import.meta.main) {
  await main(Bun.argv.slice(2));
}
