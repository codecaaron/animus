import type { HostExtensionPolicy } from '../pipeline/host-extensions';
import type { WorkspacePackages } from '../pipeline/workspace-packages';

/** What a session resolves under, as system loading does: the host's
 *  export conditions, the session root's declared workspaces, and the
 *  host's extension order. */
export interface SessionResolutionContext {
  readonly conditions: readonly string[];
  readonly workspaces: WorkspacePackages;
  readonly extensions: HostExtensionPolicy;
}
