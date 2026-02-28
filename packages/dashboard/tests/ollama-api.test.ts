/**
 * M6-S9: Ollama API Endpoint Tests
 *
 * Tests the memory API endpoints related to Ollama configuration.
 * Uses mocked fetch for external Ollama calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { registerMemoryRoutes } from "../src/routes/memory.js";

// Mock global fetch for Ollama server calls
const originalFetch = global.fetch;
let mockFetch: ReturnType<typeof vi.fn>;

function setupMockFetch() {
  mockFetch = vi.fn();
  global.fetch = mockFetch;
}

function restoreFetch() {
  global.fetch = originalFetch;
}

function mockJsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as Response;
}

// -------------------------------------------------------------------
// Test Setup
// -------------------------------------------------------------------

describe("Memory API - Ollama Endpoints", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    setupMockFetch();

    app = Fastify({ logger: false });

    // Register routes with minimal mocked dependencies
    await app.register(
      async (instance) => {
        // Add minimal memoryDb mock
        instance.decorate("memoryDb", {
          getStatus: () => ({
            filesIndexed: 0,
            totalChunks: 0,
            lastSync: null,
            dimensions: null,
            embeddingsReady: false,
          }),
          agentDir: "/tmp/test-agent",
        });

        // Add minimal pluginRegistry mock
        instance.decorate("pluginRegistry", {
          getActive: () => null,
          list: () => [],
          isDegraded: () => false,
          getDegradedHealth: () => null,
          getIntendedPluginId: () => null,
          get: () => null,
        });

        await registerMemoryRoutes(instance);
      },
      { prefix: "/api/memory" },
    );

    await app.ready();
  });

  afterEach(async () => {
    restoreFetch();
    await app.close();
  });

  // -------------------------------------------------------------------
  // GET /api/memory/embeddings/ollama/models
  // -------------------------------------------------------------------

  describe("GET /api/memory/embeddings/ollama/models", () => {
    it("returns models list from Ollama server", async () => {
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({
          models: [
            { name: "nomic-embed-text:latest", size: 274000000 },
            { name: "mxbai-embed-large:latest", size: 669000000 },
            { name: "llama3:8b", size: 4700000000 },
          ],
        }),
      );

      const response = await app.inject({
        method: "GET",
        url: "/api/memory/embeddings/ollama/models?host=http://localhost:11434",
      });

      expect(response.statusCode).toBe(200);

      const data = JSON.parse(response.payload);
      expect(data.models).toHaveLength(3);
      expect(data.models[0].name).toBe("nomic-embed-text:latest");
      expect(data.host).toBe("http://localhost:11434");
    });

    it("uses default host when not provided", async () => {
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ models: [] }));

      const response = await app.inject({
        method: "GET",
        url: "/api/memory/embeddings/ollama/models",
      });

      expect(response.statusCode).toBe(200);

      // Check that fetch was called with default host
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:11434/api/tags",
        expect.anything(),
      );
    });

    it("returns 502 when Ollama server is unreachable", async () => {
      mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const response = await app.inject({
        method: "GET",
        url: "/api/memory/embeddings/ollama/models?host=http://your-ollama-server:11434",
      });

      expect(response.statusCode).toBe(502);

      const data = JSON.parse(response.payload);
      expect(data.error).toContain("Cannot reach Ollama");
      expect(data.models).toEqual([]);
    });

    it("returns 502 when Ollama returns HTTP error", async () => {
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({ error: "internal error" }, 500),
      );

      const response = await app.inject({
        method: "GET",
        url: "/api/memory/embeddings/ollama/models",
      });

      expect(response.statusCode).toBe(502);

      const data = JSON.parse(response.payload);
      expect(data.error).toContain("HTTP 500");
    });

    it("returns empty models array (no filtering)", async () => {
      mockFetch.mockResolvedValueOnce(
        mockJsonResponse({
          models: [
            { name: "llama3:8b", size: 4700000000 },
            { name: "mistral:7b", size: 4200000000 },
          ],
        }),
      );

      const response = await app.inject({
        method: "GET",
        url: "/api/memory/embeddings/ollama/models",
      });

      expect(response.statusCode).toBe(200);

      const data = JSON.parse(response.payload);
      // All models returned (no filtering)
      expect(data.models).toHaveLength(2);
    });

    it("handles URL-encoded host parameter", async () => {
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ models: [] }));

      const response = await app.inject({
        method: "GET",
        url:
          "/api/memory/embeddings/ollama/models?host=" +
          encodeURIComponent("http://your-ollama-server:11434"),
      });

      expect(response.statusCode).toBe(200);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://your-ollama-server:11434/api/tags",
        expect.anything(),
      );
    });
  });

  // -------------------------------------------------------------------
  // GET /api/memory/status - pluginState field
  // -------------------------------------------------------------------

  describe("GET /api/memory/status - pluginState", () => {
    it("returns initialized: false when memoryDb not available", async () => {
      // Create app without memoryDb
      const bareApp = Fastify({ logger: false });

      await bareApp.register(
        async (instance) => {
          // No memoryDb decorated
          await registerMemoryRoutes(instance);
        },
        { prefix: "/api/memory" },
      );
      await bareApp.ready();

      const response = await bareApp.inject({
        method: "GET",
        url: "/api/memory/status",
      });

      expect(response.statusCode).toBe(200);

      const data = JSON.parse(response.payload);
      expect(data.initialized).toBe(false);
      expect(data.error).toBeDefined();

      await bareApp.close();
    });

    it("returns status with embeddings info", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/memory/status",
      });

      expect(response.statusCode).toBe(200);

      const data = JSON.parse(response.payload);
      expect(data.initialized).toBe(true);
      expect(data.index).toBeDefined();
      expect(data.embeddings).toBeDefined();
    });
  });
});

// -------------------------------------------------------------------
// Edge Cases - Search with lazy recovery
// -------------------------------------------------------------------

describe("Memory API - Search Edge Cases", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    setupMockFetch();

    app = Fastify({ logger: false });

    await app.register(
      async (instance) => {
        instance.decorate("memoryDb", {
          getStatus: () => ({
            filesIndexed: 0,
            totalChunks: 0,
            lastSync: null,
            dimensions: 768,
            embeddingsReady: true,
          }),
        });

        instance.decorate("pluginRegistry", {
          getActive: () => null,
          list: () => [],
          isDegraded: () => false,
          getDegradedHealth: () => null,
          getIntendedPluginId: () => null,
          get: () => null,
          setActive: vi.fn(),
        });

        instance.decorate("searchService", {
          recall: vi.fn().mockResolvedValue({
            notebook: [],
            daily: [],
            degraded: undefined,
          }),
        });

        await registerMemoryRoutes(instance);
      },
      { prefix: "/api/memory" },
    );

    await app.ready();
  });

  afterEach(async () => {
    restoreFetch();
    await app.close();
  });

  it("returns empty results for empty query", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/memory/search?q=",
    });

    expect(response.statusCode).toBe(200);

    const data = JSON.parse(response.payload);
    expect(data.query).toBe("");
    expect(data.notebook).toEqual([]);
    expect(data.daily).toEqual([]);
    expect(data.totalResults).toBe(0);
  });

  it("returns empty results for whitespace-only query", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/memory/search?q=%20%20%20",
    });

    expect(response.statusCode).toBe(200);

    const data = JSON.parse(response.payload);
    expect(data.totalResults).toBe(0);
  });

  it("handles search service not initialized", async () => {
    // Create app without searchService
    const bareApp = Fastify({ logger: false });

    await bareApp.register(
      async (instance) => {
        instance.decorate("memoryDb", {
          getStatus: () => ({}),
        });
        instance.decorate("pluginRegistry", {
          isDegraded: () => false,
        });
        // No searchService
        await registerMemoryRoutes(instance);
      },
      { prefix: "/api/memory" },
    );
    await bareApp.ready();

    const response = await bareApp.inject({
      method: "GET",
      url: "/api/memory/search?q=test",
    });

    expect(response.statusCode).toBe(503);

    const data = JSON.parse(response.payload);
    expect(data.error).toContain("not initialized");

    await bareApp.close();
  });
});
