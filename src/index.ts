#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { analyzeEntityProminence, compareEntities, findEntities, getEntity } from "./knowledge.js";

const server = new McpServer({
  name: "google_knowledge_panel_mcp_server",
  version: "0.1.0",
});

// ---------- shared input fields ----------

const name = z.string().min(1).describe('Name to search, e.g. "tesla" or "sara taher".');
const limit = z.number().int().min(1).max(20).default(10).describe("Maximum number of entities to return.");
const language = z.string().min(2).default("en").describe('Language code, e.g. "en", "fr".');
const types = z
  .array(z.string())
  .optional()
  .describe('Only return these schema.org types (Google results only), e.g. ["Organization"] or ["Person"].');

const readOnly = { readOnlyHint: true, openWorldHint: true };
const KEY_NOTE = "Google data needs GOOGLE_KG_API_KEY; without it, results come from Wikidata only.";

// ---------- helpers ----------

async function run(fn: () => Promise<unknown>) {
  try {
    return { content: [{ type: "text" as const, text: JSON.stringify(await fn(), null, 2) }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
  }
}

// ---------- tools ----------

server.registerTool(
  "find_entities",
  {
    title: "Find entities",
    description: `Find all Knowledge Graph entities associated with a name (the entities behind Google's knowledge panels). Returns each match's Knowledge Graph ID, type, description, and Google's result score, highest first. ${KEY_NOTE}`,
    inputSchema: { query: name, limit, language, types },
    annotations: readOnly,
  },
  (args) => run(() => findEntities(args.query, args)),
);

server.registerTool(
  "analyze_entity_prominence",
  {
    title: "Analyze entity prominence",
    description: `Analyze the entities matched for a name and determine which has the strongest Knowledge Graph presence. Ranks them on a transparent 0-100 prominence score combining Google's result score, knowledge panel completeness, Wikipedia coverage, Wikidata depth, and linked official profiles, with a plain-English reason for each. ${KEY_NOTE}`,
    inputSchema: { query: name, limit, language, types },
    annotations: readOnly,
  },
  (args) => run(() => analyzeEntityProminence(args.query, args)),
);

server.registerTool(
  "compare_entities",
  {
    title: "Compare entities",
    description: `Compare 2-5 entities side by side: types, descriptions, prominence and readiness scores, what each is missing, key facts and connections, and official profiles. Use it for same-name entities (pass their IDs from find_entities) or for competitors (pass names like "hubspot" and "salesforce"). ${KEY_NOTE}`,
    inputSchema: {
      entities: z
        .array(z.string().min(1))
        .min(2)
        .max(5)
        .describe('Entities to compare: Knowledge Graph IDs ("/m/0dr90d"), Wikidata IDs ("Q478214"), or names (a name resolves to its top match).'),
      language,
    },
    annotations: readOnly,
  },
  (args) => run(() => compareEntities(args.entities, args)),
);

server.registerTool(
  "get_entity",
  {
    title: "Get entity",
    description: `Full profile of one entity: description, detailed description, image, official site, Wikipedia/Wikidata links, facts, real-world connections (founders, CEO, HQ, products, parent company...), official social profiles, an entity-readiness checklist, and ready-to-paste JSON-LD schema. Pass an id for a specific entity, or a query to profile the top match. ${KEY_NOTE}`,
    inputSchema: {
      query: name.optional(),
      id: z
        .string()
        .optional()
        .describe('A Knowledge Graph ID ("/m/0dr90d", "/g/11...") or a Wikidata ID ("Q478214").'),
      limit,
      language,
      types,
    },
    annotations: readOnly,
  },
  (args) =>
    run(async () => {
      if (!args.query && !args.id) throw new Error("Provide a query or an id.");
      return getEntity(args.query, args.id, args);
    }),
);

await server.connect(new StdioServerTransport());
