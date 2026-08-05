# -*- coding: utf-8 -*-
"""课堂记录元数据在 PG 里的读写（DB 当索引，files 仍是唯一真源）。

server.py 在原有落盘点（owner.json/meta.json/summary.json、指派课程）之外，
额外调用这里的 upsert_recording 把同一份元数据写进 recordings 表；只有历史列表
api_sessions 改成从这张表读，其它端点（逐句/搜索/音频）仍读文件。

所有写入都用 UPSERT，只更新「显式传入」的字段——None 表示「这次不动它」，不会
把别处已写好的值清掉。查询一律参数化。
"""
import json

import db

# upsert 时允许更新的列（sid 是主键，单独处理；updated 由 now() 自动刷新）
_COLS = ("title", "owner", "duration_s", "course_id",
         "summary", "key_points", "has_summary", "created", "meta")


def upsert_recording(sid, *, title=None, owner=None, duration_s=None,
                     course_id=None, summary=None, key_points=None,
                     has_summary=None, created=None, meta=None):
    """插入或更新一条记录的元数据；只写显式给出的字段（非 None）。

    key_points / meta 会存成 jsonb（传 list/dict 即可）。meta 存整份 meta.json，
    历史列表据此字节级复原旧响应。created 接受 datetime 或可被 PG 解析的时间字符串。
    返回是否有行写入。"""
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

    # 即便没有其它字段，也要保证这条 sid 至少存在（插入一行占位）
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


def list_recordings(owner=None, superuser=False):
    """历史列表：非超级用户只看自己名下（owner==自己的哈希 id）；超级用户看全部。

    返回 [{sid, meta, summary, key_points, has_summary}]，按 sid 倒序（sid 以日期
    时间开头，等价于按时间倒序）。owner 过滤走索引列 owner；响应字段由 api_sessions
    从 meta 字节级复原旧结构。"""
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
