"""
Analytics endpoints for Vendy.

Query BigQuery for aggregate data; fall back to Firestore if BigQuery is
unavailable or the dataset has not been set up yet.

All results are cached 5 minutes server-side (simple in-memory dict cache —
safe for single-instance Cloud Run; cache clears on cold start).

Accessible to management and admin roles only.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

# ── BigQuery availability ─────────────────────────────────────────────────────
try:
    from google.cloud import bigquery as _bq_module

    _BQ_AVAILABLE = True
except ImportError:
    _BQ_AVAILABLE = False
    logger.warning(
        "google-cloud-bigquery not installed — analytics will use Firestore fallback"
    )

BQ_PROJECT = os.environ.get("BQ_PROJECT_ID", "buildertrend-pipeline")
BQ_DATASET = os.environ.get("BQ_DATASET", "vendy_analytics")
FIREBASE_PROJECT = os.environ.get("FIREBASE_PROJECT_ID", "buildertrend-pipeline")

_bq_client: Any = None


def _get_bq():
    global _bq_client
    if _bq_client is None and _BQ_AVAILABLE:
        _bq_client = _bq_module.Client(project=BQ_PROJECT)
    return _bq_client


# ── 5-minute in-memory cache ──────────────────────────────────────────────────
_cache: dict[str, tuple[float, Any]] = {}
_CACHE_TTL = 300  # seconds


def _cache_get(key: str) -> Any | None:
    entry = _cache.get(key)
    if not entry:
        return None
    ts, value = entry
    if (datetime.now(timezone.utc).timestamp() - ts) > _CACHE_TTL:
        del _cache[key]
        return None
    return value


def _cache_set(key: str, value: Any) -> None:
    _cache[key] = (datetime.now(timezone.utc).timestamp(), value)


# ── BigQuery helpers ──────────────────────────────────────────────────────────


def _bq_query(sql: str, params: list | None = None) -> list[dict]:
    """Run a BigQuery query and return list of dicts. Returns [] on any error."""
    bq = _get_bq()
    if not bq:
        raise RuntimeError("BigQuery client not available")
    job_config = None
    if params:
        if _BQ_AVAILABLE:
            job_config = _bq_module.QueryJobConfig(query_parameters=params)
    job = bq.query(sql, job_config=job_config)
    return [dict(row) for row in job.result()]


# ── Firestore fallback helpers ────────────────────────────────────────────────


def _fs_summary_fallback() -> dict:
    """Compute summary stats from Firestore when BigQuery is unavailable."""
    from google.cloud import firestore

    db = firestore.Client(project=FIREBASE_PROJECT)
    bids_col = db.collection("apps").document("vendy").collection("bids")

    current_year = datetime.now(timezone.utc).year
    total_awarded_ytd = 0.0
    cost_code_counts: dict[str, int] = {}
    vendor_awarded: dict[str, int] = {}
    vendor_total: dict[str, int] = {}

    for doc in bids_col.stream():
        data = doc.to_dict() or {}
        status = data.get("status", "")
        cost_code_name = data.get("cost_code_name", "Unknown")
        vendor_id = data.get("vendor_id", "")

        if status in ("awarded", "not_awarded", "rejected"):
            cost_code_counts[cost_code_name] = (
                cost_code_counts.get(cost_code_name, 0) + 1
            )
            if vendor_id:
                vendor_total[vendor_id] = vendor_total.get(vendor_id, 0) + 1

        if status == "awarded":
            subtotal = data.get("subtotal") or 0
            # Check year
            gen_at = data.get("generated_at") or data.get("updated_at")
            bid_year = None
            if isinstance(gen_at, datetime):
                bid_year = gen_at.year
            elif isinstance(gen_at, str):
                try:
                    bid_year = datetime.fromisoformat(
                        gen_at.replace("Z", "+00:00")
                    ).year
                except Exception:
                    pass
            if bid_year is None or bid_year == current_year:
                total_awarded_ytd += float(subtotal)
            if vendor_id:
                vendor_awarded[vendor_id] = vendor_awarded.get(vendor_id, 0) + 1

    # Total bids processed — use bid_ledger collection group for accurate count
    total_bids_processed = 0
    try:
        ledger_docs = list(db.collection_group("bid_ledger").stream())
        total_bids_processed = len(ledger_docs)
    except Exception:
        total_bids_processed = sum(vendor_total.values())

    # Most active cost code
    most_active = (
        max(cost_code_counts, key=lambda k: cost_code_counts[k])
        if cost_code_counts
        else "N/A"
    )

    # Top vendor by win rate (min 3 bids)
    top_vendor = "N/A"
    top_win_rate = 0.0
    for vid, total in vendor_total.items():
        if total >= 3:
            awarded = vendor_awarded.get(vid, 0)
            rate = (awarded / total) * 100
            if rate > top_win_rate:
                top_win_rate = rate
                top_vendor = vid

    return {
        "total_awarded_ytd": round(total_awarded_ytd, 2),
        "total_bids_processed": total_bids_processed,
        "most_active_cost_code": most_active,
        "top_vendor_win_rate": {
            "vendor_id": top_vendor,
            "win_rate_pct": round(top_win_rate, 1),
        },
        "source": "firestore",
    }


def _fs_vendor_win_rates_fallback(cost_code_filter: str | None) -> list[dict]:
    """Compute vendor win rates from Firestore bid_ledger collection group."""
    from google.cloud import firestore

    db = firestore.Client(project=FIREBASE_PROJECT)
    query = db.collection_group("bid_ledger")
    if cost_code_filter:
        query = query.where(
            filter=firestore.FieldFilter("cost_code", "==", cost_code_filter)
        )

    vendor_awarded: dict[str, int] = {}
    vendor_total: dict[str, int] = {}
    vendor_names: dict[str, str] = {}

    for doc in query.stream():
        data = doc.to_dict() or {}
        # vendor_id from path
        path_parts = doc.reference.path.split("/")
        vendor_id = path_parts[4] if len(path_parts) >= 5 else data.get("vendor_id", "")
        outcome = data.get("outcome", "")
        vendor_names[vendor_id] = vendor_id.replace("_", " ").title()

        vendor_total[vendor_id] = vendor_total.get(vendor_id, 0) + 1
        if outcome == "awarded":
            vendor_awarded[vendor_id] = vendor_awarded.get(vendor_id, 0) + 1

    result = []
    for vid, total in vendor_total.items():
        if total < 2:
            continue
        awarded = vendor_awarded.get(vid, 0)
        result.append(
            {
                "vendor_id": vid,
                "vendor_name": vendor_names.get(vid, vid),
                "awarded": awarded,
                "total": total,
                "win_rate_pct": round((awarded / total) * 100, 1),
            }
        )

    return sorted(result, key=lambda x: x["win_rate_pct"], reverse=True)


def _fs_coverage_fallback() -> list[dict]:
    """Compute cost code coverage from bid_ledger collection group."""
    from google.cloud import firestore

    db = firestore.Client(project=FIREBASE_PROJECT)

    code_awarded: dict[str, int] = {}
    code_total: dict[str, int] = {}
    code_vendors: dict[str, set] = {}
    code_names: dict[str, str] = {}

    for doc in db.collection_group("bid_ledger").stream():
        data = doc.to_dict() or {}
        cost_code = data.get("cost_code", "UNKNOWN")
        cost_code_name = data.get("cost_code_name", cost_code)
        outcome = data.get("outcome", "")
        path_parts = doc.reference.path.split("/")
        vendor_id = path_parts[4] if len(path_parts) >= 5 else ""

        code_names[cost_code] = cost_code_name
        code_total[cost_code] = code_total.get(cost_code, 0) + 1
        code_vendors.setdefault(cost_code, set()).add(vendor_id)
        if outcome == "awarded":
            code_awarded[cost_code] = code_awarded.get(cost_code, 0) + 1

    result = []
    for code, total in code_total.items():
        awarded = code_awarded.get(code, 0)
        vendor_count = len(code_vendors.get(code, set()))
        result.append(
            {
                "cost_code": code,
                "cost_code_name": code_names.get(code, code),
                "awarded_count": awarded,
                "total_count": total,
                "vendor_count": vendor_count,
                "thin_coverage": awarded < 3,
            }
        )

    return sorted(result, key=lambda x: x["cost_code"])


def _fs_cost_vs_budget_fallback() -> list[dict]:
    """Compute cost vs budget from Firestore projects + bids."""
    from google.cloud import firestore

    db = firestore.Client(project=FIREBASE_PROJECT)

    # Load projects
    projects: dict[str, dict] = {}
    for doc in db.collection("apps").document("shared").collection("projects").stream():
        data = doc.to_dict() or {}
        projects[doc.id] = {
            "project_id": doc.id,
            "project_name": data.get("job_name", doc.id),
            "status": data.get("status", "open"),
            "budget": data.get("total_budget") or data.get("budget"),
        }

    # Sum awarded bids per project
    awarded_totals: dict[str, float] = {}
    bids_col = db.collection("apps").document("vendy").collection("bids")
    for doc in bids_col.where(
        filter=firestore.FieldFilter("status", "==", "awarded")
    ).stream():
        data = doc.to_dict() or {}
        pid = data.get("project_id", "")
        awarded_totals[pid] = awarded_totals.get(pid, 0.0) + float(
            data.get("subtotal") or 0
        )

    result = []
    for pid, proj in projects.items():
        if proj["status"] not in ("open", "active"):
            continue
        awarded = awarded_totals.get(pid, 0.0)
        budget = proj.get("budget")
        variance = None
        variance_pct = None
        over_budget = False
        if budget:
            variance = round(awarded - float(budget), 2)
            variance_pct = (
                round((variance / float(budget)) * 100, 1) if budget else None
            )
            over_budget = variance > 0

        result.append(
            {
                "project_id": pid,
                "project_name": proj["project_name"],
                "budget": budget,
                "awarded_total": round(awarded, 2),
                "variance": variance,
                "variance_pct": variance_pct,
                "over_budget": over_budget,
                "status": proj["status"],
            }
        )

    return sorted(result, key=lambda x: x["variance_pct"] or 0, reverse=True)


# ── Public endpoint implementations ──────────────────────────────────────────


def get_summary() -> dict:
    """GET /analytics/summary — 4 stat card values."""
    cached = _cache_get("summary")
    if cached:
        return cached

    try:
        if not _BQ_AVAILABLE:
            raise RuntimeError("BigQuery not available")

        current_year = datetime.now(timezone.utc).year

        # Run 4 queries in sequence (could parallelise with threads if needed)
        awarded_rows = _bq_query(f"""
            SELECT COALESCE(SUM(subtotal), 0) AS total
            FROM `{BQ_PROJECT}.{BQ_DATASET}.bids_latest`
            WHERE status = 'awarded'
              AND generated_at IS NOT NULL
              AND EXTRACT(YEAR FROM SAFE.PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*SZ', generated_at)) = {current_year}
        """)

        processed_rows = _bq_query(f"""
            SELECT COUNT(*) AS total
            FROM `{BQ_PROJECT}.{BQ_DATASET}.bid_ledger`
        """)

        cost_code_rows = _bq_query(f"""
            SELECT cost_code_name, COUNT(*) AS cnt
            FROM `{BQ_PROJECT}.{BQ_DATASET}.bid_ledger`
            GROUP BY cost_code_name
            ORDER BY cnt DESC
            LIMIT 1
        """)

        top_vendor_rows = _bq_query(f"""
            SELECT
                vendor_id,
                COUNTIF(outcome = 'awarded') AS awarded,
                COUNT(*) AS total,
                ROUND(SAFE_DIVIDE(COUNTIF(outcome = 'awarded'), COUNT(*)) * 100, 1) AS win_rate_pct
            FROM `{BQ_PROJECT}.{BQ_DATASET}.bid_ledger`
            GROUP BY vendor_id
            HAVING total >= 3
            ORDER BY win_rate_pct DESC
            LIMIT 1
        """)

        result = {
            "total_awarded_ytd": float(awarded_rows[0]["total"])
            if awarded_rows
            else 0.0,
            "total_bids_processed": int(processed_rows[0]["total"])
            if processed_rows
            else 0,
            "most_active_cost_code": cost_code_rows[0]["cost_code_name"]
            if cost_code_rows
            else "N/A",
            "top_vendor_win_rate": {
                "vendor_id": top_vendor_rows[0]["vendor_id"]
                if top_vendor_rows
                else "N/A",
                "win_rate_pct": float(top_vendor_rows[0]["win_rate_pct"])
                if top_vendor_rows
                else 0.0,
            },
            "source": "bigquery",
        }
    except Exception as exc:
        logger.warning("BigQuery summary failed (%s) — falling back to Firestore", exc)
        result = _fs_summary_fallback()

    _cache_set("summary", result)
    return result


def get_vendor_win_rates(cost_code: str | None = None) -> list[dict]:
    """GET /analytics/vendor-win-rates — per-vendor win rate, optionally filtered by cost code."""
    cache_key = f"vendor_win_rates:{cost_code or 'all'}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    try:
        if not _BQ_AVAILABLE:
            raise RuntimeError("BigQuery not available")

        if cost_code:
            if _BQ_AVAILABLE:
                params = [
                    _bq_module.ScalarQueryParameter("cost_code", "STRING", cost_code)
                ]
            sql = f"""
                SELECT
                    vendor_id,
                    COUNTIF(outcome = 'awarded') AS awarded,
                    COUNT(*) AS total,
                    ROUND(SAFE_DIVIDE(COUNTIF(outcome = 'awarded'), COUNT(*)) * 100, 1) AS win_rate_pct
                FROM `{BQ_PROJECT}.{BQ_DATASET}.bid_ledger`
                WHERE cost_code = @cost_code
                GROUP BY vendor_id
                HAVING total >= 2
                ORDER BY win_rate_pct DESC
            """
            rows = _bq_query(sql, params)
        else:
            rows = _bq_query(f"""
                SELECT
                    vendor_id,
                    COUNTIF(outcome = 'awarded') AS awarded,
                    COUNT(*) AS total,
                    ROUND(SAFE_DIVIDE(COUNTIF(outcome = 'awarded'), COUNT(*)) * 100, 1) AS win_rate_pct
                FROM `{BQ_PROJECT}.{BQ_DATASET}.bid_ledger`
                GROUP BY vendor_id
                HAVING total >= 2
                ORDER BY win_rate_pct DESC
            """)

        result = [
            {
                "vendor_id": r["vendor_id"],
                "vendor_name": str(r["vendor_id"]).replace("_", " ").title(),
                "awarded": int(r["awarded"]),
                "total": int(r["total"]),
                "win_rate_pct": float(r["win_rate_pct"]),
            }
            for r in rows
        ]
    except Exception as exc:
        logger.warning(
            "BigQuery vendor win rates failed (%s) — falling back to Firestore", exc
        )
        result = _fs_vendor_win_rates_fallback(cost_code)

    _cache_set(cache_key, result)
    return result


def get_coverage() -> list[dict]:
    """GET /analytics/coverage — cost code coverage (awarded sample counts)."""
    cached = _cache_get("coverage")
    if cached:
        return cached

    try:
        if not _BQ_AVAILABLE:
            raise RuntimeError("BigQuery not available")

        rows = _bq_query(f"""
            SELECT
                cost_code,
                cost_code_name,
                COUNT(DISTINCT vendor_id) AS vendor_count,
                COUNT(*) AS total_count,
                COUNTIF(outcome = 'awarded') AS awarded_count
            FROM `{BQ_PROJECT}.{BQ_DATASET}.bid_ledger`
            GROUP BY cost_code, cost_code_name
            ORDER BY cost_code
        """)

        result = [
            {
                "cost_code": r["cost_code"],
                "cost_code_name": r["cost_code_name"],
                "awarded_count": int(r["awarded_count"]),
                "total_count": int(r["total_count"]),
                "vendor_count": int(r["vendor_count"]),
                "thin_coverage": int(r["awarded_count"]) < 3,
            }
            for r in rows
        ]
    except Exception as exc:
        logger.warning("BigQuery coverage failed (%s) — falling back to Firestore", exc)
        result = _fs_coverage_fallback()

    _cache_set("coverage", result)
    return result


def get_cost_vs_budget() -> list[dict]:
    """GET /analytics/cost-vs-budget — project awarded totals vs budget."""
    cached = _cache_get("cost_vs_budget")
    if cached:
        return cached

    try:
        if not _BQ_AVAILABLE:
            raise RuntimeError("BigQuery not available")

        rows = _bq_query(f"""
            SELECT
                p.project_id,
                p.project_name,
                p.budget,
                COALESCE(SUM(b.subtotal), 0) AS awarded_total
            FROM `{BQ_PROJECT}.{BQ_DATASET}.projects_latest` p
            LEFT JOIN `{BQ_PROJECT}.{BQ_DATASET}.bids_latest` b
                ON b.project_id = p.project_id AND b.status = 'awarded'
            WHERE p.status IN ('open', 'active')
            GROUP BY p.project_id, p.project_name, p.budget
        """)

        result = []
        for r in rows:
            budget = float(r["budget"]) if r["budget"] else None
            awarded = float(r["awarded_total"])
            variance = round(awarded - budget, 2) if budget else None
            variance_pct = (
                round((variance / budget) * 100, 1) if (budget and budget > 0) else None
            )
            result.append(
                {
                    "project_id": r["project_id"],
                    "project_name": r["project_name"],
                    "budget": budget,
                    "awarded_total": round(awarded, 2),
                    "variance": variance,
                    "variance_pct": variance_pct,
                    "over_budget": (variance > 0) if variance is not None else False,
                    "status": "open",
                }
            )

        result.sort(key=lambda x: x["variance_pct"] or 0, reverse=True)
    except Exception as exc:
        logger.warning(
            "BigQuery cost-vs-budget failed (%s) — falling back to Firestore", exc
        )
        result = _fs_cost_vs_budget_fallback()

    _cache_set("cost_vs_budget", result)
    return result
