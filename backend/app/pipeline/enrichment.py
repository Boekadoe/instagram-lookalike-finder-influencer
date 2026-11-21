import asyncio

from ..adapters.base import IGMediaStats, IGProfile, InstagramAdapter


async def _enrich_one(
    adapter: InstagramAdapter, user_id: str
) -> tuple[str, IGProfile | None, IGMediaStats | None]:
    """Fetch profile then media stats sequentially for one account.
    Sequential (not parallel) so Instagram sees one request at a time per
    account — closer to human browsing behaviour and easier on the session."""
    profile = await adapter.get_profile(user_id)
    if profile is None:
        return user_id, None, None
    media = await adapter.get_media_stats(user_id)
    return user_id, profile, media


async def enrich_candidates(
    adapter: InstagramAdapter, user_ids: list[str]
) -> dict[str, tuple[IGProfile, IGMediaStats | None]]:
    """Fetch profile + media stats for every candidate. The two calls per
    account are sequential (profile first, then media) so Instagram never
    sees a burst of parallel requests for the same account. Candidates whose
    profile fetch failed are dropped entirely."""
    results = await asyncio.gather(*(_enrich_one(adapter, uid) for uid in user_ids))
    return {
        uid: (profile, media)
        for uid, profile, media in results
        if profile is not None
    }
