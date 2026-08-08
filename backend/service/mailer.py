# -*- coding: utf-8 -*-
"""Send email (registration verification code). SMTP over SSL, with all config read from environment variables—the auth code never goes into the code/config/git.

QQ Mail example (set it in start-server.sh):
    export SMTP_HOST=smtp.qq.com
    export SMTP_PORT=465
    export SMTP_USER=your-QQ-number@qq.com
    export SMTP_PASS=the auth code generated in QQ Mail settings   # not your login password
    export SMTP_FROM=your-QQ-number@qq.com            # optional, defaults to SMTP_USER
"""
import os
import smtplib
import ssl
from email.mime.text import MIMEText
from email.header import Header
from email.utils import formataddr


def _cfg():
    user = os.environ.get("SMTP_USER", "")
    return {
        "host": os.environ.get("SMTP_HOST", "smtp.qq.com"),
        "port": int(os.environ.get("SMTP_PORT", "465") or 465),
        "user": user,
        "pw": os.environ.get("SMTP_PASS", ""),
        "from": os.environ.get("SMTP_FROM", "") or user,
        "name": os.environ.get("SMTP_FROM_NAME", "课堂字幕"),
    }


def ready():
    c = _cfg()
    return bool(c["user"] and c["pw"])


def send_code(to_email, code):
    """Send a registration verification code to to_email. Raises on failure."""
    c = _cfg()
    if not ready():
        raise RuntimeError("没配邮件服务(SMTP_USER/SMTP_PASS)")
    body = (
        "你正在注册「课堂字幕」。\n\n"
        f"验证码:{code}\n\n"
        "验证码 10 分钟内有效。如果不是你本人操作,忽略此邮件即可。"
    )
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = Header("课堂字幕 · 注册验证码", "utf-8")
    msg["From"] = formataddr((str(Header(c["name"], "utf-8")), c["from"]))
    msg["To"] = to_email
    ctx = ssl.create_default_context()
    with smtplib.SMTP_SSL(c["host"], c["port"], context=ctx, timeout=15) as s:
        s.login(c["user"], c["pw"])
        s.sendmail(c["from"], [to_email], msg.as_string())
