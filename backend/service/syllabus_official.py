# -*- coding: utf-8 -*-
"""按学校组织的**真实官方教学大纲 PDF** 目录 + 代理缓存。

目录文件:records/syllabus_official/catalog.json
  {"schools":[{"id":"shu","name":"上海大学","items":[
      {"course":"高等数学","title":"《高等数学》教学大纲","pdf_url":"https://.../x.pdf",
       "source_page":"https://jwb.shu.edu.cn/...","note":""}]}]}

前端不直接访问各校 pdf_url(会有 https 混合内容/防盗链/CORS),而是请求本服务的
/api/syllabus/official/{school}/{course},由服务端把远端 PDF 拉下来缓存到本地再回传。
"""
import os
import re
import json
import urllib.request
import urllib.parse

_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")


def official_dir(records_root):
    d = os.path.join(records_root, "syllabus_official")
    os.makedirs(d, exist_ok=True)
    return d


def catalog_path(records_root):
    return os.path.join(official_dir(records_root), "catalog.json")


def load_catalog(records_root):
    p = catalog_path(records_root)
    if not os.path.exists(p):
        return {"schools": []}
    try:
        with open(p, encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict) and isinstance(data.get("schools"), list):
            return data
    except Exception:
        pass
    return {"schools": []}


def _safe(name):
    return re.sub(r'[\\/:*?"<>|]', "_", str(name))


def find_item(records_root, school_id, course):
    for sc in load_catalog(records_root).get("schools", []):
        if sc.get("id") != school_id:
            continue
        for it in sc.get("items", []):
            if it.get("course") == course:
                return it
    return None


def cache_page(records_root, school_id, course):
    """把某校某课的**网页版**官方大纲抓下、注入 <base> 后缓存为本地 .html,返回路径。
    注入 <base href=原URL> 是为了让页面里的相对 CSS/图片/链接指回原站,否则挂在我们
    域名下会全部 404。失败返回 None。"""
    it = find_item(records_root, school_id, course)
    if not it or not it.get("page_url"):
        return None
    cdir = os.path.join(official_dir(records_root), "cache", _safe(school_id))
    os.makedirs(cdir, exist_ok=True)
    local = os.path.join(cdir, _safe(course) + ".html")
    if os.path.exists(local) and os.path.getsize(local) > 256:
        return local
    url = it["page_url"]
    pu = urllib.parse.urlsplit(url)
    origin = f"{pu.scheme}://{pu.netloc}/"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": _UA, "Referer": origin})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = resp.read()
    except Exception:
        return None
    if not data or len(data) < 128:
        return None
    base_tag = ('<base href="%s">' % url).encode("ascii", "ignore")
    low = data.lower()
    i = low.find(b"<head")
    if i != -1:
        j = low.find(b">", i)
        data = (data[:j + 1] + base_tag + data[j + 1:]) if j != -1 else (base_tag + data)
    else:
        data = base_tag + data
    tmp = local + ".part"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, local)
    return local


def cache_pdf(records_root, school_id, course):
    """把某校某课的官方 PDF 下载并缓存到本地,返回本地路径;失败返回 None。"""
    it = find_item(records_root, school_id, course)
    if not it or not it.get("pdf_url"):
        return None
    cdir = os.path.join(official_dir(records_root), "cache", _safe(school_id))
    os.makedirs(cdir, exist_ok=True)
    local = os.path.join(cdir, _safe(course) + ".pdf")
    if os.path.exists(local) and os.path.getsize(local) > 1024:
        return local
    url = it["pdf_url"]
    # 很多高校文件服务器裸请求 403,要浏览器 UA + 同源 Referer 才放行。
    pu = urllib.parse.urlsplit(url)
    origin = f"{pu.scheme}://{pu.netloc}/"
    data = None
    for ref in (origin, it.get("source_page") if str(it.get("source_page", "")).startswith("http") else None):
        if ref is None:
            continue
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": _UA, "Referer": ref,
                "Accept": "application/pdf,*/*",
            })
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = resp.read()
            break
        except Exception:
            data = None
    if not data or not data[:5].startswith(b"%PDF"):
        return None
    tmp = local + ".part"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, local)
    return local
