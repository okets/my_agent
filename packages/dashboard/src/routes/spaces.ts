import type { FastifyInstance } from "fastify";
import { readdirSync, statSync, readFileSync, existsSync } from "fs";
import { join, relative, extname, resolve } from "path";
import { readFrontmatter, writeFrontmatter } from "../metadata/frontmatter.js";

interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  children?: FileTreeNode[];
}

function buildFileTree(dir: string, rootDir: string): FileTreeNode[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const nodes: FileTreeNode[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = join(dir, entry.name);
    const relPath = relative(rootDir, fullPath);

    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: relPath,
        type: "directory",
        children: buildFileTree(fullPath, rootDir),
      });
    } else {
      const st = statSync(fullPath);
      nodes.push({
        name: entry.name,
        path: relPath,
        type: "file",
        size: st.size,
      });
    }
  }

  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export async function registerSpaceRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const agentDir = fastify.agentDir;

  // GET /api/spaces/:name — space detail (manifest + body + file tree)
  fastify.get<{ Params: { name: string } }>(
    "/api/spaces/:name",
    async (request, reply) => {
      const { name } = request.params;
      const spaceDir = join(agentDir, "spaces", name);

      if (!existsSync(spaceDir)) {
        return reply.code(404).send({ error: "Space not found" });
      }

      const manifestPath = join(spaceDir, "SPACE.md");
      let manifest: Record<string, unknown> | null = null;
      let body = "";

      if (existsSync(manifestPath)) {
        const fm = readFrontmatter(manifestPath);
        manifest = fm.data;
        body = fm.body;
      }

      const tree = buildFileTree(spaceDir, spaceDir);

      // Query automations that reference this space
      let referencingAutomations: {
        id: string;
        name: string;
        status: string;
      }[] = [];
      const convManager = fastify.conversationManager;
      if (convManager) {
        const db = convManager.getDb();
        referencingAutomations = db
          .prepare(
            `SELECT id, name, status FROM automations WHERE spaces LIKE ?`,
          )
          .all(`%${name.replace(/[%_"\\]/g, "")}%`) as {
          id: string;
          name: string;
          status: string;
        }[];
      }

      return { name, manifest, body, tree, referencingAutomations };
    },
  );

  // GET /api/spaces/:name/file — read a file from the space
  fastify.get<{ Params: { name: string }; Querystring: { path: string } }>(
    "/api/spaces/:name/file",
    async (request, reply) => {
      const { name } = request.params;
      const filePath = request.query.path;

      if (!filePath) {
        return reply.code(400).send({ error: "Missing path query parameter" });
      }

      const spaceDir = join(agentDir, "spaces", name);
      const fullPath = resolve(spaceDir, filePath);

      // Security: ensure resolved path is within the space directory
      if (!fullPath.startsWith(spaceDir + "/") && fullPath !== spaceDir) {
        return reply.code(403).send({ error: "Access denied" });
      }

      if (!existsSync(fullPath)) {
        return reply.code(404).send({ error: "File not found" });
      }

      const content = readFileSync(fullPath, "utf-8");
      const ext = extname(filePath).slice(1);
      return { path: filePath, content, extension: ext };
    },
  );

  // PATCH /api/spaces/:name — update space manifest fields
  fastify.patch<{ Params: { name: string } }>(
    "/api/spaces/:name",
    async (request, reply) => {
      const { name } = request.params;
      const updates = request.body as Record<string, unknown>;
      const spaceDir = join(agentDir, "spaces", name);
      const manifestPath = join(spaceDir, "SPACE.md");

      if (!existsSync(manifestPath)) {
        return reply.code(404).send({ error: "Space not found" });
      }

      const { data, body } = readFrontmatter(manifestPath);
      const merged = { ...data, ...updates };
      writeFrontmatter(manifestPath, merged, body);
      return { ok: true, manifest: merged };
    },
  );
}
