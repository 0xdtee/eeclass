# -*- coding: utf-8 -*-
"""Read/write classroom-record metadata in PG (DB as index, files remain the single source of truth).

Besides the existing disk writes (owner.json/meta.json/summary.json, course assignment),
server.py additionally calls upsert_recording here to write the same metadata into the recordings
table; only the history list api_sessions now reads from this table, while other endpoints
(per-utterance/search/audio) still read files.

All writes use UPSERT, updating only the fields explicitly passed -- None means 'leave it alone this
time' and never clears a value written elsewhere. Queries are always parameterized.
"""
import json

import db

# Columns allowed to update on upsert (sid is the primary key, handled separately; updated is auto-refreshed by now())
_COLS = ("title", "owner", "duration_s", "course_id",
         "summary", "key_points", "has_summary", "created", "meta")


def upsert_recording(sid, *, title=None, owner=None, duration_s=None,
                     course_id=None, summary=None, key_points=None,
                     has_summary=None, created=None, meta=None):
    """Insert or update one record's metadata; write only the explicitly given fields (non-None).

    key_points / meta are stored as jsonb (just pass a list/dict). meta holds the full meta.json,
    from which the history list byte-for-byte reconstructs the old response. created accepts a
    datetime or a time string PG can parse. Returns whether any row was written."""
    if not sid:
        return False
    db.init_schema()

    values = {
        "title": title, "owner": owner, "duration_s": duration_s,
        "course_id": course_id, "summary": summary,
        "key_points": None if key_points is None else json.dumps(
            key_points, ensure_ascii=False),
        "has_summary": has_summary, "created": created,
        "meta": None if meta is None else json.dumps(meta, ensure_ascii=False),
    }
    given = [c for c in _COLS if values[c] is not None]

    # Even with no other fields, ensure this sid at least exists (insert a placeholder row)
    insert_cols = ["sid"] + given
    placeholders = ", ".join(["%s"] + ["%s"] * len(given))
    params = [sid] + [values[c] for c in given]

    if given:
        set_clause = ", ".join(f"{c} = EXCLUDED.{c}" for c in given)
        set_clause += ", updated = now()"
        conflict = f"DO UPDATE SET {set_clause}"
    else:
        conflict = "DO NOTHING"

    sql = (f"INSERT INTO recordings ({', '.join(insert_cols)}) "
           f"VALUES ({placeholders}) "
           f"ON CONFLICT (sid) {conflict}")
    with db.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
    return True


def delete_by_owner(owner):
    """Delete all recording index rows belonging to one account (used by account deletion)."""
    if not owner:
        return
    with db.connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM recordings WHERE owner = %s", (owner,))


def list_recordings(owner=None, superuser=False):
    """History list: non-superusers see only their own (owner==their hashed id); superusers see all.

    Returns [{sid, meta, summary, key_points, has_summary}], ordered by sid descending (sid starts
    with the date-time, equivalent to newest-first). The owner filter uses the indexed owner column;
    response fields are byte-for-byte reconstructed from meta by api_sessions."""
    db.init_schema()
    sql = ("SELECT sid, meta, summary, key_points, has_summary FROM recordings")
    params = []
    if not superuser:
        sql += " WHERE owner = %s"
        params.append(owner)
    sql += " ORDER BY sid DESC"
    out = []
    with db.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            for row in cur.fetchall():
                (sid, meta, summary, kp, has_sum) = row
                out.append({
                    "sid": sid,
                    "meta": meta or {},
                    "summary": summary or "",
                    "key_points": kp or [],
                    "has_summary": bool(has_sum),
                })
    return out
