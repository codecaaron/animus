import type { HostExtensionPolicy } from '../pipeline/host-extensions';
import type { WorkspacePackages } from '../pipeline/workspace-packages';

/** What a session resolves under, as system loading does: the host's
 *  export conditions, the session root's declared workspaces, the host's
 *  extension order, and the instance the host resolves each kit to. */
export interface SessionResolutionContext {
  readonly conditions: readonly string[];
  readonly workspaces: WorkspacePackages;
  readonly extensions: HostExtensionPolicy;
  /** Kit package name → the real root of the instance the host resolves
   *  it to (C8); empty where no host resolves. */
  readonly instances?: Readonly<Record<string, string>>;
}
