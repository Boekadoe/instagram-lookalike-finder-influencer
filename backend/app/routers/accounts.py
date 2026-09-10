"""Cross-run master account list — the point of this router: the more you
use the tool, the bigger this deduplicated list of unique Instagram accounts
grows, instead of every run staying an isolated, disconnected result set.

Deduplication key is `user_id` (Instagram's permanent numeric ID), not
`username` — usernames can change between two runs that rediscover the same
account, but the ID never does.
"""
from collections import defaultdict
from types import SimpleNamespace

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..db import get_db
from ..export import candidates_to_csv
from ..models import Candidate
from ..schemas import CandidateOut, DeduplicateResult
from .runs import _filtered_candidates

router = APIRouter(prefix="/accounts", tags=["accounts"])


def _to_namespace(c: Candidate) -> SimpleNamespace:
    return SimpleNamespace(**{col.name: getattr(c, col.name) for col in Candidate.__table__.columns})


def _dedupe_for_display(candidates: list[Candidate]) -> list[SimpleNamespace]:
    """One row per unique account (by user_id) for display, without touching
    the database: the freshest profile data, the strongest similarity score
    ever seen, and every seed it was ever found via, merged across runs."""
    groups: dict[str, list[Candidate]] = defaultdict(list)
    for c in candidates:
        groups[c.user_id].append(c)

    result = []
    for group in groups.values():
        group.sort(key=lambda c: c.created_at, reverse=True)
        keeper = _to_namespace(group[0])
        if len(group) > 1:
            keeper.similarity_score = max(c.similarity_score for c in group)
            keeper.found_via = sorted({s for c in group for s in (c.found_via or [])})
        result.append(keeper)
    result.sort(key=lambda c: c.similarity_score, reverse=True)
    return result


@router.get("", response_model=list[CandidateOut])
def list_accounts(
    min_followers: int | None = None,
    max_followers: int | None = None,
    countries: str | None = Query(None, description="Comma-separated country names, e.g. Netherlands,Belgium"),
    niches: str | None = Query(None, description="Comma-separated niche labels"),
    business_only: bool = False,
    min_score: int | None = None,
    db: Session = Depends(get_db),
):
    candidates = _filtered_candidates(db, None, min_followers, max_followers, countries, niches, business_only, min_score)
    return _dedupe_for_display(candidates)


@router.get("/export.csv")
def export_accounts_csv(
    min_followers: int | None = None,
    max_followers: int | None = None,
    countries: str | None = None,
    niches: str | None = None,
    business_only: bool = False,
    min_score: int | None = None,
    db: Session = Depends(get_db),
):
    candidates = _filtered_candidates(db, None, min_followers, max_followers, countries, niches, business_only, min_score)
    csv_text = candidates_to_csv(_dedupe_for_display(candidates))
    return StreamingResponse(
        iter([csv_text]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="boekadoe_accounts.csv"'},
    )


@router.post("/deduplicate", response_model=DeduplicateResult)
def deduplicate_accounts(db: Session = Depends(get_db)):
    """Actually deletes the redundant database rows (unlike the read-only
    dedup above) — keeps one row per user_id: the freshest profile data,
    the best similarity score, and the merged found_via across every run
    that ever surfaced this account. Irreversible; call from a confirmed
    action only."""
    all_candidates = db.query(Candidate).all()
    total_before = len(all_candidates)

    groups: dict[str, list[Candidate]] = defaultdict(list)
    for c in all_candidates:
        groups[c.user_id].append(c)

    removed = 0
    for group in groups.values():
        if len(group) <= 1:
            continue
        group.sort(key=lambda c: c.created_at, reverse=True)
        keeper, *others = group
        keeper.similarity_score = max(c.similarity_score for c in group)
        keeper.found_via = sorted({s for c in group for s in (c.found_via or [])})
        for other in others:
            db.delete(other)
            removed += 1
    db.commit()

    return DeduplicateResult(
        total_before=total_before,
        duplicates_removed=removed,
        unique_accounts=total_before - removed,
    )
