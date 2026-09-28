/**
 * Entity / Knowledge Graph lookups.
 *
 * - Google Knowledge Graph Search API: the entities Google holds for a name (IDs, types,
 *   descriptions, images, result scores). Needs a free API key in GOOGLE_KG_API_KEY.
 * - Wikidata: the entity's real-world connections (founders, HQ, products, ...) and
 *   official profiles. No key needed; also used as the search fallback without a key.
 */

const KG_ENDPOINT = "https://kgsearch.googleapis.com/v1/entities:search";
const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const USER_AGENT = "google_knowledge_panel_mcp_server (https://github.com/theseoriddler/google_knowledge_panel_mcp)";

/** Wikidata properties that link an entity to other entities, grouped as "connections". */
const CONNECTION_PROPS: Record<string, string> = {
  P31: "instance of",
  P112: "founded by",
  P169: "chief executive officer",
  P488: "chairperson",
  P159: "headquarters location",
  P17: "country",
  P452: "industry",
  P1056: "products",
  P749: "parent organization",
  P355: "subsidiaries",
  P127: "owned by",
  P1830: "owner of",
  P176: "manufacturer",
  P178: "developer",
  P170: "creator",
  P106: "occupation",
  P39: "position held",
  P108: "employer",
  P69: "educated at",
  P27: "country of citizenship",
  P19: "place of birth",
  P26: "spouse",
  P800: "notable work",
  P50: "author",
  P57: "director",
  P175: "performer",
  P136: "genre",
  P463: "member of",
  P361: "part of",
  P166: "awards received",
};

/** Wikidata properties holding plain facts (dates, numbers, URLs). */
const FACT_PROPS: Record<string, string> = {
  P571: "founded",
  P576: "dissolved",
  P569: "date of birth",
  P570: "date of death",
  P577: "publication date",
  P1128: "employees",
  P856: "official website",
};

/** Wikidata external-ID properties that map to official profiles (schema.org sameAs). */
const PROFILE_PROPS: Record<string, [string, (v: string) => string]> = {
  P2002: ["X (Twitter)", (v) => `https://x.com/${v}`],
  P2013: ["Facebook", (v) => `https://www.facebook.com/${v}`],
  P2003: ["Instagram", (v) => `https://www.instagram.com/${v}/`],
  P4264: ["LinkedIn", (v) => `https://www.linkedin.com/company/${v}/`],
  P6634: ["LinkedIn", (v) => `https://www.linkedin.com/in/${v}/`],
  P2397: ["YouTube", (v) => `https://www.youtube.com/channel/${v}`],
  P7085: ["TikTok", (v) => `https://www.tiktok.com/@${v}`],
  P2037: ["GitHub", (v) => `https://github.com/${v}`],
  P2088: ["Crunchbase", (v) => `https://www.crunchbase.com/organization/${v}`],
};

const MAX_VALUES_PER_PROP = 10;

const SOURCE_KG = "Google Knowledge Graph + Wikidata";
const SOURCE_WD = "Wikidata only (set GOOGLE_KG_API_KEY to include Google Knowledge Graph data)";

export interface KgMatch {
  id: string;
  name?: string;
  types: string[];
  description?: string;
  resultScore?: number;
  googleUrl: string;
}

export interface EntityOptions {
  limit?: number;
  language?: string;
  types?: string[];
}

export function hasKgKey() {
  return Boolean(process.env.GOOGLE_KG_API_KEY);
}

// ---------- Google Knowledge Graph ----------

