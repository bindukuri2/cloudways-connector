/**
 * WordPress / Bedrock / WooCommerce detection heuristics.
 *
 * Strategy:
 *   1. Look for WordPress core file/dir markers (Score-based; higher score wins ties).
 *   2. Look for Bedrock markers separately — if both classic WP and Bedrock match, prefer Bedrock.
 *   3. Detect WooCommerce in any of three places (plugin dir, composer.json, theme code).
 *   4. Resolve PHP version from .php-version / composer.json / Procfile, default 8.2.
 *   5. Read top-level theme via wp-content/themes/* style.css headers.
 *   6. Enumerate plugins from wp-content/plugins/*.
 */
import path from "node:path";
import { isDir, isFile, listDir, readTextSafe } from "./fsutil.js";
const DEFAULT_PHP = "8.2";
const CORE_FILE_SIGNALS = [
    "wp-config.php",
    "wp-config-sample.php",
    "wp-load.php",
    "wp-settings.php",
    "wp-login.php",
];
const CORE_DIR_SIGNALS = ["wp-admin", "wp-includes", "wp-content"];
const BEDROCK_FILES = ["config/application.php"];
const BEDROCK_COMPOSER_DEPS = ["roots/wordpress", "roots/bedrock", "johnpbloch/wordpress"];
const BEDROCK_WEB_DIRS = ["web/app", "web/wp"];
/**
 * Some Bedrock-style projects put WordPress under `web/wp/`. We probe a small list
 * of candidate sub-roots so the core-file detector still fires.
 */
