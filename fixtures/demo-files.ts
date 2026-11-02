// Candidate files of the demo (extracted from the prototype shared.js).
// Solution of "Candidat A7F3": public tests 8/8, hidden T9 fails.
import type { CandidateFiles } from '/web/types.ts'

export const demoFiles: CandidateFiles = {
  'src/app.ts': `import { parseCreateLink } from "./validation.ts";
import {
  AliasTakenError,
  createLink,
  deleteLink,
  findLink,
  recordClick,
} from "./links_repository.ts";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function generateAlias(): string {
  return crypto.randomUUID().slice(0, 7);
}

export async function handler(req: Request): Promise<Response> {
  const { pathname } = new URL(req.url);
  const parts = pathname.split("/").filter(Boolean);

  if (req.method === "POST" && pathname === "/links") {
    const body = await req.json().catch(() => null);
    const input = parseCreateLink(body);
    if (typeof input === "string") return json(400, { error: input });
    try {
      const link = await createLink(input.url, input.alias ?? generateAlias());
      return json(201, { alias: link.alias, url: link.url });
    } catch (err) {
      if (err instanceof AliasTakenError) return json(409, { error: err.message });
      throw err;
    }
  }

  if (req.method === "GET" && parts[0] === "links" && parts[2] === "stats") {
    const link = findLink(parts[1]);
    if (!link) return json(404, { error: "alias inconnu" });
    return json(200, { alias: link.alias, clicks: link.clicks });
  }

  if (req.method === "DELETE" && parts[0] === "links" && parts.length === 2) {
    if (!deleteLink(parts[1])) return json(404, { error: "alias inconnu" });
    return new Response(null, { status: 204 });
  }

  if (req.method === "GET" && parts.length === 1) {
    const link = recordClick(parts[0]);
    if (!link) return json(404, { error: "alias inconnu" });
    return new Response(null, { status: 302, headers: { location: link.url } });
  }

  return json(404, { error: "route inconnue" });
}

if (import.meta.main) Deno.serve(handler);`,
  'src/links_repository.ts': `export interface LinkRecord {
  alias: string;
  url: string;
  clicks: number;
  createdAt: string;
}

export class AliasTakenError extends Error {
  constructor(alias: string) {
    super(\`alias déjà utilisé : \${alias}\`);
  }
}

const store = new Map<string, LinkRecord>();

async function persist(record: LinkRecord): Promise<void> {
  // simule un stockage asynchrone
  await Promise.resolve();
  store.set(record.alias, record);
}

export async function createLink(url: string, alias: string): Promise<LinkRecord> {
  const existing = [...store.keys()].find((key) => key === alias);
  if (existing) {
    throw new AliasTakenError(alias);
  }
  const record: LinkRecord = { alias, url, clicks: 0, createdAt: new Date().toISOString() };
  await persist(record);
  return record;
}

export function findLink(alias: string): LinkRecord | undefined {
  return store.get(alias);
}

export function recordClick(alias: string): LinkRecord | undefined {
  const record = store.get(alias);
  if (record) record.clicks += 1;
  return record;
}

export function deleteLink(alias: string): boolean {
  return store.delete(alias);
}`,
  'src/validation.ts': `export interface CreateLinkInput {
  url: string;
  alias?: string;
}

const ALIAS_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function isValidUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    new URL(value);
    return true;
  } catch { return false; }
}

export function validateAlias(alias: unknown): string | null {
  if (alias === undefined) return null;
  if (typeof alias !== "string" || !ALIAS_PATTERN.test(alias)) {
    return "alias invalide";
  }
  if (alias.length > 32) return "alias trop long (32 max)";
  return null;
}

export function parseCreateLink(body: unknown): CreateLinkInput | string {
  if (typeof body !== "object" || body === null) return "corps invalide";
  const { url, alias } = body as Record<string, unknown>;
  if (!isValidUrl(url)) return "champ url manquant ou invalide";
  const aliasError = validateAlias(alias);
  if (aliasError) return aliasError;
  return { url, alias: alias as string | undefined };
}`,
  'src/app_test.ts': `import { assertEquals } from "@std/assert";
import { handler } from "./app.ts";

const post = (body: unknown) =>
  handler(new Request("http://localhost/links", {
    method: "POST",
    body: JSON.stringify(body),
  }));
const get = (path: string) => handler(new Request(\`http://localhost\${path}\`));

Deno.test("POST /links crée un lien avec alias", async () => {
  const res = await post({ url: "https://example.com", alias: "promo" });
  assertEquals(res.status, 201);
});

Deno.test("POST /links génère un alias", async () => {
  const res = await post({ url: "https://example.com" });
  const body = await res.json();
  assertEquals(res.status, 201);
  assertEquals(typeof body.alias, "string");
});

Deno.test("GET /:alias redirige en 302", async () => {
  await post({ url: "https://a.com", alias: "redir" });
  const res = await get("/redir");
  assertEquals(res.status, 302);
  assertEquals(res.headers.get("location"), "https://a.com");
});

Deno.test("alias déjà utilisé → 409", async () => {
  await post({ url: "https://a.com", alias: "double" });
  const res = await post({ url: "https://b.com", alias: "double" });
  assertEquals(res.status, 409);
});

Deno.test("url manquante → 400", async () => {
  const res = await post({ alias: "vide" });
  assertEquals(res.status, 400);
});

Deno.test("stats compte les clics", async () => {
  await post({ url: "https://a.com", alias: "compte" });
  await get("/compte");
  await get("/compte");
  const res = await get("/links/compte/stats");
  assertEquals((await res.json()).clicks, 2);
});`,
  'playground.ts': `import { handler } from "./src/app.ts";

const res = await handler(new Request("http://localhost/links", {
  method: "POST",
  body: JSON.stringify({ url: "https://example.com", alias: "promo" }),
}));

console.log(res.status, await res.json());`,
  'deno.json': `{
  "tasks": {
    "dev": "deno run --watch src/app.ts",
    "test": "deno test src/"
  },
  "imports": {
    "@std/assert": "jsr:@std/assert@1"
  }
}`,
  'README.md': `# Linkly — service de liens courts

## Lancer
deno task dev

## Tests
deno task test

## Choix
- Le stockage est isolé dans links_repository.ts.
- La validation est regroupée dans validation.ts.`,
}