async function kgRequest(params: Record<string, string | string[]>) {
  const query = new URLSearchParams({ key: process.env.GOOGLE_KG_API_KEY ?? "" });
  for (const [k, v] of Object.entries(params)) {
    for (const value of Array.isArray(v) ? v : [v]) query.append(k, value);
  }
  const res = await fetch(`${KG_ENDPOINT}?${query}`);
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Google Knowledge Graph API error (HTTP ${res.status}): ${data?.error?.message ?? res.statusText}`);
  }
  return (data.itemListElement ?? []) as any[];
}

/**
 * Google drops strong matches at small limits (e.g. limit=5 omits Tesla, Inc.), so always
 * fetch the maximum, rank by score, then trim.
 */
async function searchKg(p: { query?: string; ids?: string[]; language: string; types?: string[]; limit: number }) {
  const params: Record<string, string | string[]> = { languages: p.language, limit: "20" };
  if (p.ids?.length) params.ids = p.ids;
  else params.query = p.query ?? "";
  if (p.types?.length) params.types = p.types;
  return (await kgRequest(params))
    .map(toMatch)
    .sort((a, b) => (b.resultScore ?? 0) - (a.resultScore ?? 0))
    .slice(0, p.limit);
}

function toMatch(el: any): KgMatch & { raw: any } {
  const r = el.result ?? {};
  const id = String(r["@id"] ?? "").replace(/^kg:/, "");
  return {
    id,
    name: r.name,
    types: (r["@type"] ?? []).filter((t: string) => t !== "Thing"),
    description: r.description,
    resultScore: el.resultScore,
    googleUrl: `https://www.google.com/search?kgmid=${encodeURIComponent(id)}`,
    raw: r,
  };
}

// ---------- Wikidata ----------

