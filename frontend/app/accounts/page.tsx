"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  type Candidate,
  deduplicateAccounts,
  type DeduplicateResult,
  emptyFilters,
  exportAccountsCsvUrl,
  type Filters,
  filtersToParams,
  listAccounts,
} from "../../lib/api";
import FiltersPanel from "../../components/FiltersPanel";
import ResultsTable from "../../components/ResultsTable";

export default function AccountsPage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [loading, setLoading] = useState(true);
  const [deduping, setDeduping] = useState(false);
  const [dedupeResult, setDedupeResult] = useState<DeduplicateResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listAccounts(filtersToParams(filters));
      setCandidates(data);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDeduplicate() {
    const proceed = window.confirm(
      "Dit verwijdert permanent dubbele accounts uit de database (per account blijft alleen de meest recente vondst staan, met de hoogste score en alle seeds waarvia hij ooit is gevonden). Doorgaan?"
    );
    if (!proceed) return;

    setDeduping(true);
    try {
      const result = await deduplicateAccounts();
      setDedupeResult(result);
      await load();
    } finally {
      setDeduping(false);
    }
  }

  const countryOptions = Array.from(new Set(candidates.map((c) => c.country).filter((c): c is string => Boolean(c))));
  const nicheOptions = Array.from(
    new Set(candidates.map((c) => c.niche_primary).filter((n): n is string => Boolean(n) && n !== "unknown"))
  );

  return (
    <main className="page wide">
      <div className="card">
        <Link href="/" className="button button--ghost back-link">
          ← Nieuwe zoekopdracht
        </Link>
        <span className="eyebrow">Alle accounts</span>
        <h1>{loading ? "Laden..." : `${candidates.length} unieke accounts`}</h1>
        <p className="subtitle">
          Elk Instagram-account dat de tool ooit heeft gevonden, over al je runs heen — deze lijst wordt automatisch
          groter naarmate je de tool vaker gebruikt. Dubbele vondsten (hetzelfde account in meerdere runs) worden
          hier al samengevoegd getoond; de knop hieronder maakt dat ook permanent in de database.
        </p>

        <div className="phase-callout">
          <p>Verwijder dubbele database-rijen definitief (bewaart per account de nieuwste data + beste score).</p>
          <button onClick={handleDeduplicate} disabled={deduping}>
            {deduping ? "Bezig..." : "Duplicaten opruimen"}
          </button>
          {dedupeResult && (
            <p className="subtitle" style={{ marginTop: 8, marginBottom: 0 }}>
              {dedupeResult.duplicates_removed} duplicaten verwijderd — {dedupeResult.unique_accounts} unieke accounts
              over ({dedupeResult.total_before} rijen vóór het opruimen).
            </p>
          )}
        </div>

        <FiltersPanel filters={filters} onChange={setFilters} countryOptions={countryOptions} nicheOptions={nicheOptions} />

        <div className="export-row">
          <a className="button" href={exportAccountsCsvUrl(filtersToParams(filters))}>
            Export CSV
          </a>
        </div>

        {loading ? <p>Laden...</p> : <ResultsTable candidates={candidates} />}
      </div>
    </main>
  );
}
