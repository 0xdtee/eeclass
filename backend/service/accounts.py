# -*- coding: utf-8 -*-
"""用户账号 + 会话令牌。

原来服务只有一个全局令牌（token.txt），谁拿到都一样。加账号后：
  · 注册/登录，后端发一个「会话令牌」(session token)，前端拿它当访问令牌用；
  · check_token 认「全局令牌」或「任一有效会话令牌」，所以登录即鉴权——
    别人只要注册登录，就能连服务看实时转写，不用把口令抄来抄去。

密码只存 pbkdf2 派生值（标准库 hashlib，不引额外依赖），绝不存明文。
用户存 users.json、会话存 sessions.json，都放在 records 目录里，跟着数据走。
"""
import hashlib
import json
import os
import secrets
import threading
import time

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
        os.makedirs(dir_, exist_ok=True)
        self.users_path = os.path.join(dir_, "users.json")
        self.sessions_path = os.path.join(dir_, "sessions.json")
        self._lock = threading.Lock()
        self.users = self._load(self.users_path)         # {email: {...}}
        self.sessions = self._load(self.sessions_path)    # {token: {email, created, last}}

    # ---------- 持久化 ----------
    @staticmethod
    def _load(p):
        try:
            with open(p, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}

    @staticmethod
    def _save(p, obj):
        tmp = p + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=2)
        os.replace(tmp, p)            # 原子替换，写一半崩了也不会毁掉原文件

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
        with self._lock:
            if email in self.users:
                raise ValueError("这个邮箱已经注册过了")
            self.users[email] = {
                "email": email,
                "name": (name or email.split("@")[0]).strip(),
                "role": role or "user",
                "pw": _hash_pw(password),
                "created": time.strftime("%Y-%m-%d %H:%M:%S"),
            }
            self._save(self.users_path, self.users)
        return self._issue(email)

    def login(self, email, password):
        email = self._norm(email)
        with self._lock:
            u = self.users.get(email)
        if not u or not _verify_pw(password or "", u["pw"]):
            raise ValueError("邮箱或密码不对")
        return self._issue(email)

    def _issue(self, email):
        token = secrets.token_urlsafe(24)
        with self._lock:
            self.sessions[token] = {
                "email": email, "created": time.time(), "last": time.time()}
            self._save(self.sessions_path, self.sessions)
        return token, self.public_user(email)

    def session_user(self, token):
        """令牌 -> 用户信息；无效或过期返回 None。"""
        if not token:
            return None
        s = self.sessions.get(token)
        if not s:
            return None
        if time.time() - s.get("created", 0) > _SESSION_TTL:
            self.logout(token)
            return None
        return self.public_user(s["email"])

    def public_user(self, email):
        u = self.users.get(self._norm(email))
        if not u:
            return None
        return {"email": u["email"], "name": u["name"], "role": u.get("role", "user")}

    def logout(self, token):
        with self._lock:
            if token in self.sessions:
                self.sessions.pop(token, None)
                self._save(self.sessions_path, self.sessions)