async function wikidata(params: Record<string, string>) {
  const query = new URLSearchParams({ format: "json", ...params });
  const res = await fetch(`${WIKIDATA_API}?${query}`, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Wikidata request failed: HTTP ${res.status}`);
  return res.json() as Promise<any>;
}

/** Find the Wikidata item for a Google KG ID (/m/... = Freebase ID P646, /g/... = Google KG ID P2671). */
async function wikidataIdForKg(kgId: string): Promise<string | undefined> {
  const prop = kgId.startsWith("/m/") ? "P646" : "P2671";
  const data = await wikidata({ action: "query", list: "search", srsearch: `haswbstatement:${prop}=${kgId}` });
  return data?.query?.search?.[0]?.title;
}

async function wikidataSearch(query: string, language: string, limit: number) {
  const data = await wikidata({ action: "wbsearchentities", search: query, language, uselang: language, limit: String(limit) });
  const norm = (x?: string) => (x ?? "").trim().toLowerCase();
  return (data.search ?? []).map((s: any) => ({
    id: s.id as string,
    name: s.label as string,
    description: s.description as string,
    exact: norm(s.label) === norm(query) || norm(s.match?.text) === norm(query),
  }));
}

async function wikidataLabels(ids: string[], language: string) {
  const labels: Record<string, string> = {};
  for (let i = 0; i < ids.length; i += 50) {
    const data = await wikidata({
      action: "wbgetentities",
      ids: ids.slice(i, i + 50).join("|"),
      props: "labels",
      languages: `${language}|en`,
    });
    for (const [id, e] of Object.entries<any>(data.entities ?? {})) {
      labels[id] = e.labels?.[language]?.value ?? e.labels?.en?.value ?? id;
    }
  }
  return labels;
}

/** Keep current, non-deprecated statements (drop ones with an end time, e.g. a former CEO). */
function currentClaims(claims: any[] = []) {
  const live = claims.filter((c) => c.rank !== "deprecated" && !c.qualifiers?.P582);
  const preferred = live.filter((c) => c.rank === "preferred");
  return (preferred.length ? preferred : live).slice(0, MAX_VALUES_PER_PROP);
}

async function wikidataEntity(qid: string, language: string) {
  const data = await wikidata({
    action: "wbgetentities",
    ids: qid,
    props: "labels|descriptions|claims|sitelinks/urls",
    languages: `${language}|en`,
  });
  const e = data.entities?.[qid];
  if (!e || e.missing !== undefined) return undefined;

  const claims = e.claims ?? {};
  const linkedIds = new Set<string>();
  for (const prop of Object.keys(CONNECTION_PROPS)) {
    for (const c of currentClaims(claims[prop])) {
      const id = c.mainsnak?.datavalue?.value?.id;
      if (id) linkedIds.add(id);
    }
  }
  const labels = await wikidataLabels([...linkedIds], language);

  const connections: Record<string, { name: string; wikidataId: string }[]> = {};
  for (const [prop, label] of Object.entries(CONNECTION_PROPS)) {
    const values = currentClaims(claims[prop])
      .map((c) => c.mainsnak?.datavalue?.value?.id)
      .filter(Boolean)
      .map((id: string) => ({ name: labels[id] ?? id, wikidataId: id }));
    if (values.length) connections[label] = values;
  }

  const facts: Record<string, string | string[]> = {};
  for (const [prop, label] of Object.entries(FACT_PROPS)) {
    const values = currentClaims(claims[prop]).map((c) => formatValue(c.mainsnak?.datavalue)).filter(Boolean) as string[];
    if (values.length) facts[label] = values.length === 1 ? values[0] : values;
  }

  const profiles: { platform: string; url: string }[] = [];
  for (const [prop, [platform, toUrl]] of Object.entries(PROFILE_PROPS)) {
    for (const c of currentClaims(claims[prop]).slice(0, 2)) {
      const v = c.mainsnak?.datavalue?.value;
      if (typeof v === "string") profiles.push({ platform, url: toUrl(v) });
    }
  }

  const logo = currentClaims(claims.P154)[0]?.mainsnak?.datavalue?.value ?? currentClaims(claims.P18)[0]?.mainsnak?.datavalue?.value;
  const sitelinks = e.sitelinks ?? {};
  const wikipedia = sitelinks[`${language}wiki`]?.url ?? sitelinks.enwiki?.url;

  return {
    id: qid,
    url: `https://www.wikidata.org/wiki/${qid}`,
    name: e.labels?.[language]?.value ?? e.labels?.en?.value,
    description: e.descriptions?.[language]?.value ?? e.descriptions?.en?.value,
    wikipedia,
    image: typeof logo === "string" ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(logo)}` : undefined,
    kgIds: [...currentClaims(claims.P646), ...currentClaims(claims.P2671)]
      .map((c) => c.mainsnak?.datavalue?.value)
      .filter(Boolean) as string[],
    wikipediaEditions: countWikipedias(sitelinks),
    wikidataStatements: countStatements(claims),
    facts,
    connections,
    profiles,
  };
}

/** Wikipedia language editions with an article (sitelinks like "enwiki", excluding non-Wikipedia wikis). */
function countWikipedias(sitelinks: Record<string, unknown>) {
  const notWikipedia = new Set(["commonswiki", "specieswiki", "metawiki", "wikidatawiki", "mediawikiwiki", "sourceswiki", "wikimaniawiki", "incubatorwiki", "outreachwiki", "wikifunctionswiki"]);
  return Object.keys(sitelinks).filter((k) => k.endsWith("wiki") && !notWikipedia.has(k)).length;
}

function countStatements(claims: Record<string, any[]>) {
  return Object.values(claims).reduce((n, list) => n + list.length, 0);
}

function countProfiles(claims: Record<string, any[]>) {
  return Object.keys(PROFILE_PROPS).filter((p) => claims[p]?.length).length;
}

/** Lightweight Wikidata stats for many items at once (used for prominence ranking). */
async function wikidataStats(qids: string[]) {
  const stats: Record<string, { wikipediaEditions: number; wikidataStatements: number; officialProfiles: number; wikipedia?: string }> = {};
  for (let i = 0; i < qids.length; i += 50) {
    const data = await wikidata({ action: "wbgetentities", ids: qids.slice(i, i + 50).join("|"), props: "claims|sitelinks/urls" });
    for (const [id, e] of Object.entries<any>(data.entities ?? {})) {
      if (e.missing !== undefined) continue;
      stats[id] = {
        wikipediaEditions: countWikipedias(e.sitelinks ?? {}),
        wikidataStatements: countStatements(e.claims ?? {}),
        officialProfiles: countProfiles(e.claims ?? {}),
        wikipedia: e.sitelinks?.enwiki?.url,
      };
    }
  }
  return stats;
}

function formatValue(dv: any): string | undefined {
  if (!dv) return undefined;
  switch (dv.type) {
    case "string":
      return dv.value;
    case "time": {
      // "+2003-07-01T00:00:00Z" at precision 9 (year), 10 (month) or 11 (day).
      const [date] = String(dv.value.time).replace(/^\+/, "").split("T");
      return dv.value.precision <= 9 ? date.slice(0, 4) : dv.value.precision === 10 ? date.slice(0, 7) : date;
    }
    case "quantity":
      return String(Number(dv.value.amount));
    case "monolingualtext":
      return dv.value.text;
    default:
      return undefined;
  }
}

// ---------- combined lookup ----------

/**
 * Search for entities by name (or look up one by ID) and build a full profile of the best match:
 * Google KG data, Wikidata connections, an entity-readiness checklist, and ready-to-use JSON-LD.
 */
export async function getEntity(query: string | undefined, id: string | undefined, opts: EntityOptions) {
  const language = opts.language ?? "en";
  const limit = opts.limit ?? 10;
  const useKg = hasKgKey();
  const isWikidataId = id ? /^Q\d+$/i.test(id) : false;

  // 1. Candidate entities
  let matches: (KgMatch & { raw?: any })[] = [];
  let wikidataMatches: { id: string; name: string; description: string; exact: boolean }[] = [];

  if (useKg && !isWikidataId) {
    matches = await searchKg({ query, ids: id ? [id] : undefined, language, types: opts.types, limit });
  }
  if (!useKg && !id && query) {
    wikidataMatches = await wikidataSearch(query, language, limit);
  }

  // 2. Pick the entity to profile
  let qid: string | undefined = isWikidataId ? id!.toUpperCase() : undefined;
  if (!qid && matches[0]) qid = await wikidataIdForKg(matches[0].id);
  if (!qid && id && !isWikidataId) qid = await wikidataIdForKg(id);
  // Wikidata search is fuzzy, so only auto-profile an exact name match (avoids profiling the wrong person).
  if (!qid && wikidataMatches[0]?.exact) qid = wikidataMatches[0].id;
  if (!qid && !matches.length && wikidataMatches.length) {
    return {
      query,
      source: SOURCE_WD,
      found: false,
      note: "No exact match on Wikidata. These are close matches; pass one's id to profile it. A Google Knowledge Graph API key finds far more entities (people and smaller brands often exist in Google's graph but not Wikidata).",
      closeMatches: wikidataMatches.map(({ exact: _e, ...m }) => ({ ...m, url: `https://www.wikidata.org/wiki/${m.id}` })),
    };
  }

  const wd = qid ? await wikidataEntity(qid, language) : undefined;

  // A Wikidata ID was given: fetch the linked Google entity so the Google checks still run.
  if (useKg && isWikidataId && wd?.kgIds.length) {
    matches = (await kgRequest({ ids: wd.kgIds, languages: language })).map(toMatch);
  }
  const top = matches[0];
  const kgId = top?.id ?? (id && !isWikidataId ? id : wd?.kgIds[0]);

  if (!top && !wd) {
    return { query, id, found: false, note: "No matching entity found in the Google Knowledge Graph or Wikidata." };
  }

  // 3. Merge into one profile
  const raw = top?.raw ?? {};
  const officialSite = raw.url ?? (Array.isArray(wd?.facts["official website"]) ? wd?.facts["official website"][0] : wd?.facts["official website"]);
  const profile = {
    name: top?.name ?? wd?.name,
    types: top?.types ?? [],
    description: top?.description ?? wd?.description,
    detailedDescription: raw.detailedDescription
      ? { text: raw.detailedDescription.articleBody, source: raw.detailedDescription.url, license: raw.detailedDescription.license }
      : undefined,
    image: raw.image?.contentUrl ?? wd?.image,
    officialWebsite: officialSite,
    knowledgeGraphId: kgId,
    googleUrl: kgId ? `https://www.google.com/search?kgmid=${encodeURIComponent(kgId)}` : undefined,
    resultScore: top?.resultScore,
    wikidata: wd ? { id: wd.id, url: wd.url, description: wd.description } : undefined,
    wikipedia: raw.detailedDescription?.url ?? wd?.wikipedia,
    wikipediaEditions: wd?.wikipediaEditions ?? 0,
    wikidataStatements: wd?.wikidataStatements ?? 0,
    facts: wd?.facts ?? {},
    connections: wd?.connections ?? {},
    profiles: wd?.profiles ?? [],
  };

  // 4. Readiness checklist (Google checks are unknown without an API key)
  const checks: { check: string; passed: boolean | null }[] = [
    { check: "Has a Google Knowledge Graph entry", passed: useKg ? Boolean(top) : null },
    { check: "Has a Google description", passed: useKg ? Boolean(top?.description) : null },
    { check: "Linked to a detailed source (e.g. Wikipedia)", passed: useKg ? Boolean(raw.detailedDescription) : null },
    { check: "Has an entity image", passed: Boolean(profile.image) },
    { check: "Has an official website", passed: Boolean(profile.officialWebsite) },
    { check: "Has a Wikidata item", passed: Boolean(wd) },
    { check: "Has a Wikipedia article", passed: Boolean(profile.wikipedia) },
    { check: "Has 2+ linked official profiles (sameAs)", passed: profile.profiles.length >= 2 },
  ];
  const scored = checks.filter((c) => c.passed !== null);
  const readiness = {
    score: Math.round((scored.filter((c) => c.passed).length / scored.length) * 100),
    basis: `${scored.filter((c) => c.passed).length} of ${scored.length} checks passed`,
    checks,
  };

  return {
    query,
    source: useKg ? SOURCE_KG : SOURCE_WD,
    entity: profile,
    readiness,
    jsonLd: buildJsonLd(profile),
    otherMatches: useKg
      ? matches.slice(1).map(({ raw: _raw, ...m }) => m)
      : wikidataMatches.filter((m) => m.id !== qid).map(({ exact: _e, ...m }) => ({ ...m, url: `https://www.wikidata.org/wiki/${m.id}` })),
  };
}

