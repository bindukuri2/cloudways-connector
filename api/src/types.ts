/**
 * Wire contract types — kept in sync with /shared/types.ts (canonical).
 * For POC simplicity each package carries its own copy rather than wiring a
 * shared TS project reference. If you change this file, mirror it in
 *   - /shared/types.ts
 *   - /plugin/mcp-server/src/types.ts
 */

export type Framework =
  | "wordpress"
  | "wordpress-bedrock"
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
  workspaceRoot: string;
}

export interface GitSource {
  gitReady: boolean;
  gitUrl?: string;
  branch?: string;
  dirty?: boolean;
  reason?: string;
}

export interface DeployEnvVar {
  key: string;
  value?: string;
  redacted?: boolean;
  source: "wp-config.php" | ".env.example" | ".env" | "default";
}

export interface DeployRequest {
  appName: string;
  appType: AppType;
  stack: ProjectStack;
  git: GitSource;
  envVars: DeployEnvVar[];
  /** Skip app creation and attach Git to an existing Cloudways app. */
  existingAppId?: string;
  /** Cloudways server to deploy into. Falls back to CLOUDWAYS_SERVER_ID env when omitted. */
  serverId?: string;
}

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
  operationId: string;
  plannedLabel: string;
  serverId?: string;
  reused?: boolean;
}

export interface ServerOperationStatus {
  operationId: string;
  isCompleted: boolean;
  status: string;
  message?: string;
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
  /** Cloudways' own operation_id (the integer returned by /app, /git/*, etc.). */
  operationId: string;
  /** Optional latest status string Cloudways returned for this operation. */
  status?: string;
  /** Epoch ms when we first saw this op. */
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
  message: string;
  url?: string;
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
  error?: string;
  updatedAt: number;
  createdAt: number;
}

export interface DeployCreatedResponse {
  deploymentId: string;
  statusUrl: string;
}
