/**
 * Notebook API Routes (M6-S3)
 *
 * CRUD operations for notebook files in the new notebook/ folder structure.
 * Replaces the limited runtime file API.
 *
 * Structure:
 *   notebook/
 *   ├── operations/   Nina's operational rules (standing-orders, external-communications)
 *   ├── lists/        High-churn lists (reminders, shopping, todos)
 *   ├── reference/    Stable reference (contacts, preferences)
 *   ├── knowledge/    Learned facts and patterns
 *   └── daily/        One file per day (append-only)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { join, dirname, resolve, relative } from "node:path";
import {
  readFile,
  writeFile,
  readdir,
  stat,
  unlink,
  mkdir,
} from "node:fs/promises";

/**
 * Validate path is within notebook directory (prevent traversal attacks)
 */
function isValidNotebookPath(notebookDir: string, targetPath: string): boolean {
  const resolved = resolve(notebookDir, targetPath);
  const rel = relative(notebookDir, resolved);
  // Must not escape notebook dir, must not be absolute, and must not be empty
  return !rel.startsWith("..") && !rel.startsWith("/") && rel !== "";
}

/**
 * List files in a directory recursively
 */
async function listFilesRecursive(
  dir: string,
  basePath: string = "",
): Promise<
  Array<{
    path: string;
    name: string;
    type: "file" | "folder";
    size?: number;
    modified?: string;
    children?: Array<{
      path: string;
      name: string;
      type: "file" | "folder";
      size?: number;
      modified?: string;
    }>;
  }>
> {
  const results: Array<{
    path: string;
    name: string;
    type: "file" | "folder";
    size?: number;
    modified?: string;
    children?: Array<{
      path: string;
      name: string;
      type: "file" | "folder";
      size?: number;
      modified?: string;
    }>;
  }> = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const fullPath = join(dir, entry.name);
      const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        const children = await listFilesRecursive(fullPath, relativePath);
        results.push({
          path: relativePath,
          name: entry.name,
          type: "folder",
          children: children as Array<{
            path: string;
            name: string;
            type: "file" | "folder";
            size?: number;
            modified?: string;
          }>,
        });
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        try {
          const stats = await stat(fullPath);
          results.push({
            path: relativePath,
            name: entry.name,
            type: "file",
            size: stats.size,
            modified: stats.mtime.toISOString(),
          });
        } catch {
          // Skip files we can't stat
        }
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return results;
}

/**
 * Register notebook routes
 */
export async function registerNotebookRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const agentDir = fastify.agentDir;
  const notebookDir = join(agentDir, "notebook");

  /**
   * GET /api/notebook
   *
   * List all notebook folders and files (tree structure)
   */
  fastify.get("/", async (_request, reply) => {
    const tree = await listFilesRecursive(notebookDir);

    // Also return folder summaries
    const folders = ["operations", "lists", "reference", "knowledge", "daily"];
    const summary: Record<string, { fileCount: number; totalSize: number }> =
      {};

    for (const folder of folders) {
      const folderNode = tree.find(
        (n) => n.name === folder && n.type === "folder",
      );
      if (folderNode && folderNode.children) {
        const files = folderNode.children.filter((c) => c.type === "file");
        summary[folder] = {
          fileCount: files.length,
          totalSize: files.reduce((sum, f) => sum + (f.size || 0), 0),
        };
      } else {
        summary[folder] = { fileCount: 0, totalSize: 0 };
      }
    }

    return {
      tree,
      summary,
      notebookDir,
    };
  });

  /**
   * GET /api/notebook/:path
   *
   * Read a notebook file
   * Path can be nested: "reference/contacts.md" or "daily/2026-02-24.md"
   */
  fastify.get<{ Params: { "*": string } }>("/*", async (request, reply) => {
    const filePath = request.params["*"];

    // Validate path
    if (!filePath || !isValidNotebookPath(notebookDir, filePath)) {
      return reply.code(400).send({ error: "Invalid path" });
    }

    const fullPath = join(notebookDir, filePath);

    try {
      const content = await readFile(fullPath, "utf-8");
      const stats = await stat(fullPath);

      return {
        path: filePath,
        content,
        size: stats.size,
        modified: stats.mtime.toISOString(),
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return reply.code(404).send({ error: "File not found" });
      }
      throw err;
    }
  });

  /**
   * PUT /api/notebook/:path
   *
   * Write/update a notebook file
   */
  fastify.put<{ Params: { "*": string }; Body: { content: string } }>(
    "/*",
    async (request, reply) => {
      const filePath = request.params["*"];
      const { content } = request.body || {};

      // Validate path
      if (!filePath || !isValidNotebookPath(notebookDir, filePath)) {
        return reply.code(400).send({ error: "Invalid path" });
      }

      if (typeof content !== "string") {
        return reply.code(400).send({ error: "content is required" });
      }

      // Only allow .md files
      if (!filePath.endsWith(".md")) {
        return reply.code(400).send({ error: "Only .md files allowed" });
      }

      const fullPath = join(notebookDir, filePath);

      try {
        // Ensure directory exists
        await mkdir(dirname(fullPath), { recursive: true });

        // Write file
        await writeFile(fullPath, content, "utf-8");
        const stats = await stat(fullPath);

        fastify.log.info(
          `[Notebook] Wrote ${content.length} chars to ${filePath}`,
        );

        return {
          path: filePath,
          size: stats.size,
          modified: stats.mtime.toISOString(),
        };
      } catch (err) {
        fastify.log.error(err, `[Notebook] Failed to write ${filePath}`);
        return reply.code(500).send({
          error: err instanceof Error ? err.message : "Failed to write file",
        });
      }
    },
  );

  /**
   * DELETE /api/notebook/:path
   *
   * Delete a notebook file
   */
  fastify.delete<{ Params: { "*": string } }>("/*", async (request, reply) => {
    const filePath = request.params["*"];

    // Validate path
    if (!filePath || !isValidNotebookPath(notebookDir, filePath)) {
      return reply.code(400).send({ error: "Invalid path" });
    }

    // Don't allow deleting folders
    if (!filePath.endsWith(".md")) {
      return reply.code(400).send({ error: "Can only delete .md files" });
    }

    const fullPath = join(notebookDir, filePath);

    try {
      await unlink(fullPath);
      fastify.log.info(`[Notebook] Deleted ${filePath}`);
      return { success: true, path: filePath };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return reply.code(404).send({ error: "File not found" });
      }
      fastify.log.error(err, `[Notebook] Failed to delete ${filePath}`);
      return reply.code(500).send({
        error: err instanceof Error ? err.message : "Failed to delete file",
      });
    }
  });
}