function buildJsonLd(p: {
  name?: string;
  types: string[];
  description?: string;
  image?: string;
  officialWebsite?: string;
  googleUrl?: string;
  wikidata?: { url: string };
  wikipedia?: string;
  profiles: { url: string }[];
  connections: Record<string, { name: string }[]>;
}) {
  const isPerson = p.types.includes("Person") || p.connections["instance of"]?.some((c) => c.name === "human");
  const type = isPerson ? "Person" : p.types[0] ?? "Organization";
  const sameAs = [p.wikipedia, p.wikidata?.url, p.googleUrl, ...p.profiles.map((x) => x.url)].filter(Boolean);
  const home = p.officialWebsite?.replace(/\/?$/, "/");
  return {
    "@context": "https://schema.org",
    "@type": type,
    ...(home ? { "@id": `${home}#${isPerson ? "person" : "organization"}` } : {}),
    name: p.name,
    ...(p.description ? { description: p.description } : {}),
    ...(p.officialWebsite ? { url: p.officialWebsite } : {}),
    ...(p.image ? { [isPerson ? "image" : "logo"]: p.image } : {}),
    ...(sameAs.length ? { sameAs } : {}),
  };
}

// ---------- find / prominence / compare ----------

/** Every entity the Knowledge Graph (or Wikidata, without a key) associates with a name. */
export async function findEntities(query: string, opts: EntityOptions) {
  const language = opts.language ?? "en";
  const limit = opts.limit ?? 10;
  if (hasKgKey()) {
    const matches = await searchKg({ query, language, types: opts.types, limit });
    return { query, source: SOURCE_KG, count: matches.length, entities: matches.map(({ raw: _raw, ...m }) => m) };
  }
  const matches = await wikidataSearch(query, language, limit);
  return {
    query,
    source: SOURCE_WD,
    count: matches.length,
    entities: matches.map(({ exact: _e, ...m }: any) => ({ ...m, url: `https://www.wikidata.org/wiki/${m.id}` })),
  };
}

