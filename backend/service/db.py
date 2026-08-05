# -*- coding: utf-8 -*-
"""PostgreSQL 接入层：连接池 + 建表。

账号、会话令牌、课堂记录的「元数据」迁到 PG；音频/板书/逐句 jsonl 这些大块
仍留在 records/ 文件里，DB 只存元数据和文件引用（sid 就是目录名，路径可算出来）。

DSN 只从环境变量 EECLASS_DB_DSN 读，缺省本地 unix socket（peer 认证，无密码）：
    postgresql:///eeclass
绝不把带口令的 DSN 写进任何提交的文件。

连接用 psycopg(v3) 的连接池 psycopg_pool；装不上池就退回「每次开一个短连接」的
工厂，行为一致（这些调用都很稀疏：登录鉴权 + 停止录音时写一行，短暂阻塞没关系）。
"""
import atexit
import os
import threading

import psycopg

try:                                   # 有池用池
    from psycopg_pool import ConnectionPool
    _HAVE_POOL = True
except Exception:                      # 没池就退回短连接工厂
    ConnectionPool = None
    _HAVE_POOL = False


def _dsn() -> str:
    return os.environ.get("EECLASS_DB_DSN", "postgresql:///eeclass")


_pool = None
_pool_lock = threading.Lock()


def get_pool():
    """惰性建连接池；没有 psycopg_pool 时返回 None（调用方走短连接）。"""
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
    """进程退出时清掉池的后台线程，避免 'couldn't stop thread' 噪音。"""
    global _pool
    if _pool is not None:
        try:
            _pool.close()
        except Exception:
            pass
        _pool = None


class _ConnCtx:
    """统一的连接上下文管理器：池里借 / 或临时开一个短连接，退出时归还/关闭。"""

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
        if self._cm is not None:                 # 池：交还给池（池会按异常提交/回滚）
            return self._cm.__exit__(exc_type, exc, tb)
        try:                                     # 短连接：自己提交/回滚再关
            if exc_type is None:
                self._conn.commit()
            else:
                self._conn.rollback()
        finally:
            self._conn.close()
        return False


def connection():
    """`with connection() as conn:` —— 池或短连接，二选一，接口一致。"""
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
    """幂等建表。启动时可每次调用；模块级 guard 保证只真正执行一次。"""
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
