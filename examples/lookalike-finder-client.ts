/**
 * Server-side client voor de Boekadoe Instagram Lookalike Finder API.
 *
 * Alleen server-side gebruiken (Route Handlers, Server Actions,
 * getServerSideProps) — nooit importeren in een "use client"-component, want
 * dit leest een geheime API-key uit server-only environment variables.
 *
 * Env vars (command center project, Vercel):
 *   LOOKALIKE_API_URL = https://instagram-lookalike-finder-influencer-production.up.railway.app
 *   LOOKALIKE_API_KEY = <zelfde waarde als API_KEY in de backend-service op Railway>
 *
 * Volledige endpoint-referentie: backend/API.md in de instagram-lookalike-finder repo,
 * of <base-url>/docs voor de interactieve Swagger-versie.
 */

const BASE_URL = process.env.LOOKALIKE_API_URL ?? "https://instagram-lookalike-finder-influencer-production.up.railway.app";
const API_KEY = process.env.LOOKALIKE_API_KEY;

if (!API_KEY && process.env.NODE_ENV === "production") {
  // Niet throwen bij import (zou de hele build/andere routes breken) —
  // pas hard falen zodra er echt een call wordt gedaan (zie request()).
  console.warn("[lookalike-finder-client] LOOKALIKE_API_KEY ontbreekt — calls krijgen 401.");
}

export type RunStatus = "queued" | "discovering" | "discovered" | "matchmaking" | "done" | "error";

export type Run = {
  id: string;
  created_at: string;
  seeds: string[];
  desired_results: number;
  status: RunStatus;
  progress_stage: string;
  progress_current: number;
  progress_total: number;
  error_message: string | null;
};

export type BioLink = { title: string; url: string };

export type Candidate = {
  username: string;
  full_name: string;
  followers: number;
  following: number;
  posts: number;
  biography: string;
  external_url: string | null;
  category: string | null;
  is_verified: boolean;
  is_business: boolean;
  is_private: boolean;
  profile_pic_url: string | null;
  profile_pic_url_hd: string | null;
  bio_links: BioLink[];
  account_type: number | null;
  account_type_name: string | null;
  category_name: string | null;
  business_category_name: string | null;
  business_contact_method: string | null;
  public_email: string | null;
  public_phone_country_code: string | null;
  public_phone_number: string | null;
  contact_phone_number: string | null;
  address_street: string | null;
  city_name: string | null;
  city_id: string | null;
  zip_code: string | null;
  latitude: number | null;
  longitude: number | null;
  instagram_location_id: string | null;
  has_threads_badge: boolean;
  threads_badge_label: string | null;
  has_broadcast_channel: boolean;
  interop_messaging_user_fbid: string | null;
  similarity_score: number;
  seed_overlap: number;
  found_via: string[];
  country: string | null;
  country_confidence: number;
  niche_primary: string | null;
  niche_secondary: string | null;
  is_influencer: boolean;
  commercial_potential: number;
};

export type CandidateFilters = {
  minFollowers?: number;
  maxFollowers?: number;
  countries?: string[]; // bv. ["Netherlands", "Belgium"]
  niches?: string[];
  businessOnly?: boolean;
  minScore?: number;
};

export type DeduplicateResult = {
  total_before: number;
  duplicates_removed: number;
  unique_accounts: number;
};

export class LookalikeApiError extends Error {
  constructor(
    public status: number,
    public body: string,
    url: string
  ) {
    super(`Lookalike API-fout ${status} op ${url}: ${body}`);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(API_KEY ? { "X-API-Key": API_KEY } : {}),
      ...(init?.headers ?? {}),
    },
    cache: "no-store", // run-status verandert continu, nooit cachen
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new LookalikeApiError(res.status, body, url);
  }
  return res.json() as Promise<T>;
}

function filterParams(filters: CandidateFilters = {}): string {
  const params = new URLSearchParams();
  if (filters.minFollowers != null) params.set("min_followers", String(filters.minFollowers));
  if (filters.maxFollowers != null) params.set("max_followers", String(filters.maxFollowers));
  if (filters.countries?.length) params.set("countries", filters.countries.join(","));
  if (filters.niches?.length) params.set("niches", filters.niches.join(","));
  if (filters.businessOnly) params.set("business_only", "true");
  if (filters.minScore != null) params.set("min_score", String(filters.minScore));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

// --- Fase 1: data ophalen ---

export function createRun(seeds: string[], desiredResults = 500): Promise<Run> {
  return request<Run>("/runs", {
    method: "POST",
    body: JSON.stringify({ seeds, desired_results: desiredResults }),
  });
}

export function getRun(id: string): Promise<Run> {
  return request<Run>(`/runs/${id}`);
}

export function listRuns(): Promise<Run[]> {
  return request<Run[]>("/runs");
}

// --- Fase 2: AI matchmaking (los te triggeren, na 'discovered') ---

export function startMatchmaking(id: string): Promise<Run> {
  return request<Run>(`/runs/${id}/matchmaking`, { method: "POST" });
}

// --- Resultaten van één run ---

export function getCandidates(runId: string, filters?: CandidateFilters): Promise<Candidate[]> {
  return request<Candidate[]>(`/runs/${runId}/candidates${filterParams(filters)}`);
}

export function exportCsvUrl(runId: string, filters?: CandidateFilters): string {
  const qs = filterParams(filters);
  return `${BASE_URL}/runs/${runId}/export.csv${qs}${qs ? "&" : "?"}api_key=${API_KEY ?? ""}`;
}

// --- Cross-run masterlijst: alle unieke accounts die de tool ooit vond ---

export function listAllAccounts(filters?: CandidateFilters): Promise<Candidate[]> {
  return request<Candidate[]>(`/accounts${filterParams(filters)}`);
}

export function exportAllAccountsCsvUrl(filters?: CandidateFilters): string {
  const qs = filterParams(filters);
  return `${BASE_URL}/accounts/export.csv${qs}${qs ? "&" : "?"}api_key=${API_KEY ?? ""}`;
}

/** Onomkeerbaar: verwijdert echt de dubbele database-rijen. Vraag bevestiging in de UI voor je dit aanroept. */
export function deduplicateAccounts(): Promise<DeduplicateResult> {
  return request<DeduplicateResult>("/accounts/deduplicate", { method: "POST" });
}

/**
 * Wacht (via polling) tot een run een van de gegeven statussen bereikt.
 *
 * Let op: alleen geschikt voor korte, lokale scripts of achtergrondtaken
 * zonder tijdslimiet — NIET aanroepen vanuit een Vercel Route
 * Handler/Server Action. Een volledige run kan makkelijk minuten duren
 * (Instagram-calls hebben ingebouwde vertraging), en Vercel serverless
 * functions hebben een executietijd-limiet (10s Hobby / tot 300s Pro,
 * geconfigureerd). Gebruik in een command center-UI in plaats daarvan het
 * fire-and-poll patroon uit route-example.ts: één call om te starten, en
 * laat de brówser (niet de serverless function) pollen op status.
 */
export async function waitForStatus(
  runId: string,
  statuses: RunStatus[],
  { intervalMs = 2000, timeoutMs = 5 * 60_000 }: { intervalMs?: number; timeoutMs?: number } = {}
): Promise<Run> {
  const start = Date.now();
  for (;;) {
    const run = await getRun(runId);
    if (statuses.includes(run.status)) return run;
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Timeout: run ${runId} bereikte niet [${statuses.join(", ")}] binnen ${timeoutMs}ms (huidige status: ${run.status})`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
