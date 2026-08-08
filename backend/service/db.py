# -*- coding: utf-8 -*-
"""PostgreSQL access layer: connection pool + table creation.

Account, session token, and class-record \"metadata\" are moved to PG; large blobs like
audio/whiteboard/per-sentence jsonl stay in records/ files, and the DB only stores metadata
and file references (sid is the directory name, so the path can be computed).

The DSN is read only from the EECLASS_DB_DSN environment variable, defaulting to a local unix
socket (peer authentication, no password):
    postgresql:///eeclass
Never write a DSN containing a password into any committed file.

Connections use psycopg(v3)'s psycopg_pool connection pool; if the pool can't be installed it
falls back to an \"open a short-lived connection each time\" factory with identical behavior
(these calls are all sparse: login auth + writing one row when recording stops, so brief blocking is fine).
"""
import atexit
import os
import threading

import psycopg

try:                                   # use the pool if there is one
    from psycopg_pool import ConnectionPool
    _HAVE_POOL = True
except Exception:                      # no pool: fall back to the short-connection factory
    ConnectionPool = None
    _HAVE_POOL = False


def _dsn() -> str:
    return os.environ.get("EECLASS_DB_DSN", "postgresql:///eeclass")


_pool = None
_pool_lock = threading.Lock()


def get_pool():
    """Lazily build the connection pool; returns None when psycopg_pool is absent (callers use short-lived connections)."""
    global _pool
    if not _HAVE_POOL:
        return None
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                _pool = ConnectionPool(
                    _dsn(), min_size=1, max_size=8, kwargs={"autocommit": False})
                atexit.register(close_pool)
    return _pool


def close_pool():
    """Clean up the pool's background thread at process exit, avoiding 'couldn't stop thread' noise."""
    global _pool
    if _pool is not None:
        try:
            _pool.close()
        except Exception:
            pass
        _pool = None


class _ConnCtx:
    """Unified connection context manager: borrow from the pool / or open a temporary short-lived connection, returning/closing it on exit."""

    def __init__(self):
        self._pool = get_pool()
        self._cm = None
        self._conn = None

    def __enter__(self):
        if self._pool is not None:
            self._cm = self._pool.connection()
            self._conn = self._cm.__enter__()
        else:
            self._conn = psycopg.connect(_dsn())
        return self._conn

    def __exit__(self, exc_type, exc, tb):
        if self._cm is not None:                 # pool: hand back to the pool (which commits/rolls back based on exceptions)
            return self._cm.__exit__(exc_type, exc, tb)
        try:                                     # short connection: commit/rollback ourselves, then close
            if exc_type is None:
                self._conn.commit()
            else:
                self._conn.rollback()
        finally:
            self._conn.close()
        return False


def connection():
    """`with connection() as conn:` -- pool or short-lived connection, either one, same interface."""
    return _ConnCtx()


_SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts (
    email   text PRIMARY KEY,
    name    text NOT NULL,
    role    text NOT NULL DEFAULT 'user',
    pw      text NOT NULL,
    created timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_sessions (
    token   text PRIMARY KEY,
    email   text NOT NULL REFERENCES accounts(email) ON DELETE CASCADE,
    created double precision NOT NULL,
    last    double precision NOT NULL
);

CREATE TABLE IF NOT EXISTS recordings (
    sid         text PRIMARY KEY,
    title       text,
    owner       text,
    duration_s  double precision,
    course_id   text,
    summary     text,
    key_points  jsonb,
    has_summary boolean NOT NULL DEFAULT false,
    created     timestamptz,
    updated     timestamptz NOT NULL DEFAULT now()
);

-- meta 存整份 meta.json，让历史列表能字节级复原旧响应（lines/speakers/device/rtf…）。
-- 对已存在的表也幂等补列。
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS meta jsonb;

-- 标签目前是纯前端概念，代码里的记录没有 tags 字段；建表备用，暂不写入。
CREATE TABLE IF NOT EXISTS tags (
    id    serial PRIMARY KEY,
    label text UNIQUE NOT NULL,
    color text
);

CREATE TABLE IF NOT EXISTS recording_tags (
    sid    text REFERENCES recordings(sid) ON DELETE CASCADE,
    tag_id int  REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (sid, tag_id)
);
"""

_schema_done = False
_schema_lock = threading.Lock()


def init_schema(force: bool = False):
    """Idempotent table creation. Safe to call on every startup; a module-level guard ensures it truly runs only once."""
    global _schema_done
    if _schema_done and not force:
        return
    with _schema_lock:
        if _schema_done and not force:
            return
        with connection() as conn:
            with conn.cursor() as cur:
                cur.execute(_SCHEMA)
        _schema_done = True
