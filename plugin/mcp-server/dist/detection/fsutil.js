/**
 * Small filesystem helpers used by the detectors.
 * Everything here is strictly read-only.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
export async function pathExists(p) {
    try {
        await fs.access(p);
        return true;
    }
    catch {
        return false;
    }
}
export async function isFile(p) {
    try {
        const st = await fs.stat(p);
        return st.isFile();
    }
    catch {
        return false;
    }
}
export async function isDir(p) {
    try {
        const st = await fs.stat(p);
        return st.isDirectory();
    }
    catch {
        return false;
    }
}
/** Read a file as utf-8, returning null on any failure (missing / unreadable). */
export async function readTextSafe(p) {
    try {
        return await fs.readFile(p, "utf8");
    }
    catch {
        return null;
    }
}
/** List entries of a directory (no recursion). Returns [] on error. */
export async function listDir(p) {
    try {
        return await fs.readdir(p);
    }
    catch {
        return [];
    }
}
/** Resolve a path relative to root, normalized; never escapes root. */
export function safeJoin(root, ...parts) {
    const joined = path.resolve(root, ...parts);
    const normalizedRoot = path.resolve(root);
    if (!joined.startsWith(normalizedRoot + path.sep) && joined !== normalizedRoot) {
        return normalizedRoot;
    }
    return joined;
}
//# sourceMappingURL=fsutil.js.map