function candidateCoreRoots(root) {
    return [root, path.join(root, "web/wp"), path.join(root, "wordpress"), path.join(root, "public")];
}
async function probeWordPressCore(root) {
    let best = { score: 0, hits: [], installRoot: root };
    for (const cand of candidateCoreRoots(root)) {
        const hits = [];
        let score = 0;
        for (const f of CORE_FILE_SIGNALS) {
            const p = path.join(cand, f);
            if (await isFile(p)) {
                hits.push({ signal: `core-file:${f}`, path: p });
                score += 3;
            }
        }
        for (const d of CORE_DIR_SIGNALS) {
            const p = path.join(cand, d);
            if (await isDir(p)) {
                hits.push({ signal: `core-dir:${d}`, path: p });
                score += 2;
            }
        }
        // Repos deployed to a managed WP host (Cloudways, etc.) usually only ship
        // wp-content/. WP core comes from the host, not the repo. Treat
        // wp-content/themes/<*>/style.css as a strong WP signal so those repos
        // still detect as wordpress (score >= 3).
        const themesDir = path.join(cand, "wp-content", "themes");
        if (await isDir(themesDir)) {
            hits.push({ signal: "wp-content/themes/", path: themesDir });
            score += 1;
            const entries = await listDir(themesDir);
            for (const slug of entries) {
                if (slug.startsWith("."))
                    continue;
                const styleCss = path.join(themesDir, slug, "style.css");
                const txt = await readTextSafe(styleCss);
                if (txt && /^[ \t/*#]*Theme Name:\s*\S/m.test(txt)) {
                    hits.push({ signal: `theme-style.css:${slug}`, path: styleCss });
                    score += 2;
                    break;
                }
            }
        }
        if (await isDir(path.join(cand, "wp-content", "mu-plugins"))) {
            hits.push({
                signal: "wp-content/mu-plugins/",
                path: path.join(cand, "wp-content", "mu-plugins"),
            });
            score += 1;
        }
        if (score > best.score) {
            best = { score, hits, installRoot: cand };
        }
    }
    return best;
}
async function probeBedrock(root, composer) {
    const hits = [];
    let matched = false;
    for (const f of BEDROCK_FILES) {
        const p = path.join(root, f);
        if (await isFile(p)) {
            hits.push({ signal: `bedrock-file:${f}`, path: p });
            matched = true;
        }
    }
    for (const d of BEDROCK_WEB_DIRS) {
        const p = path.join(root, d);
        if (await isDir(p)) {
            hits.push({ signal: `bedrock-dir:${d}`, path: p });
            matched = true;
        }
    }
    if (composer) {
        const allDeps = { ...(composer.require ?? {}), ...(composer["require-dev"] ?? {}) };
        for (const dep of BEDROCK_COMPOSER_DEPS) {
            if (dep in allDeps) {
                hits.push({ signal: `bedrock-composer:${dep}`, path: "composer.json" });
                matched = true;
            }
        }
    }
    return { matched, hits };
}
async function readComposerJson(root) {
    const text = await readTextSafe(path.join(root, "composer.json"));
    if (!text)
        return null;
    try {
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}
async function probeWooCommerce(root, wpContent, composer) {
    const hits = [];
    let hasWoo = false;
    if (wpContent) {
        const pluginMain = path.join(wpContent, "plugins", "woocommerce", "woocommerce.php");
        if (await isFile(pluginMain)) {
            hits.push({ signal: "woocommerce-plugin", path: pluginMain });
            hasWoo = true;
        }
    }
    if (composer) {
        const allDeps = { ...(composer.require ?? {}), ...(composer["require-dev"] ?? {}) };
        for (const dep of Object.keys(allDeps)) {
            if (dep === "wpackagist-plugin/woocommerce" ||
                dep.includes("/woocommerce") ||
                dep.startsWith("woocommerce/")) {
                hits.push({ signal: `woocommerce-composer:${dep}`, path: "composer.json" });
                hasWoo = true;
            }
        }
    }
    // Light heuristic for theme code referencing WC, only if we haven't matched yet.
    if (!hasWoo && wpContent) {
        const themesDir = path.join(wpContent, "themes");
        const themes = await listDir(themesDir);
        outer: for (const themeSlug of themes) {
            const functions = path.join(themesDir, themeSlug, "functions.php");
            const txt = await readTextSafe(functions);
            if (txt && /\bWooCommerce|wc_get_|wc_setup_|class-wc-/.test(txt)) {
                hits.push({ signal: "woocommerce-theme-code", path: functions });
                hasWoo = true;
                break outer;
            }
        }
    }
    return { hasWoo, hits };
}
async function detectTheme(wpContent) {
    if (!wpContent)
        return undefined;
    const themesDir = path.join(wpContent, "themes");
    const entries = await listDir(themesDir);
    for (const slug of entries) {
        if (slug.startsWith("."))
            continue;
        const styleCss = path.join(themesDir, slug, "style.css");
        const txt = await readTextSafe(styleCss);
        if (!txt)
            continue;
        const match = txt.match(/^[ \t/*#]*Theme Name:[ \t]*(.+?)[ \t]*$/m);
        if (match && match[1]) {
            return { name: match[1].trim(), slug };
        }
        // style.css present but no header — still surface as a theme candidate.
        return { name: slug, slug };
    }
    return undefined;
}
async function detectPlugins(wpContent) {
    if (!wpContent)
        return [];
    const pluginsDir = path.join(wpContent, "plugins");
    const out = [];
    for (const slug of await listDir(pluginsDir)) {
        if (slug.startsWith(".") || slug === "index.php")
            continue;
        const pluginDir = path.join(pluginsDir, slug);
        if (!(await isDir(pluginDir)))
            continue;
        // Try common entry-file names: <slug>.php, plugin.php; otherwise scan top-level .php files.
        const candidateFiles = [`${slug}.php`, "plugin.php"];
        let resolvedName;
        for (const file of candidateFiles) {
            const txt = await readTextSafe(path.join(pluginDir, file));
            if (txt) {
                const m = txt.match(/^[ \t/*#]*Plugin Name:[ \t]*(.+?)[ \t]*$/m);
                if (m && m[1]) {
                    resolvedName = m[1].trim();
                    break;
                }
            }
        }
        if (!resolvedName) {
            const files = await listDir(pluginDir);
            for (const f of files) {
                if (!f.endsWith(".php"))
                    continue;
                const txt = await readTextSafe(path.join(pluginDir, f));
                const m = txt?.match(/^[ \t/*#]*Plugin Name:[ \t]*(.+?)[ \t]*$/m);
                if (m && m[1]) {
                    resolvedName = m[1].trim();
                    break;
                }
            }
        }
        out.push({ slug, name: resolvedName });
    }
    return out;
}
async function detectPhpVersion(root, composer) {
    const phpVersionFile = await readTextSafe(path.join(root, ".php-version"));
    if (phpVersionFile) {
        const v = phpVersionFile.trim();
        if (v)
            return normalizePhp(v);
    }
    const platformPhp = composer?.config?.platform?.php;
    if (platformPhp)
        return normalizePhp(platformPhp);
    const composerPhp = composer?.require?.["php"];
    if (composerPhp)
        return normalizePhp(composerPhp);
    const procfile = await readTextSafe(path.join(root, "Procfile"));
    if (procfile) {
        const m = procfile.match(/php[\s-]*(\d+\.\d+)/i);
        if (m && m[1])
            return m[1];
    }
    return DEFAULT_PHP;
}
function normalizePhp(raw) {
    const m = raw.match(/(\d+\.\d+)/);
    return m && m[1] ? m[1] : DEFAULT_PHP;
}
function resolveWpContent(installRoot) {
    if (!installRoot)
        return null;
    return path.join(installRoot, "wp-content");
}
/**
 * "Static landing page" detection: an HTML-first project (e.g. index.html at
 * root, maybe a CSS/JS file or two) that the user wants to host on a managed
 * WordPress server. We treat this as a deployable shape so the deploy skill
 * can offer to scaffold a WordPress theme around it.
 */
async function probeStaticLanding(root) {
    const hits = [];
    const indexHtml = path.join(root, "index.html");
    if (!(await isFile(indexHtml)))
        return { matched: false, hits };
    hits.push({ signal: "static-html:index.html", path: indexHtml });
    for (const f of ["style.css", "main.css", "styles.css", "app.css"]) {
        const p = path.join(root, f);
        if (await isFile(p))
            hits.push({ signal: `static-css:${f}`, path: p });
    }
    for (const f of ["main.js", "app.js", "script.js", "index.js"]) {
        const p = path.join(root, f);
        if (await isFile(p))
            hits.push({ signal: `static-js:${f}`, path: p });
    }
    for (const d of ["assets", "images", "img", "static", "public", "css", "js"]) {
        const p = path.join(root, d);
        if (await isDir(p))
            hits.push({ signal: `static-dir:${d}`, path: p });
    }
    return { matched: true, hits };
}
/**
 * Top-level entry: detect the project stack at the given workspace root.
 * Always returns a populated ProjectStack, even for `unknown` projects (so the
 * agent can show the user what we looked at).
 */
export async function detectProjectStack(workspaceRoot) {
    const root = path.resolve(workspaceRoot);
    const evidence = [];
    const composer = await readComposerJson(root);
    if (composer)
        evidence.push({ signal: "composer.json", path: path.join(root, "composer.json") });
    const corePromise = probeWordPressCore(root);
    const bedrockPromise = probeBedrock(root, composer);
    const [core, bedrock] = await Promise.all([corePromise, bedrockPromise]);
    evidence.push(...core.hits, ...bedrock.hits);
    let framework = "unknown";
    let wpInstallRoot = null;
    if (bedrock.matched) {
        framework = "wordpress-bedrock";
        // Bedrock typically installs WP at web/wp/
        wpInstallRoot = (await isDir(path.join(root, "web", "wp"))) ? path.join(root, "web", "wp") : core.installRoot;
    }
    else if (core.score >= 3) {
        framework = "wordpress";
        wpInstallRoot = core.installRoot;
    }
    else {
        const staticLanding = await probeStaticLanding(root);
        if (staticLanding.matched) {
            framework = "static-landing";
            evidence.push(...staticLanding.hits);
        }
    }
    // For Bedrock the wp-content equivalent is web/app/
    let wpContent = null;
    if (framework === "wordpress-bedrock") {
        const bedrockApp = path.join(root, "web", "app");
        wpContent = (await isDir(bedrockApp)) ? bedrockApp : resolveWpContent(wpInstallRoot);
    }
    else if (framework === "wordpress") {
        wpContent = resolveWpContent(wpInstallRoot);
    }
    const woo = await probeWooCommerce(root, wpContent, composer);
    evidence.push(...woo.hits);
    const theme = framework === "unknown" ? undefined : await detectTheme(wpContent);
    if (theme) {
        evidence.push({
            signal: "theme:style.css",
            path: path.join(wpContent ?? root, "themes", theme.slug, "style.css"),
        });
    }
    const plugins = framework === "unknown" ? [] : await detectPlugins(wpContent);
    for (const p of plugins) {
        evidence.push({
            signal: `plugin:${p.slug}`,
            path: path.join(wpContent ?? root, "plugins", p.slug),
        });
    }
    const phpVersion = await detectPhpVersion(root, composer);
    return {
        framework,
        hasWooCommerce: woo.hasWoo,
        phpVersion,
        theme,
        plugins,
        evidence,
        workspaceRoot: root,
    };
}
//# sourceMappingURL=wordpress.js.map