# -*- coding: utf-8 -*-
"""Catalog + proxy cache of **real official syllabus PDFs**, organized by school.

Catalog file: records/syllabus_official/catalog.json
  {\"schools\":[{\"id\":\"shu\",\"name\":\"Shanghai University\",\"items\":[
      {\"course\":\"Advanced Mathematics\",\"title\":\"Advanced Mathematics Syllabus\",\"pdf_url\":\"https://.../x.pdf\",
       \"source_page\":\"https://jwb.shu.edu.cn/...\",\"note\":\"\"}]}]}

The frontend doesn't hit each school's pdf_url directly (https mixed-content / hotlink-protection / CORS issues); instead it requests this service's
/api/syllabus/official/{school}/{course}, and the server fetches the remote PDF, caches it locally, and returns it.
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
    """Fetch a school/course's **web-page** official syllabus, inject <base>, cache it as a local .html, and return the path.
    Injecting <base href=originalURL> makes the page's relative CSS/images/links point back to the original site; otherwise,
    served under our domain they would all 404. Returns None on failure."""
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
    """Download and cache a school/course's official PDF locally, returning the local path; None on failure."""
    it = find_item(records_root, school_id, course)
    if not it or not it.get("pdf_url"):
        return None
    cdir = os.path.join(official_dir(records_root), "cache", _safe(school_id))
    os.makedirs(cdir, exist_ok=True)
    local = os.path.join(cdir, _safe(course) + ".pdf")
    if os.path.exists(local) and os.path.getsize(local) > 1024:
        return local
    url = it["pdf_url"]
    # Many university file servers return 403 on a bare request; they only allow a browser UA + same-origin Referer.
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