interface Signals {
  resultScore?: number;
  relativeScore?: number;
  panelFields?: number;
  wikipediaEditions: number;
  wikidataStatements: number;
  officialProfiles: number;
}

const PROMINENCE_METHOD =
  "Heuristic 0-100 score, not a Google metric. Weights: Google result score relative to the top match 40, knowledge panel fields (description, detailed source, image, website) 20, Wikipedia editions 20 (100+ = full), Wikidata statements 10 (1000+ = full), official profiles 10 (5+ = full). Signals that aren't available are left out and the rest re-weighted.";

function prominenceScore(s: Signals) {
  const parts: [number, number | undefined][] = [
    [40, s.relativeScore],
    [20, s.panelFields === undefined ? undefined : s.panelFields / 4],
    [20, Math.min(1, Math.log10(s.wikipediaEditions + 1) / 2)],
    [10, Math.min(1, Math.log10(s.wikidataStatements + 1) / 3)],
    [10, Math.min(1, s.officialProfiles / 5)],
  ];
  const used = parts.filter(([, v]) => v !== undefined) as [number, number][];
  const weight = used.reduce((n, [w]) => n + w, 0);
  return Math.round((used.reduce((n, [w, v]) => n + w * v, 0) / weight) * 100);
}

function describeSignals(s: Signals, nextScore?: number) {
  const parts: string[] = [];
  if (s.relativeScore === 1) {
    const ratio = nextScore ? ` (${(s.resultScore! / nextScore).toFixed(1)}x the next match)` : "";
    parts.push(`highest Google result score${ratio}`);
  } else if (s.relativeScore !== undefined) {
    parts.push(`${Math.round(s.relativeScore * 100)}% of the top Google result score`);
  }
  if (s.panelFields !== undefined) parts.push(`${s.panelFields}/4 knowledge panel fields`);
  parts.push(s.wikipediaEditions ? `${s.wikipediaEditions} Wikipedia editions` : "no Wikipedia article");
  parts.push(s.wikidataStatements ? `${s.wikidataStatements} Wikidata statements` : "no Wikidata item");
  parts.push(`${s.officialProfiles} official profiles`);
  return parts.join("; ");
}

