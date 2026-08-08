# -*- coding: utf-8 -*-
"""用户账号 + 会话令牌（后端已迁到 PostgreSQL）。

原来服务只有一个全局令牌（token.txt），谁拿到都一样。加账号后：
  · 注册/登录，后端发一个「会话令牌」(session token)，前端拿它当访问令牌用；
  · check_token 认「全局令牌」或「任一有效会话令牌」，所以登录即鉴权——
    别人只要注册登录，就能连服务看实时转写，不用把口令抄来抄去。

密码只存 pbkdf2 派生值（标准库 hashlib，不引额外依赖），绝不存明文。
账号存 accounts 表、会话存 auth_sessions 表（PG），DSN 从环境变量读；
以前落 records/users.json、sessions.json，迁移脚本 migrate_to_db.py 一次性导入。

对外方法签名、行为、以及抛出的中文报错都跟文件版一模一样，server.py 里的调用不用改。
方法保持同步（callers 都是同步写法）：鉴权类调用很稀疏，短暂阻塞可接受，别改成 async。
"""
import hashlib
import os
import secrets
import time

import db

_ITERS = 200_000
_SESSION_TTL = 30 * 86400          # 会话 30 天过期


def _hash_pw(pw: str, salt: bytes = None) -> str:
    salt = salt or secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt, _ITERS)
    return f"pbkdf2_sha256${_ITERS}${salt.hex()}${dk.hex()}"


def _verify_pw(pw: str, stored: str) -> bool:
    try:
        _algo, iters, salt_hex, hash_hex = stored.split("$")
        dk = hashlib.pbkdf2_hmac(
            "sha256", pw.encode("utf-8"), bytes.fromhex(salt_hex), int(iters))
        return secrets.compare_digest(dk.hex(), hash_hex)
    except Exception:
        return False


class Accounts:
    def __init__(self, dir_: str):
        # dir_ 保留做兼容/备份路径用；数据现在落 PG。构造时确保表已建好。
        self.dir = dir_
        try:
            os.makedirs(dir_, exist_ok=True)
        except Exception:
            pass
        db.init_schema()

    @staticmethod
    def _norm(email: str) -> str:
        return (email or "").strip().lower()

    # ---------- 对外 ----------
    def register(self, email, name, password, role=None):
        email = self._norm(email)
        if not email or "@" not in email:
            raise ValueError("邮箱格式不对")
        if len((password or "")) < 6:
            raise ValueError("密码至少 6 位")
        name = (name or email.split("@")[0]).strip()
        role = role or "user"
        pw = _hash_pw(password)
        created = time.strftime("%Y-%m-%d %H:%M:%S")
        with db.connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM accounts WHERE email = %s", (email,))
                if cur.fetchone():
                    raise ValueError("这个邮箱已经注册过了")
                cur.execute(
                    "INSERT INTO accounts (email, name, role, pw, created) "
                    "VALUES (%s, %s, %s, %s, %s)",
                    (email, name, role, pw, created))
        return self._issue(email)

    def exists(self, email):
        email = self._norm(email)
        with db.connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM accounts WHERE email = %s", (email,))
                return cur.fetchone() is not None

    def login(self, email, password):
        email = self._norm(email)
        with db.connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT pw FROM accounts WHERE email = %s", (email,))
                row = cur.fetchone()
        if not row or not _verify_pw(password or "", row[0]):
            raise ValueError("邮箱或密码不对")
        return self._issue(email)

    def _issue(self, email):
        token = secrets.token_urlsafe(24)
        now = time.time()
        with db.connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO auth_sessions (token, email, created, last) "
                    "VALUES (%s, %s, %s, %s)",
                    (token, email, now, now))
        return token, self.public_user(email)

    def session_user(self, token):
        """令牌 -> 用户信息；无效或过期返回 None。"""
        if not token:
            return None
        with db.connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT email, created FROM auth_sessions WHERE token = %s",
                    (token,))
                row = cur.fetchone()
        if not row:
            return None
        email, created = row
        if time.time() - (created or 0) > _SESSION_TTL:
            self.logout(token)
            return None
        return self.public_user(email)

    def public_user(self, email):
        email = self._norm(email)
        if not email:
            return None
        with db.connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT email, name, role FROM accounts WHERE email = %s",
                    (email,))
                row = cur.fetchone()
        if not row:
            return None
        return {"email": row[0], "name": row[1], "role": row[2] or "user"}

    def logout(self, token):
        if not token:
            return
        with db.connection() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM auth_sessions WHERE token = %s", (token,))
