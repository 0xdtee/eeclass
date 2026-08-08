# -*- coding: utf-8 -*-
"""发邮件(注册验证码)。SMTP over SSL,配置全从环境变量读——授权码不进代码/config/git。

QQ 邮箱示例(在 start-server.sh 里设):
    export SMTP_HOST=smtp.qq.com
    export SMTP_PORT=465
    export SMTP_USER=你的QQ号@qq.com
    export SMTP_PASS=在QQ邮箱设置里生成的授权码   # 不是登录密码
    export SMTP_FROM=你的QQ号@qq.com            # 可省,默认=SMTP_USER
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
    """给 to_email 发注册验证码。失败抛异常。"""
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