/** Rank the entities matched for a name by how strong their Knowledge Graph presence is. */
export async function analyzeEntityProminence(query: string, opts: EntityOptions) {
  const language = opts.language ?? "en";
  const limit = opts.limit ?? 10;
  const useKg = hasKgKey();

  type Candidate = { id: string; name?: string; types?: string[]; description?: string; qid?: string; raw?: any; resultScore?: number };
  let candidates: Candidate[];
  if (useKg) {
    const matches = await searchKg({ query, language, types: opts.types, limit });
    const qids = await Promise.all(matches.map((m) => wikidataIdForKg(m.id).catch(() => undefined)));
    candidates = matches.map((m, i) => ({ ...m, qid: qids[i] }));
  } else {
    candidates = (await wikidataSearch(query, language, limit)).map((m: any) => ({ ...m, qid: m.id }));
  }
  if (!candidates.length) return { query, source: useKg ? SOURCE_KG : SOURCE_WD, found: false, note: "No entities found." };

  const stats = await wikidataStats(candidates.map((c) => c.qid).filter(Boolean) as string[]);
  const topScore = candidates[0].resultScore;

  const ranking = candidates
    .map((c) => {
      const st = c.qid ? stats[c.qid] : undefined;
      const signals: Signals = {
        resultScore: c.resultScore,
        relativeScore: useKg && topScore ? (c.resultScore ?? 0) / topScore : undefined,
        panelFields: useKg ? [c.description, c.raw?.detailedDescription, c.raw?.image, c.raw?.url].filter(Boolean).length : undefined,
        wikipediaEditions: st?.wikipediaEditions ?? 0,
        wikidataStatements: st?.wikidataStatements ?? 0,
        officialProfiles: st?.officialProfiles ?? 0,
      };
      return {
        prominence: prominenceScore(signals),
        name: c.name,
        id: c.id,
        types: c.types,
        description: c.description,
        wikidataId: c.qid,
        reason: describeSignals(signals, signals.relativeScore === 1 ? candidates[1]?.resultScore : undefined),
        signals,
        googleUrl: useKg ? `https://www.google.com/search?kgmid=${encodeURIComponent(c.id)}` : undefined,
      };
    })
    .sort((a, b) => b.prominence - a.prominence)
    .map((r, i) => ({ rank: i + 1, ...r }));

  const [first, second] = ranking;
  const googleTop = useKg ? candidates[0].id : undefined;
  return {
    query,
    source: useKg ? SOURCE_KG : SOURCE_WD,
    strongest: {
      name: first.name,
      id: first.id,
      prominence: first.prominence,
      leadOverNext: second ? first.prominence - second.prominence : undefined,
      reason: first.reason,
      ...(googleTop && googleTop !== first.id
        ? { note: `Google's own top result for "${query}" is ${googleTop}; this entity ranks higher on the combined signals.` }
        : {}),
    },
    method: PROMINENCE_METHOD,
    ranking,
  };
}

