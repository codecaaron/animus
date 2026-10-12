/** One environment's build, as a host hands it to a hook: the object is its
 *  identity, the name its key. */
export interface BuildingEnvironment {
  readonly name: string;
}

/** An environment's open build, and the promise its end settles. */
interface OpenBuild {
  environment: BuildingEnvironment;
  ended: Promise<void>;
  end(): void;
}

/**
 * Each environment build that started and has not ended, by name. A host
 * that builds a shared plugin's environments in parallel (a Vite `buildApp`)
 * shares one build among them, retired by the last to end. A build under a
 * name whose build is open (a reused builder, or a second environment under
 * one name) waits for that build's end, so each build ends only its own
 * generation, once.
 */
export class EnvironmentBuilds {
  /** What a host without environments builds as. */
  readonly single: BuildingEnvironment = { name: 'build' };

  private readonly builds = new Map<string, OpenBuild>();

  /** Opens `environment`'s build once no build under its name is open;
   *  whether another environment's build is open beside it. */
  async open(environment: BuildingEnvironment): Promise<boolean> {
    for (;;) {
      const open = this.builds.get(environment.name);
      if (open === undefined) break;
      await open.ended;
    }
    let end = () => {};
    const ended = new Promise<void>((settle) => {
      end = settle;
    });
    this.builds.set(environment.name, { environment, ended, end });
    return this.builds.size > 1;
  }

  /** Ends `environment`'s build if this environment opened it; whether that
   *  left none open. A host can end an environment it never opened (a dev
   *  server ends every environment, started or not), which ends nothing. */
  end(environment: BuildingEnvironment): boolean {
    const open = this.builds.get(environment.name);
    if (open === undefined || open.environment !== environment) return false;
    this.builds.delete(environment.name);
    open.end();
    return this.builds.size === 0;
  }
}
