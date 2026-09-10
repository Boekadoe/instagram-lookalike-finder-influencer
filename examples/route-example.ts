/**
 * Voorbeeld: hoe het command center (Next.js) de Lookalike Finder API
 * aanroept zonder tegen Vercel's executietijd-limiet aan te lopen.
 *
 * Patroon: "fire-and-poll" — één route start de run en geeft meteen het
 * run-id terug; een tweede (dunne) route geeft de actuele status/resultaten
 * door. De BROWSER van de command-center-gebruiker pollt die tweede route
 * elke ~2s, precies zoals de losse frontend van de tool dat zelf ook doet.
 * Geen enkele serverless function-aanroep hoeft dus minuten te blijven
 * hangen.
 *
 * Bestandslocaties (Next.js App Router):
 *   app/api/lookalikes/route.ts          <- POST: start een nieuwe run (fase 1)
 *   app/api/lookalikes/[id]/route.ts     <- GET: status + (indien klaar) kandidaten
 *   app/api/lookalikes/[id]/matchmaking/route.ts  <- POST: start fase 2
 */

import { NextResponse } from "next/server";
import { createRun, getCandidates, getRun, startMatchmaking } from "@/lib/lookalike-finder-client";

// --- app/api/lookalikes/route.ts ---
export async function POST(req: Request) {
  const { seeds, desiredResults } = (await req.json()) as { seeds: string[]; desiredResults?: number };

  if (!seeds?.length) {
    return NextResponse.json({ error: "Geef minstens één seed-account op." }, { status: 400 });
  }

  const run = await createRun(seeds, desiredResults ?? 50);
  // Meteen teruggeven — niet wachten tot de run klaar is.
  return NextResponse.json(run);
}

// --- app/api/lookalikes/[id]/route.ts ---
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const run = await getRun(params.id);

  // Kandidaten zijn al te tonen zodra fase 1 klaar is ("discovered"), ook
  // vóór de AI-classificatie (fase 2) — nuttig om alvast te laten zien
  // terwijl de gebruiker op "Start AI matchmaking" kan klikken.
  const hasCandidates = ["discovered", "matchmaking", "done"].includes(run.status);
  const candidates = hasCandidates ? await getCandidates(run.id) : [];

  return NextResponse.json({ run, candidates });
}

// --- app/api/lookalikes/[id]/matchmaking/route.ts ---
export async function POST_matchmaking(_req: Request, { params }: { params: { id: string } }) {
  const run = await startMatchmaking(params.id);
  return NextResponse.json(run);
}

/**
 * Client-side polling in het command center (React), bv. in een hook:
 *
 *   const [run, setRun] = useState<Run | null>(null);
 *   const [candidates, setCandidates] = useState<Candidate[]>([]);
 *
 *   useEffect(() => {
 *     let cancelled = false;
 *     let timer: ReturnType<typeof setTimeout>;
 *     async function poll() {
 *       const res = await fetch(`/api/lookalikes/${runId}`);
 *       const data = await res.json();
 *       if (cancelled) return;
 *       setRun(data.run);
 *       setCandidates(data.candidates);
 *       if (["queued", "discovering", "matchmaking"].includes(data.run.status)) {
 *         timer = setTimeout(poll, 2000);
 *       }
 *     }
 *     poll();
 *     return () => { cancelled = true; clearTimeout(timer); };
 *   }, [runId]);
 *
 * Dit is exact hetzelfde patroon als frontend/app/runs/[id]/page.tsx in de
 * tool zelf — die pagina is een werkend, live voorbeeld om naast te leggen.
 */