const COMPARE_CONNECTIONS = [
  "instance of",
  "founded by",
  "chief executive officer",
  "headquarters location",
  "industry",
  "parent organization",
  "occupation",
  "employer",
];

/**
 * Resolve a name to one entity ID. Google's search doesn't always return the obvious entity
 * ("salesforce" tops out at Salesforce Marketing Cloud), so prefer an exact name match from
 * Google, then an exact match on Wikidata (which links to the Google entity), then Google's top result.
 */
async function resolveName(name: string, language: string): Promise<string | undefined> {
  const norm = (s?: string) => (s ?? "").trim().toLowerCase();
  const kg = hasKgKey() ? await searchKg({ query: name, language, limit: 20 }) : [];
  const exactKg = kg.find((m) => norm(m.name) === norm(name));
  if (exactKg) return exactKg.id;
  const wd = await wikidataSearch(name, language, 5);
  const exactWd = wd.find((m: any) => m.exact);
  if (exactWd) return exactWd.id;
  return kg[0]?.id ?? wd[0]?.id;
}

/** Compare 2-5 entities (IDs or names) side by side. */
export async function compareEntities(refs: string[], opts: EntityOptions) {
  const language = opts.language ?? "en";
  const useKg = hasKgKey();
  const isId = (r: string) => /^\/[mg]\//.test(r) || /^Q\d+$/i.test(r);

  const rows = await Promise.all(
    refs.map(async (input) => {
      try {
        const id = isId(input) ? input : await resolveName(input, language);
        if (!id) return { input, found: false as const };
        const r: any = await getEntity(undefined, id, { language });
        if (r.found === false) return { input, found: false as const };
        const e = r.entity;
        const passed = (label: string) => r.readiness.checks.find((c: any) => c.check.startsWith(label))?.passed;
        const signals: Signals = {
          panelFields: useKg
            ? ["Has a Google description", "Linked to a detailed source", "Has an entity image", "Has an official website"].filter(passed).length
            : undefined,
          wikipediaEditions: e.wikipediaEditions,
          wikidataStatements: e.wikidataStatements,
          officialProfiles: new Set(e.profiles.map((p: any) => p.platform)).size,
        };
        return {
          input,
          found: true as const,
          name: e.name as string,
          id: (e.knowledgeGraphId ?? e.wikidata?.id) as string,
          wikidataId: e.wikidata?.id as string | undefined,
          types: e.types as string[],
          description: e.description as string | undefined,
          officialWebsite: e.officialWebsite as string | undefined,
          wikipedia: e.wikipedia as string | undefined,
          prominence: prominenceScore(signals),
          readiness: r.readiness.score as number,
          missing: r.readiness.checks.filter((c: any) => c.passed === false).map((c: any) => c.check) as string[],
          signals,
          facts: e.facts,
          keyConnections: Object.fromEntries(
            COMPARE_CONNECTIONS.filter((k) => e.connections[k]).map((k) => [k, e.connections[k].slice(0, 3).map((x: any) => x.name)]),
          ),
          profiles: [...new Set(e.profiles.map((p: any) => p.platform))] as string[],
        };
      } catch (err) {
        return { input, found: false as const, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  const found = rows.filter((r) => r.found) as Extract<(typeof rows)[number], { found: true }>[];
  const leader = (metric: (r: (typeof found)[number]) => number) =>
    found.length ? label(found.reduce((a, b) => (metric(b) > metric(a) ? b : a))) : undefined;
  const label = (r: (typeof found)[number]) => `${r.name} (${r.id})`;

  return {
    source: useKg ? SOURCE_KG : SOURCE_WD,
    leaders: {
      prominence: leader((r) => r.prominence),
      readiness: leader((r) => r.readiness),
      wikipediaEditions: leader((r) => r.signals.wikipediaEditions),
      wikidataStatements: leader((r) => r.signals.wikidataStatements),
      officialProfiles: leader((r) => r.signals.officialProfiles),
    },
    method: `${PROMINENCE_METHOD} Google's result score is left out here because it is only comparable within a single search.`,
    entities: rows,
  };
}
