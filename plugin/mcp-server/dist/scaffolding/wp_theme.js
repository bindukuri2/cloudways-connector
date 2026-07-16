/**
 * Convert a static landing page (index.html + assets) into a working
 * WordPress theme plus an mu-plugin that auto-activates it on first hit.
 *
 * Design notes:
 *   - We never *execute* the user's HTML; we read it as text and split out
 *     <head> and <body> content via regex. This is good enough for hand-coded
 *     landing pages (the only shape we promise to support).
 *   - We do not move the user's static asset files (CSS/JS/images at the
 *     workspace root). They keep working because Cloudways' default
 *     .htaccess only rewrites to index.php for URLs that don't match a real
 *     file (`RewriteCond %{REQUEST_FILENAME} !-f`).
 *   - We DO delete the original `index.html`. Otherwise Apache's
 *     DirectoryIndex prefers index.html over index.php and the static page
 *     keeps winning — exactly the bug the user hit last time. Git history
 *     keeps the file recoverable.
 *   - The mu-plugin lives in `wp-content/mu-plugins/` which WP auto-loads;
 *     no admin click to activate the theme on first request.
 */
import path from "node:path";
import { promises as fs } from "node:fs";
import { isDir, isFile, readTextSafe } from "../detection/fsutil.js";
const SLUG_RE = /^[a-z][a-z0-9-]*[a-z0-9]$/;
export async function scaffoldWpTheme(args) {
    if (!SLUG_RE.test(args.themeSlug)) {
        throw new Error(`Invalid theme slug "${args.themeSlug}": must be lowercase kebab-case (a-z, 0-9, -).`);
    }
    const root = path.resolve(args.workspaceRoot);
    const indexHtml = path.join(root, "index.html");
    const html = await readTextSafe(indexHtml);
    if (!html) {
        throw new Error(`No index.html at ${indexHtml}. The static-landing scaffolder needs a top-level index.html to work from.`);
    }
    const { headInner, bodyInner, bodyAttrs, title } = splitHtml(html);
    const detectedTitle = title ?? args.siteTitle;
    const siteTitle = args.siteTitle ?? title ?? args.themeName;
    const themeDir = path.join(root, "wp-content", "themes", args.themeSlug);
    const muPluginsDir = path.join(root, "wp-content", "mu-plugins");
    const muPluginPath = path.join(muPluginsDir, `${args.themeSlug}-activator.php`);
    const created = [];
    const warnings = [];
    if (await isDir(themeDir)) {
        warnings.push(`Theme directory ${themeDir} already exists; refusing to overwrite.`);
        return {
            created,
            removed: [],
            warnings,
            themeDir,
            muPluginPath,
            detectedTitle,
        };
    }
    await fs.mkdir(themeDir, { recursive: true });
    await fs.mkdir(muPluginsDir, { recursive: true });
    const author = args.author ?? "deploy.intel";
    const styleCss = renderStyleCss({
        name: args.themeName,
        slug: args.themeSlug,
        author,
    });
    await writeFile(path.join(themeDir, "style.css"), styleCss, created);
    const headerPhp = renderHeaderPhp(headInner, bodyAttrs);
    await writeFile(path.join(themeDir, "header.php"), headerPhp, created);
    const footerPhp = renderFooterPhp();
    await writeFile(path.join(themeDir, "footer.php"), footerPhp, created);
    const frontPagePhp = renderFrontPagePhp(rewriteRelativeAssetUrls(bodyInner));
    await writeFile(path.join(themeDir, "front-page.php"), frontPagePhp, created);
    const indexPhp = renderIndexPhp();
    await writeFile(path.join(themeDir, "index.php"), indexPhp, created);
    const functionsPhp = renderFunctionsPhp({ slug: args.themeSlug });
    await writeFile(path.join(themeDir, "functions.php"), functionsPhp, created);
    const activator = renderMuPlugin({
        slug: args.themeSlug,
        siteTitle,
        author,
    });
    await writeFile(muPluginPath, activator, created);
    const removed = [];
    if (args.removeIndexHtml !== false) {
        try {
            await fs.unlink(indexHtml);
            removed.push(indexHtml);
        }
        catch (err) {
            warnings.push(`Could not remove ${indexHtml}: ${err instanceof Error ? err.message : String(err)}. ` +
                `Apache's DirectoryIndex prefers index.html over index.php, so leaving it will keep ` +
                `the static page winning over WordPress. Delete it manually before committing.`);
        }
    }
    else {
        warnings.push(`Left ${indexHtml} in place. Apache will serve it before WordPress's index.php — ` +
            `delete it before committing if you want the WP theme to render.`);
    }
    const rootEntries = await safeList(root);
    for (const f of rootEntries) {
        if (f.endsWith(".html") && f !== "index.html") {
            warnings.push(`Found ${f} at workspace root. WordPress won't route through it; ` +
                `if it's part of the design, move it into the new theme or delete it.`);
        }
    }
    if (await isFile(path.join(root, ".htaccess"))) {
        warnings.push(`Found .htaccess at workspace root. Cloudways manages its own .htaccess for WordPress; ` +
            `pushing yours can break routing. Review before committing.`);
    }
    return {
        created,
        removed,
        warnings,
        themeDir,
        muPluginPath,
        detectedTitle,
    };
}
async function safeList(dir) {
    try {
        return await fs.readdir(dir);
    }
    catch {
        return [];
    }
}
async function writeFile(p, contents, created) {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, contents, "utf8");
    created.push(p);
}
function splitHtml(html) {
    const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
    const bodyMatch = html.match(/<body([^>]*)>([\s\S]*?)<\/body>/i);
    const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
    const headInner = headMatch?.[1]?.trim() ?? "";
    const bodyInner = bodyMatch?.[2]?.trim() ?? html.trim();
    const bodyAttrs = bodyMatch?.[1]?.trim() ?? "";
    const title = titleMatch?.[1]?.trim();
    return { headInner, bodyInner, bodyAttrs, title };
}
/**
 * Rewrite relative src/href values to absolute (webroot-relative) so they
 * keep working on permalinks like `/about`. We DO NOT rewrite anything that
 * already starts with http(s)://, //, /, #, mailto:, tel:, data:, or a PHP tag.
 */
