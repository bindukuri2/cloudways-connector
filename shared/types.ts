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
  /**
   * Cloudways server to deploy into. When omitted, the backend falls back to
   * CLOUDWAYS_SERVER_ID from its env (if set). The skill is expected to
   * always provide this after the picker/create flow has run.
   */
  serverId?: string;
}

/**
 * Cloudways discovery shapes used by the picker and create-server flow.
 * Kept small and normalized so the LLM only sees fields it can act on.
 */
export interface Provider {
  code: string;
  name: string;
}

export interface Region {
  code: string;
  name: string;
  cloud: string;
}

export interface InstanceSize {
  code: string;
  ram?: string;
  cpu?: string;
  disk?: string;
  priceMonthly?: string;
  cloud: string;
}

export interface AppVersion {
  application: string;
  version: string;
  isDefault?: boolean;
}

export interface ServerAppSummary {
  id: string;
  label: string;
  application?: string;
}

export interface ServerSummary {
  id: string;
  label: string;
  cloud: string;
  region: string;
  size: string;
  status: string;
  publicIp?: string;
  appsCount: number;
  apps: ServerAppSummary[];
}

export interface CreateServerArgs {
  cloud: string;
  region: string;
  instanceType: string;
  application: AppType;
  appVersion?: string;
  serverLabel: string;
  appLabel: string;
  projectName?: string;
}

export interface CreateServerResponse {
  /** Cloudways operation id polled via /servers/operations/:id. Empty when the server was reused via label idempotency. */
  operationId: string;
  /** Server label sent to Cloudways; use the same value on retry to hit the idempotency path. */
  plannedLabel: string;
  /** Populated immediately when Cloudways returns a server id up-front OR when we reused an existing server by label. */
  serverId?: string;
  /** True when the response reused an existing server rather than starting a new POST /server. */
  reused?: boolean;
}

export interface ServerOperationStatus {
  operationId: string;
  isCompleted: boolean;
  status: string;
  message?: string;
  /** Populated once the operation completes successfully and we can resolve the label to an id. */
  serverId?: string;
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
