# -*- coding: utf-8 -*-
"""Shanghai University academic system (jwxt.shu.edu.cn) auto-login + timetable scraping.
Uses a Playwright headless browser to simulate login (unified identity auth, newsso), then finds and scrapes the timetable page on success.
The password is only used briefly in this server's memory and never written to disk. In the debug phase the post-login page is saved to debug_dir to help adapt the parsing."""
import os
import re


def sync_timetable(username, password, debug_dir):
    from playwright.sync_api import sync_playwright
    out = {"events": [], "note": "", "debug": {}}
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
        ctx = b.new_context(viewport={"width": 1440, "height": 1000},
                            user_agent=("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                                        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"))
        pg = ctx.new_page()
        try:
            pg.goto("https://jwxt.shu.edu.cn", wait_until="networkidle", timeout=45000)
            pg.wait_for_timeout(1500)
            # login form: #username / #password / submit button
            pg.fill("#username", username)
            pg.fill("#password", password)
            pg.click("button[type=submit]")
            # login succeeded = redirected back to jwxt.shu.edu.cn
            try:
                pg.wait_for_url(re.compile(r"jwxt\.shu\.edu\.cn"), timeout=30000)
            except Exception:
                body = ""
                try:
                    body = pg.inner_text("body")
                except Exception:
                    pass
                # still on newsso = login didn't go through
                if "newsso" in pg.url:
                    return {"error": "登录失败:学工号或密码不对(也可能需要验证码)", "detail": body[:200]}
            pg.wait_for_load_state("networkidle", timeout=30000)
            pg.wait_for_timeout(2500)

            os.makedirs(debug_dir, exist_ok=True)
            # save the home page, for adaptation
            try:
                open(os.path.join(debug_dir, "home.html"), "w", encoding="utf-8").write(pg.content())
                pg.screenshot(path=os.path.join(debug_dir, "home.png"), full_page=True)
            except Exception:
                pass
            # collect all link/menu text, look for "timetable"
            links = pg.eval_on_selector_all(
                "a", "els=>els.map(e=>({t:(e.innerText||'').trim(),h:e.href})).filter(x=>x.t)")
            try:
                open(os.path.join(debug_dir, "links.txt"), "w", encoding="utf-8").write(
                    "\n".join(f"{l['t']}\t{l['h']}" for l in links))
            except Exception:
                pass
            kb = [l for l in links if "课表" in (l.get("t") or "")]
            out["debug"] = {"home_url": pg.url, "link_count": len(links),
                            "kb_links": kb[:10]}

            # try the first "timetable" link and save the page for parsing/adaptation
            if kb:
                try:
                    pg.goto(kb[0]["h"], wait_until="networkidle", timeout=40000)
                    pg.wait_for_timeout(2500)
                    open(os.path.join(debug_dir, "kebiao.html"), "w", encoding="utf-8").write(pg.content())
                    pg.screenshot(path=os.path.join(debug_dir, "kebiao.png"), full_page=True)
                    out["debug"]["kebiao_url"] = pg.url
                    out["note"] = "已登录并打开课表页,课表结构已抓取(待适配解析)。"
                except Exception as e:
                    out["note"] = f"已登录,但打开课表页失败:{e}"
            else:
                out["note"] = "已登录,但首页没直接找到'课表'入口,已存首页供适配。"
        finally:
            b.close()
    return out