function rewriteRelativeAssetUrls(html) {
    return html.replace(/\b(src|href|poster)\s*=\s*(["'])([^"']+)\2/gi, (full, attr, quote, url) => {
        const v = String(url).trim();
        if (!v)
            return full;
        if (/^(?:https?:|\/\/|\/|#|mailto:|tel:|data:|<\?)/i.test(v))
            return full;
        return `${attr}=${quote}/${v.replace(/^\.\//, "")}${quote}`;
    });
}
function renderStyleCss(args) {
    return `/*
Theme Name: ${args.name}
Theme URI: https://example.com/${args.slug}
Author: ${args.author}
Description: Auto-scaffolded by deploy.intel from a static landing page.
Version: 0.1.0
License: MIT
Text Domain: ${args.slug}
*/

/* Original styles live alongside index.html at the project root; they keep
   working because Cloudways serves real files before falling through to
   WordPress. Add theme-specific overrides below this line. */
`;
}
function renderHeaderPhp(headInner, bodyAttrs) {
    const cleanedHead = stripHeadTags(headInner, ["title", "meta charset"]);
    const bodyClass = bodyAttrs.includes("class=")
        ? bodyAttrs
        : `${bodyAttrs ? bodyAttrs + " " : ""}<?php body_class(); ?>`.trim();
    return `<?php
/**
 * The header for the auto-scaffolded theme.
 */
?><!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo('charset'); ?>">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?php echo esc_html(get_bloginfo('name')); ?><?php echo (is_front_page() ? '' : ' | ' . esc_html(wp_title('', false))); ?></title>
${rewriteRelativeAssetUrls(cleanedHead)}
<?php wp_head(); ?>
</head>
<body ${bodyClass}>
`;
}
function renderFooterPhp() {
    return `<?php
/**
 * The footer for the auto-scaffolded theme.
 */
?>
<?php wp_footer(); ?>
</body>
</html>
`;
}
function renderFrontPagePhp(bodyInner) {
    return `<?php
/**
 * Front page: this is the converted body content of the original index.html.
 *
 * If you want WordPress to render different content on the home page, just
 * edit the markup below.
 */
get_header();
?>
${bodyInner}
<?php
get_footer();
`;
}
function renderIndexPhp() {
    return `<?php
/**
 * Fallback template. WordPress falls through to this for any request that
 * doesn't have a more specific template. We just render the front page
 * markup so the site never shows the bare-bones default.
 */
get_template_part('front-page');
`;
}
function renderFunctionsPhp({ slug }) {
    return `<?php
/**
 * Theme bootstrap.
 */

if (!function_exists('${slug.replace(/-/g, "_")}_setup')) {
  function ${slug.replace(/-/g, "_")}_setup() {
    add_theme_support('title-tag');
    add_theme_support('post-thumbnails');
    add_theme_support('automatic-feed-links');
  }
}
add_action('after_setup_theme', '${slug.replace(/-/g, "_")}_setup');

if (!function_exists('${slug.replace(/-/g, "_")}_enqueue')) {
  function ${slug.replace(/-/g, "_")}_enqueue() {
    wp_enqueue_style(
      '${slug}-theme',
      get_stylesheet_uri(),
      array(),
      wp_get_theme()->get('Version')
    );
  }
}
add_action('wp_enqueue_scripts', '${slug.replace(/-/g, "_")}_enqueue');
`;
}
function renderMuPlugin(args) {
    const escapedTitle = args.siteTitle.replace(/'/g, "\\'");
    return `<?php
/**
 * Plugin Name: ${args.slug} activator
 * Description: Auto-activate the ${args.slug} theme and set the site title on first hit.
 *   Lives in mu-plugins/ so it loads on every request and never needs admin
 *   activation. Safe to delete once the site is configured.
 * Author: ${args.author}
 * Version: 0.1.0
 */

if (!defined('ABSPATH')) {
  exit;
}

add_action('after_setup_theme', function () {
  if (get_template() !== '${args.slug}') {
    $stylesheet_root = get_theme_root() . '/${args.slug}';
    if (is_dir($stylesheet_root)) {
      switch_theme('${args.slug}');
    }
  }
});

add_action('init', function () {
  $desired = '${escapedTitle}';
  if (get_option('blogname') !== $desired) {
    update_option('blogname', $desired);
  }
});
`;
}
function stripHeadTags(headInner, _drop) {
    // Drop the original <title> and any <meta charset=...> we will re-emit
    // ourselves to keep WordPress happy.
    return headInner
        .replace(/<title>[\s\S]*?<\/title>/i, "")
        .replace(/<meta[^>]*charset=[^>]*>/i, "")
        .trim();
}
//# sourceMappingURL=wp_theme.js.map