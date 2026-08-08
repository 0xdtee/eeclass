# -*- coding: utf-8 -*-
"""One-time import of the file-based data into PostgreSQL (idempotent, safe to re-run).

  users.json    -> accounts
  sessions.json -> auth_sessions   (sessions whose account doesn't exist are skipped)
  records/<sid>/{owner.json,meta.json,summary.json} -> recordings

Read-only import: never deletes or modifies any JSON / records file. Everything goes through UPSERT, so re-running won't insert duplicates.

    python migrate_to_db.py [records_dir]

With no argument, it resolves server.records_dir from config.json (relative to service/) using server.py's algorithm.
The DSN is read from the EECLASS_DB_DSN environment variable, defaulting to postgresql:///eeclass.
"""
import json
import os
import re
import sys

import db

HERE = os.path.dirname(os.path.abspath(__file__))


def _load_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _records_dir(argv):
    if len(argv) > 1 and argv[1].strip():
        return os.path.abspath(argv[1])
    cfg = _load_json(os.path.join(HERE, "config.json")) or {}
    rel = (cfg.get("server") or {}).get("records_dir", "../records")
    return os.path.normpath(os.path.join(HERE, rel))


def _created_from(meta, sid):
    """Record creation time: prefer the timestamp in meta, otherwise infer it from the directory name prefix YYYY-MM-DD_HHMM."""
    for k in ("created", "at", "time", "date"):
        v = (meta or {}).get(k)
        if v:
            return v
    m = re.match(r"^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})", sid or "")
    if m:
        return f"{m.group(1)} {m.group(2)}:{m.group(3)}:00"
    return None


def migrate_accounts(records_dir):
    users = _load_json(os.path.join(records_dir, "users.json")) or {}
    n = 0
    with db.connection() as conn:
        with conn.cursor() as cur:
            for email, u in users.items():
                em = (u.get("email") or email or "").strip().lower()
                if not em:
                    continue
                cur.execute(
                    "INSERT INTO accounts (email, name, role, pw, created) "
                    "VALUES (%s, %s, %s, %s, COALESCE(%s::timestamptz, now())) "
                    "ON CONFLICT (email) DO UPDATE SET "
                    "name = EXCLUDED.name, role = EXCLUDED.role, pw = EXCLUDED.pw",
                    (em, u.get("name") or em.split("@")[0],
                     u.get("role") or "user", u.get("pw") or "",
                     u.get("created")))
                n += 1
    return n


def migrate_sessions(records_dir):
    sessions = _load_json(os.path.join(records_dir, "sessions.json")) or {}
    n = skipped = 0
    with db.connection() as conn:
        with conn.cursor() as cur:
            # set of existing accounts: under the foreign-key constraint, sessions with a missing account are simply skipped
            cur.execute("SELECT email FROM accounts")
            accounts = {r[0] for r in cur.fetchall()}
            for token, s in sessions.items():
                em = (s.get("email") or "").strip().lower()
                if not token or em not in accounts:
                    skipped += 1
                    continue
                created = float(s.get("created") or 0)
                last = float(s.get("last") or created)
                cur.execute(
                    "INSERT INTO auth_sessions (token, email, created, last) "
                    "VALUES (%s, %s, %s, %s) "
                    "ON CONFLICT (token) DO UPDATE SET "
                    "email = EXCLUDED.email, created = EXCLUDED.created, "
                    "last = EXCLUDED.last",
                    (token, em, created, last))
                n += 1
    return n, skipped


def migrate_recordings(records_dir):
    import recordings_db
    n = 0
    if not os.path.isdir(records_dir):
        return 0
    for name in sorted(os.listdir(records_dir)):
        d = os.path.join(records_dir, name)
        if not os.path.isdir(d):
            continue
        meta = _load_json(os.path.join(d, "meta.json"))
        owner_j = _load_json(os.path.join(d, "owner.json")) or {}
        summ = _load_json(os.path.join(d, "summary.json"))
        # only import when the directory actually contains record files (skip shots-only ones, etc.)
        if meta is None and not owner_j and summ is None:
            if not (os.path.exists(os.path.join(d, "transcript.jsonl"))):
                continue
        meta = meta or {}
        owner = meta.get("owner") or owner_j.get("owner")
        summary = (summ or {}).get("summary")
        key_points = (summ or {}).get("key_points")
        has_summary = bool(summary) if summ is not None else None
        recordings_db.upsert_recording(
            name,
            title=meta.get("title"),
            owner=owner,
            duration_s=meta.get("duration_s"),
            course_id=meta.get("course_id"),
            summary=summary,
            key_points=key_points,
            has_summary=has_summary,
            created=_created_from(meta, name),
            meta=meta or None)
        n += 1
    return n


def main():
    records_dir = _records_dir(sys.argv)
    print(f"records_dir = {records_dir}")
    print(f"DSN         = {os.environ.get('EECLASS_DB_DSN', 'postgresql:///eeclass')}")
    db.init_schema()
    n_acc = migrate_accounts(records_dir)
    n_sess, n_skip = migrate_sessions(records_dir)
    n_rec = migrate_recordings(records_dir)
    print("---- 导入完成 ----")
    print(f"accounts   : {n_acc}")
    print(f"sessions   : {n_sess}  (跳过 {n_skip}，账号缺失)")
    print(f"recordings : {n_rec}")


if __name__ == "__main__":
    main()
