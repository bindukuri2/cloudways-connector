/**
 * Shared contract between the Cursor plugin's MCP server and the deploy-intel-api backend.
 *
 * Both sides import these types so the wire format stays in lockstep. The MCP server
 * produces `DeployRequest`, the backend consumes it and produces `DeployStatus` over time.
 */

export type Framework =
  | "wordpress"
  | "wordpress-bedrock"
  /**
   * Static HTML landing page that wants to live on a Cloudways WordPress app.
   * No WP files exist yet; we need to scaffold a theme + mu-plugin before deploy.
   */
  | "static-landing"
  | "unknown";

export type AppType = "wordpress" | "woocommerce";

export interface Evidence {
  signal: string;
  path: string;
}

export interface DetectedTheme {
  name: string;
  slug: string;
}

export interface DetectedPlugin {
  slug: string;
  name?: string;
}

export interface ProjectStack {
  framework: Framework;
  hasWooCommerce: boolean;
  phpVersion: string;
  theme?: DetectedTheme;
  plugins: DetectedPlugin[];
  evidence: Evidence[];
  /** Filesystem root used during detection (absolute). */
  workspaceRoot: string;
}

export interface GitSource {
  /** True only when we resolved a usable remote + branch. */
  gitReady: boolean;
  gitUrl?: string;
  branch?: string;
  /** True if the working tree has uncommitted changes (advisory; we do not block on this). */
  dirty?: boolean;
  /** Reason gitReady is false, surfaced to the user via the skill. */
  reason?: string;
}

export interface DeployEnvVar {
  key: string;
  value?: string;
  /** True for keys we know about but whose value we intentionally did not extract (e.g. secrets). */
  redacted?: boolean;
  /** Where we learned about this key, for explainability. */
  source: "wp-config.php" | ".env.example" | ".env" | "default";
}

export interface DeployRequest {
  /** Slug of the workspace dir, used as the Cloudways app label. */
  appName: string;
  appType: AppType;
  stack: ProjectStack;
  git: GitSource;
  envVars: DeployEnvVar[];
  /** Skip app creation and attach Git to an existing Cloudways app. */
  existingAppId?: string;
}

export type DeploymentState =
  | "pending"
  | "authenticating"
  | "creating_app"
  | "attaching_git"
  | "pulling_git"
  | "purging_cache"
  | "live"
  | "failed";

export type CloudwaysOperationKind =
  | "create_app"
  | "git_clone"
  | "git_pull"
  | "purge_app_cache"
  | "purge_varnish";

export interface CloudwaysOperationRef {
  kind: CloudwaysOperationKind;
  /** Cloudways' own operation_id (integer returned by /app, /git/*, etc.). */
  operationId: string;
  status?: string;
  startedAt: number;
}

export interface DeployStatus {
  /**
   * Our coordinator ID for the whole deploy. It is NOT a Cloudways operation
   * id. One deploy is several Cloudways calls (create app, git pull, purge
   * cache, ...), each with its own Cloudways operation_id, all listed under
   * `cloudwaysOperations` below for cross-reference.
   */
  deploymentId: string;
  state: DeploymentState;
  /** Human-readable progress line; updated on every state change. */
  message: string;
  /** Set when state === "live". */
  url?: string;
  /** Cloudways IDs, populated as soon as they are known. */
  cloudwaysServerId?: string;
  cloudwaysAppId?: string;
  /** Ordered list of every Cloudways operation we spawned during this deploy. */
  cloudwaysOperations?: CloudwaysOperationRef[];
  cache?: {
    appCachePurged: boolean;
    varnishPurged: boolean;
    appCacheError?: string;
    varnishError?: string;
  };
  /** Set when state === "failed". */
  error?: string;
  /** Epoch ms; set on every state transition so clients can render a timeline. */
  updatedAt: number;
  createdAt: number;
}

export interface DeployCreatedResponse {
  deploymentId: string;
  statusUrl: string;
}
