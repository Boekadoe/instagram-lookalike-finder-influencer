"""Cross-run master account list — the point of this router: the more you
use the tool, the bigger this deduplicated list of unique Instagram accounts
grows, instead of every run staying an isolated, disconnected result set.

Deduplication key is `user_id` (Instagram's permanent numeric ID), not
`username` — usernames can change between two runs that rediscover the same
account, but the ID never does.
"""
from collections import defaultdict
from types import SimpleNamespace

import asyncio
import logging
import random

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..db import SessionLocal, get_db
from ..export import candidates_to_csv
from ..models import Candidate
from ..schemas import CandidateOut, DeduplicateResult
from .runs import _filtered_candidates

logger = logging.getLogger(__name__)

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


class BackfillStatus:
    """In-memory singleton to track backfill progress (one backfill at a time)."""
    running: bool = False
    total: int = 0
    done: int = 0
    errors: int = 0

    def reset(self, total: int) -> None:
        self.running = True
        self.total = total
        self.done = 0
        self.errors = 0


_backfill_status = BackfillStatus()


async def _backfill_task(adapter, min_pause: float, max_pause: float) -> None:
    """Fetch media stats for every Candidate that has no avg_likes yet.
    Sequential per account, with a randomised human-paced pause between each."""
    db = SessionLocal()
    try:
        candidates = db.query(Candidate).filter(Candidate.avg_likes.is_(None)).all()
        _backfill_status.reset(len(candidates))
        logger.info("Media stats backfill started: %d accounts to process", len(candidates))

        for c in candidates:
            try:
                stats = await adapter.get_media_stats(c.user_id)
                if stats:
                    c.avg_likes = stats.avg_likes
                    c.avg_views = stats.avg_views
                    c.max_views = stats.max_views
                    c.reels_count = stats.reels_count
                    c.avg_comments = stats.avg_comments
                    c.sponsored_ratio = stats.sponsored_ratio
                    c.media_sampled_posts = stats.sampled_posts
                    db.commit()
            except Exception:
                logger.warning("Backfill failed for @%s", c.username, exc_info=True)
                _backfill_status.errors += 1

            _backfill_status.done += 1
            # Human-paced pause between accounts — different from the per-call
            # throttle inside the adapter, so we get adapter throttle + this pause.
            await asyncio.sleep(random.uniform(min_pause, max_pause))

        logger.info(
            "Media stats backfill done: %d/%d succeeded, %d errors",
            _backfill_status.done - _backfill_status.errors,
            _backfill_status.total,
            _backfill_status.errors,
        )
    finally:
        _backfill_status.running = False
        db.close()


@router.post("/backfill-media-stats")
def start_backfill_media_stats(
    background_tasks: BackgroundTasks,
    request: Request,
    min_pause: float = Query(5.0, description="Min seconden pauze tussen accounts"),
    max_pause: float = Query(12.0, description="Max seconden pauze tussen accounts"),
    db: Session = Depends(get_db),
):
    """Start een achtergrondtaak die voor elk account zonder media-stats
    de stats ophaalt via Instagram. Slechts één backfill tegelijk."""
    if _backfill_status.running:
        return {
            "started": False,
            "reason": "Backfill al bezig",
            "done": _backfill_status.done,
            "total": _backfill_status.total,
        }
    pending = db.query(Candidate).filter(Candidate.avg_likes.is_(None)).count()
    if pending == 0:
        return {"started": False, "reason": "Alle accounts hebben al media-stats", "pending": 0}

    adapter = request.app.state.instagram_adapter
    background_tasks.add_task(_backfill_task, adapter, min_pause, max_pause)
    return {"started": True, "pending": pending}


@router.get("/backfill-media-stats/status")
def backfill_status():
    """Voortgang van een lopende backfill."""
    return {
        "running": _backfill_status.running,
        "done": _backfill_status.done,
        "total": _backfill_status.total,
        "errors": _backfill_status.errors,
    }


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
