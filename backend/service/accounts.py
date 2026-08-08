# -*- coding: utf-8 -*-
"""User accounts + session tokens (backend now migrated to PostgreSQL).

The service originally had a single global token (token.txt) that was the same for everyone. With accounts added:
  · On register/login the backend issues a "session token", and the frontend uses it as its access token;
  · check_token accepts either the "global token" or "any valid session token", so logging in also authenticates—
    anyone who registers and logs in can connect to the service and watch the live transcript, no need to copy passphrases around.

Passwords are stored only as pbkdf2 derived values (stdlib hashlib, no extra dependencies), never in plaintext.
Accounts live in the accounts table and sessions in the auth_sessions table (PG), with the DSN read from an environment variable;
the old versions wrote records/users.json and sessions.json, which the migrate_to_db.py script imports once.

The public method signatures, behavior, and the Chinese error messages raised are all identical to the file-based version, so callers in server.py need no changes.
Methods stay synchronous (all callers are written synchronously): auth calls are sparse and brief blocking is acceptable, so don't convert them to async.
"""
import hashlib
import os
import secrets
import time

import db

_ITERS = 200_000
_SESSION_TTL = 30 * 86400          # sessions expire after 30 days


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
        # dir_ is kept for compatibility/backup paths; data now lives in PG. Ensure the tables exist at construction time.
        self.dir = dir_
        try:
            os.makedirs(dir_, exist_ok=True)
        except Exception:
            pass
        db.init_schema()

    @staticmethod
    def _norm(email: str) -> str:
        return (email or "").strip().lower()

    # ---------- public ----------
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
        """token -> user info; returns None if invalid or expired."""
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
