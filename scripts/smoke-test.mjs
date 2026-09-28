// Starts the built server over stdio and calls every tool against live data.
// Usage: npm test   (set GOOGLE_KG_API_KEY to include Google Knowledge Graph results)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "smoke-test", version: "0.0.0" });
await client.connect(
  new StdioClientTransport({ command: "node", args: ["dist/index.js"], env: { ...process.env } }),
);

const { tools } = await client.listTools();
console.log("Tools:", tools.map((t) => t.name).join(", "));

const calls = [
  ["find_entities", { query: "tesla", limit: 5 }],
  ["analyze_entity_prominence", { query: "tesla", limit: 5 }],
  ["compare_entities", { entities: ["hubspot", "salesforce"] }],
  ["get_entity", { id: "/m/0dr90d" }],
  ["get_entity", { id: "Q1428953" }],
];

const LIMIT = Number(process.env.SMOKE_LIMIT ?? 700);
let failed = 0;
for (const [name, args] of calls) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content[0].text;
  if (res.isError) failed++;
  console.log(`\n=== ${name} ${JSON.stringify(args)} ${res.isError ? "FAILED" : "ok"} ===\n${text.slice(0, LIMIT)}${text.length > LIMIT ? "\n..." : ""}`);
}

await client.close();
process.exit(failed ? 1 : 0);