// Workspace draft: links_repository.ts with a type error on line 27.
export const demoDraftRepository = `export interface LinkRecord {
  alias: string;
  url: string;
  clicks: number;
  createdAt: string;
}

export class AliasTakenError extends Error {
  constructor(alias: string) {
    super(\`alias déjà utilisé : \${alias}\`);
  }
}

const store = new Map<string, LinkRecord>();

async function persist(record: LinkRecord): Promise<void> {
  // simule un stockage asynchrone
  await Promise.resolve();
  store.set(record.alias, record);
}

export async function createLink(url: string, alias: string): Promise<LinkRecord> {
  const existing = [...store.keys()].find((key) => key === alias);
  if (existing) {
    throw new AliasTakenError(alias);
  }
  const record: LinkRecord = { alias, url, clicks: "0", createdAt: new Date().toISOString() };
  await persist(record);
  return record;
}

export function findLink(alias: string): LinkRecord | undefined {
  return store.get(alias);
}

export function recordClick(alias: string): LinkRecord | undefined {
  const record = store.get(alias);
  if (record) record.clicks += 1;
  return record;
}

export function deleteLink(alias: string): boolean {
  return store.delete(alias);
}`

export const demoFileOrder = [
  'src/app.ts',
  'src/links_repository.ts',
  'src/validation.ts',
  'src/app_test.ts',
  'playground.ts',
  'deno.json',
  'README.md',
]
