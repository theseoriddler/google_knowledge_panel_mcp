# Google Knowledge Panel MCP Server

<a href="https://m8ven.ai/mcp/theseoriddler/google_knowledge_panel_mcp?s=docs" rel="noopener"><img src="https://m8ven.ai/badge/mcp/theseoriddler/google_knowledge_panel_mcp" alt="M8ven Score" height="20"></a>

An open-source [MCP](https://modelcontextprotocol.io) server for **entity SEO**. It lets Claude (or any MCP client) see what Google's Knowledge Graph, the data behind knowledge panels, holds for any brand, person or organization, how that entity connects to the real world, and what it still needs.

Ask things like *"Which 'tesla' entity has the strongest knowledge panel presence?"* or *"Compare HubSpot and Salesforce: what is each entity missing?"* and get answers backed by live Google Knowledge Graph and Wikidata data, plus ready-to-paste JSON-LD schema.

```
google_knowledge_panel_mcp
│
├── find_entities               every entity matched for a name
├── analyze_entity_prominence   which match has the strongest KG presence, and why
├── compare_entities            2-5 entities side by side
└── get_entity                  full profile + readiness checklist + JSON-LD
```

## Contents

- [What you can do with it](#what-you-can-do-with-it)
- [Quick start](#quick-start)
- [Setup in detail](#setup-in-detail)
  - [1. Get a free Google API key](#1-get-a-free-google-api-key-recommended)
  - [2. Add the server to your MCP client](#2-add-the-server-to-your-mcp-client)
  - [3. Check it works](#3-check-it-works)
- [Tools reference](#tools-reference)
- [The readiness checklist](#the-readiness-checklist)
- [How prominence is scored](#how-prominence-is-scored)
- [Example prompts and workflows](#example-prompts-and-workflows)
- [Data sources and limits](#data-sources-and-limits)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

## What you can do with it

- **Find every entity behind a name.** See each Knowledge Graph match for "sara taher" or "tesla", with its ID (`/m/0dr90d`), type, description and Google's result score.
- **Work out which entity is strongest.** Rank same-name entities on a transparent 0–100 prominence score, with a plain-English reason for each.
- **Benchmark competitors.** Compare 2–5 brands or people side by side, see who leads on each signal and what each one is missing.
- **Audit one entity.** Get its knowledge panel data, real-world connections (founders, CEO, HQ, products, parent company…), official social profiles and an 8-point readiness checklist.
- **Generate schema.** Get `Organization` or `Person` JSON-LD with `sameAs` links built from the entity's actual graph data.

## Quick start

You need [Node.js](https://nodejs.org) 18 or newer.

**Claude Code:**

```bash
claude mcp add knowledge-panel -e GOOGLE_KG_API_KEY=your-key-here -- npx -y github:theseoriddler/google_knowledge_panel_mcp
```

**Claude Desktop:** open **Settings → Developer → Edit Config**, add the block below, then restart Claude Desktop.

```json
{
  "mcpServers": {
    "knowledge-panel": {
      "command": "npx",
      "args": ["-y", "github:theseoriddler/google_knowledge_panel_mcp"],
      "env": { "GOOGLE_KG_API_KEY": "your-key-here" }
    }
  }
}
```

Then ask: *"Find every Knowledge Graph entity for 'tesla'. Which one is strongest?"*

The API key is optional. Without it the server runs on Wikidata only (see [below](#1-get-a-free-google-api-key-recommended)).

## Setup in detail

### 1. Get a free Google API key (recommended)

Without a key the server still works, but uses Wikidata only. That covers well-known entities, but many people and smaller brands exist in Google's Knowledge Graph and not in Wikidata. The key is free.

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create or pick a project.
2. Go to **APIs & Services → Library**, search for **Knowledge Graph Search API** and click **Enable**.
3. Go to **APIs & Services → Credentials → Create credentials → API key**.
4. Click the new key, and under **API restrictions** restrict it to the Knowledge Graph Search API. The free quota is 100,000 requests/day.

Test the key in a terminal:

```bash
curl "https://kgsearch.googleapis.com/v1/entities:search?query=tesla&limit=1&key=YOUR_KEY"
```

You should get JSON with an `itemListElement` array.

| Mode | What you get |
|---|---|
| **With `GOOGLE_KG_API_KEY`** | Google Knowledge Graph matches, IDs, types, result scores, descriptions, images, detailed descriptions, and all 8 readiness checks, plus Wikidata connections and profiles. |
| **Without a key** | Wikidata search, connections, profiles and 5 of the 8 readiness checks. Every result says `"source": "Wikidata only…"` so you know which mode you're in. |

### 2. Add the server to your MCP client

The server runs over stdio. Every client needs the same three things: the command `npx`, the args `-y github:theseoriddler/google_knowledge_panel_mcp`, and the `GOOGLE_KG_API_KEY` environment variable.

The first run downloads and builds the server, which takes a minute. Later runs are fast.

<details>
<summary><b>Claude Code</b></summary>

```bash
claude mcp add knowledge-panel -e GOOGLE_KG_API_KEY=your-key-here -- npx -y github:theseoriddler/google_knowledge_panel_mcp
```

Add `--scope user` to make it available in every project. Check it with `claude mcp list`, or `/mcp` inside a session.

</details>

<details>
<summary><b>Claude Desktop</b></summary>

Open **Settings → Developer → Edit Config**. This opens `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Add the server under `mcpServers` (merge with any servers already there):

```json
{
  "mcpServers": {
    "knowledge-panel": {
      "command": "npx",
      "args": ["-y", "github:theseoriddler/google_knowledge_panel_mcp"],
      "env": { "GOOGLE_KG_API_KEY": "your-key-here" }
    }
  }
}
```

Fully quit and restart Claude Desktop. The four tools appear under the tools (🔨) menu.

</details>

<details>
<summary><b>Cursor</b></summary>

Add to `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project):

```json
{
  "mcpServers": {
    "knowledge-panel": {
      "command": "npx",
      "args": ["-y", "github:theseoriddler/google_knowledge_panel_mcp"],
      "env": { "GOOGLE_KG_API_KEY": "your-key-here" }
    }
  }
}
```

</details>

<details>
<summary><b>VS Code (GitHub Copilot)</b></summary>

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "knowledge-panel": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "github:theseoriddler/google_knowledge_panel_mcp"],
      "env": { "GOOGLE_KG_API_KEY": "your-key-here" }
    }
  }
}
```

</details>

<details>
<summary><b>Any other MCP client / running from source</b></summary>

```bash
git clone https://github.com/theseoriddler/google_knowledge_panel_mcp.git
cd google_knowledge_panel_mcp
npm install        # also builds to dist/
```

Then point your client at:

```
command: node
args:    /absolute/path/to/google_knowledge_panel_mcp/dist/index.js
env:     GOOGLE_KG_API_KEY=your-key-here
```

</details>

> **Windows:** if your client can't find `npx`, use `"command": "cmd"` and `"args": ["/c", "npx", "-y", "github:theseoriddler/google_knowledge_panel_mcp"]`.

### 3. Check it works

Ask your assistant: *"Use find_entities to look up 'nike'."* The reply's `source` field tells you the mode:

- `"Google Knowledge Graph + Wikidata"`: the API key is working.
- `"Wikidata only (set GOOGLE_KG_API_KEY …)"`: no key was found. Check the `env` block and restart the client.

## Tools reference

All tools are read-only and return JSON.

### `find_entities`

Find every Knowledge Graph entity associated with a name, highest Google result score first.

| Input | Type | Default | Description |
|---|---|---|---|
| `query` | string | required | Name to search, e.g. `"tesla"` or `"sara taher"` |
| `limit` | number (1–20) | `10` | Max entities to return |
| `language` | string | `"en"` | Language code, e.g. `"fr"` |
| `types` | string[] | – | Only these schema.org types, e.g. `["Person"]` (Google results only) |

Returns each match's `id`, `name`, `types`, `description`, `resultScore` and a `googleUrl` (`https://www.google.com/search?kgmid=…`) that opens its knowledge panel.

### `analyze_entity_prominence`

Rank the entities matched for a name by how strong their Knowledge Graph presence is.

Inputs: same as `find_entities`.

Returns:

- `strongest`: the winner, its `prominence` score, its `leadOverNext` in points, and the `reason`. If Google's own top result differs, a `note` says so.
- `ranking`: every match with `rank`, `prominence`, `reason` and the raw `signals`.
- `method`: how the score was calculated.

```json
"strongest": {
  "name": "Tesla",
  "id": "Q478214",
  "prominence": 96,
  "leadOverNext": 28,
  "reason": "105 Wikipedia editions; 322 Wikidata statements; 7 official profiles"
}
```

### `compare_entities`

Compare 2–5 entities side by side.

| Input | Type | Default | Description |
|---|---|---|---|
| `entities` | string[] (2–5) | required | Knowledge Graph IDs (`/m/0dr90d`), Wikidata IDs (`Q478214`) or names (`"hubspot"`) |
| `language` | string | `"en"` | Language code |

A name resolves to an exact-name match on Google, then on Wikidata, then Google's top result. For same-name entities, pass IDs from `find_entities`.

Returns:

- `leaders`: who leads on prominence, readiness, Wikipedia editions, Wikidata statements and official profiles.
- `entities`: per entity, `prominence`, `readiness`, `missing` (failed checks), key `facts`, `keyConnections` (founder, CEO, HQ, industry, parent…) and `profiles`.

### `get_entity`

The full profile of one entity. Pass an `id` for a specific entity, or a `query` to profile the top match.

| Input | Type | Default | Description |
|---|---|---|---|
| `id` | string | – | Knowledge Graph ID (`/m/0dr90d`, `/g/11…`) or Wikidata ID (`Q478214`) |
| `query` | string | – | Name to search; the top match is profiled |
| `limit` | number (1–20) | `10` | Max `otherMatches` to return |
| `language` | string | `"en"` | Language code |
| `types` | string[] | – | Only these schema.org types |

Returns:

| Field | Contents |
|---|---|
| `entity` | Name, types, description, `detailedDescription` (text + source), image, official website, Knowledge Graph ID, `googleUrl`, Wikidata and Wikipedia links |
| `entity.facts` | Founded, dissolved, birth/death dates, employees, official website |
| `entity.connections` | Founders, CEO, chairperson, HQ, country, industry, products, parent organization, subsidiaries, owners, occupation, employer, education, awards, notable works and more |
| `entity.profiles` | X, Facebook, Instagram, LinkedIn, YouTube, TikTok, GitHub, Crunchbase |
| `readiness` | Score, basis and each [checklist](#the-readiness-checklist) item |
| `jsonLd` | Ready-to-paste schema.org markup |
| `otherMatches` | The other entities that matched the query |

Example `jsonLd` for `/m/0dr90d`:

```json
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": "https://www.tesla.com/#organization",
  "name": "Tesla",
  "description": "American automotive, energy storage and solar power company",
  "url": "https://www.tesla.com/",
  "logo": "https://commons.wikimedia.org/wiki/Special:FilePath/Tesla%20Motors.svg",
  "sameAs": [
    "https://en.wikipedia.org/wiki/Tesla,_Inc.",
    "https://www.wikidata.org/wiki/Q478214",
    "https://www.google.com/search?kgmid=%2Fm%2F0dr90d",
    "https://x.com/Tesla",
    "https://www.linkedin.com/company/tesla-motors/",
    "https://github.com/teslamotors"
  ]
}
```

Wrap it in `<script type="application/ld+json">…</script>` on your homepage (Organization) or about page (Person).

## The readiness checklist

`get_entity` and `compare_entities` score each entity on 8 checks:

| Check | Why it matters |
|---|---|
| Has a Google Knowledge Graph entry | Google has recognised the entity |
| Has a Google description | The short line under the panel title |
| Linked to a detailed source (e.g. Wikipedia) | The longer panel description and its source |
| Has an entity image | Panels with an image are more complete |
| Has an official website | Anchors the entity to a domain you control |
| Has a Wikidata item | The main open source Google cross-references |
| Has a Wikipedia article | The strongest single notability signal |
| Has 2+ linked official profiles (sameAs) | Confirms which social accounts belong to the entity |

The readiness score is the share of checks passed. The three Google checks are skipped (`"passed": null`) without an API key, and the score uses the remaining five.

## How prominence is scored

The prominence score is a transparent 0–100 heuristic, not a Google metric:

| Signal | Weight | Full marks at |
|---|---|---|
| Google result score, relative to the top match | 40 | top match |
| Knowledge panel fields (description, detailed source, image, website) | 20 | all 4 |
| Wikipedia language editions | 20 | 100+ |
| Wikidata statements | 10 | 1,000+ |
| Linked official profiles | 10 | 5+ |

Wikipedia editions and Wikidata statements are scored on a log scale, so going from 0 to 10 counts for more than going from 90 to 100.

Signals that aren't available are left out and the rest re-weighted. `compare_entities` leaves out Google's result score, because it's only comparable within one search. Google signals are also skipped without an API key.

## Example prompts and workflows

**Quick lookups**

- *"Find every Knowledge Graph entity for 'sara taher'. Which one is strongest?"*
- *"Which 'tesla' entity has the strongest Knowledge Graph presence, and why?"*
- *"Get the full profile of /m/0dr90d, including its connections."*
- *"Generate Organization schema for Nike from its knowledge graph data."*

**Personal brand audit**

1. *"Find every Knowledge Graph entity for '[your name]'."* Does Google have an entity for you? Is another person with the same name stronger?
2. *"Get the full profile of [your entity ID]."* Review the readiness checklist.
3. *"What should I do first to fix the failed checks?"* Typical fixes: a Wikidata item, linked social profiles, and `Person` schema on your site.
4. *"Give me the JSON-LD for my about page."*

**Competitor benchmark**

- *"Compare HubSpot, Salesforce and Zoho. Who has the strongest entity, and what is each missing?"*
- *"Compare /m/0dr90d and Q1428953."* (two entities with the same name: Tesla the company and Tesla the band)

**Disambiguation**

- *"Find all 'Apple' entities of type Organization."*
- *"Which 'Mercury' entity would Google most likely show a panel for?"*

## Data sources and limits

- **Google Knowledge Graph Search API** supplies entity IDs, types, descriptions, images and result scores. It is the same graph behind knowledge panels, but it doesn't return everything a panel shows (reviews, "people also search for", etc.).
- **Wikidata** supplies connections, facts, official profiles and Wikipedia coverage. The server finds an entity's Wikidata item through its Knowledge Graph ID (Freebase `P646` for `/m/…` IDs, `P2671` for `/g/…` IDs). If an entity has no Wikidata item, those sections are empty. Adding one is one of the most effective ways to strengthen an entity.
- **`resultScore` is Google's raw match score** for that search. It's only meaningful relative to other results for the same query.
- **Google's search doesn't always return the obvious entity.** For example, `salesforce` returns Salesforce Marketing Cloud, not Salesforce, Inc. `compare_entities` works around this by preferring exact name matches and checking Wikidata. With the other tools, use `find_entities` and pass the right ID.
- **Connections show current values only.** Statements with an end date (a former CEO, say) and deprecated statements are dropped. Up to 10 values per property are returned.
- **Review the JSON-LD before publishing.** Check the URL, logo and `sameAs` links, and add anything missing.

This project isn't affiliated with or endorsed by Google.

## Troubleshooting

| Problem | Fix |
|---|---|
| Results say `"Wikidata only"` though you set a key | The client isn't passing the env var. Check the `env` block spelling (`GOOGLE_KG_API_KEY`) and fully restart the client. |
| `Google Knowledge Graph API error (HTTP 403)` | The Knowledge Graph Search API isn't enabled for the key's project, or the key's restrictions block it. |
| `Google Knowledge Graph API error (HTTP 400)` | The key is invalid or mistyped. |
| `HTTP 429` | Quota exceeded (100,000/day by default). |
| Tools don't appear | Run `npx -y github:theseoriddler/google_knowledge_panel_mcp` in a terminal. It should start and wait silently (Ctrl+C to exit). If it errors, check `node -v` is 18+. |
| First start times out | The first run downloads and builds the server. Run the `npx` command once in a terminal, then restart the client. |
| `found: false` with `closeMatches` | Without a key, only exact Wikidata name matches are profiled. Pass one of the `closeMatches` IDs, or add an API key. |
| Wrong entity profiled | Run `find_entities` and pass the exact `id` to `get_entity`. |

## Development

```bash
git clone https://github.com/theseoriddler/google_knowledge_panel_mcp.git
cd google_knowledge_panel_mcp
npm install        # installs and builds to dist/
npm run build      # recompile after editing src/
npm test           # builds, starts the server and calls every tool against live data
```

Set `GOOGLE_KG_API_KEY` before `npm test` to include Google results. `SMOKE_LIMIT=2000 npm test` prints more of each response.

To try the tools interactively, use the [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

Project layout:

```
src/index.ts          MCP server and tool definitions
src/knowledge.ts      Google KG + Wikidata lookups, scoring, JSON-LD
scripts/smoke-test.mjs  end-to-end test over stdio
```

## Contributing

Issues and pull requests are welcome. Run `npm test` before submitting.

## License

[MIT](LICENSE)
