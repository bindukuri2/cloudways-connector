/**
 * Cloudways cache purge helpers.
 *
 * Cloudways exposes two cache-related operations that matter after deploy:
 *   - POST /app/cache with server_id + app_id: clears the selected app cache.
 *   - POST /service/varnish with server_id + action=purge: purges Varnish for
 *     the whole server. This is broader, but it is the documented API equivalent
 *     of the dashboard "Purge Varnish" button.
 */

import { CloudwaysApiError, type CloudwaysClient } from "./client.js";

export interface CachePurgeResult {
  appCachePurged: boolean;
  varnishPurged: boolean;
  appCacheError?: string;
  varnishError?: string;
}

export async function purgeAppCache(
  client: CloudwaysClient,
  args: { serverId: string; appId: string },
): Promise<unknown> {
  return client.request("/app/cache", {
    method: "POST",
    form: {
      server_id: args.serverId,
      app_id: args.appId,
    },
  });
}

export async function purgeServerVarnish(
  client: CloudwaysClient,
  serverId: string,
): Promise<unknown> {
  return client.request("/service/varnish", {
    method: "POST",
    form: {
      server_id: serverId,
      action: "purge",
    },
  });
}

/**
 * Best-effort cache purge used after every successful deploy.
 *
 * App-level cache is the target operation. Server-level Varnish purge is run
 * afterwards as an extra safety net because Varnish can still serve the old
 * default page immediately after app creation or Git clone.
 */
export async function purgeDeploymentCaches(
  client: CloudwaysClient,
  args: { serverId: string; appId: string },
): Promise<CachePurgeResult> {
  const result: CachePurgeResult = {
    appCachePurged: false,
    varnishPurged: false,
  };

  try {
    await purgeAppCache(client, args);
    result.appCachePurged = true;
  } catch (err) {
    result.appCacheError = formatPurgeError(err);
  }

  try {
    await purgeServerVarnish(client, args.serverId);
    result.varnishPurged = true;
  } catch (err) {
    result.varnishError = formatPurgeError(err);
  }

  return result;
}

function formatPurgeError(err: unknown): string {
  if (err instanceof CloudwaysApiError) {
    return `Cloudways HTTP ${err.status}: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}
