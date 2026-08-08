# -*- coding: utf-8 -*-
"""Signed direct links to files on Alibaba Cloud OSS (private bucket). When the App requests a file,
the backend 302-redirects to this signed URL so the browser pulls straight from OSS, saving xx01 bandwidth.
If not found, let the caller fall back to local.

Reuses the ALIBABA_CLOUD_ACCESS_KEY_ID/SECRET already set in start-server.sh;
bucket/region can be overridden via OSS_BUCKET/OSS_REGION, default live-caption-kt / oss-cn-shanghai.
The OSS key = 'records/' + the path relative to the records root (matching the sync script).
"""
import os
import threading

_lock = threading.Lock()
_bucket = None
_tried = False

KEY_PREFIX = "records/"


def _get_bucket():
    global _bucket, _tried
    if _bucket is not None or _tried:
        return _bucket
    with _lock:
        if _bucket is not None or _tried:
            return _bucket
        _tried = True
        ak = os.environ.get("ALIBABA_CLOUD_ACCESS_KEY_ID")
        sk = os.environ.get("ALIBABA_CLOUD_ACCESS_KEY_SECRET")
        if not ak or not sk:
            return None
        try:
            import oss2
            region = os.environ.get("OSS_REGION", "oss-cn-shanghai")
            name = os.environ.get("OSS_BUCKET", "live-caption-kt")
            endpoint = f"https://{region}.aliyuncs.com"
            _bucket = oss2.Bucket(oss2.Auth(ak, sk), endpoint, name)
        except Exception:
            _bucket = None
        return _bucket


def enabled():
    return _get_bucket() is not None


def _key(relpath):
    return KEY_PREFIX + relpath.replace(os.sep, "/").lstrip("/")


def object_exists(relpath):
    b = _get_bucket()
    if not b:
        return False
    try:
        return b.object_exists(_key(relpath))
    except Exception:
        return False


def signed_url(relpath, expires=7200, disposition=None, inline=False, content_type=None):
    """Generate a signed GET URL for a private object. Returns None if the object is missing or on error (caller falls back to local).
      disposition=filename → force download under that name (attachment);
      inline=True → force inline display (response-content-disposition=inline, overriding an attachment mistakenly stored on the object);
      content_type → override the returned Content-Type (e.g. application/pdf, so the browser previews inline instead of downloading)."""
    b = _get_bucket()
    if not b:
        return None
    key = _key(relpath)
    try:
        if not b.object_exists(key):
            return None
        params = {}
        if inline:
            params["response-content-disposition"] = "inline"
        elif disposition:
            from urllib.parse import quote
            params["response-content-disposition"] = f"attachment; filename*=UTF-8''{quote(disposition)}"
        if content_type:
            params["response-content-type"] = content_type
        return b.sign_url("GET", key, int(expires), params=params or None, slash_safe=True)
    except Exception:
        return None


def read_bytes(relpath):
    """Read an object's content directly from OSS (used to read back files already deleted locally). Returns None if missing or on error."""
    b = _get_bucket()
    if not b:
        return None
    try:
        return b.get_object(_key(relpath)).read()
    except Exception:
        return None


def download_to(relpath, local_path):
    """Download an OSS object to a local path (used to restore offloaded old transcript/audio when resuming a recording). Returns True on success."""
    data = read_bytes(relpath)
    if data is None:
        return False
    try:
        d = os.path.dirname(local_path)
        if d:
            os.makedirs(d, exist_ok=True)
        with open(local_path, "wb") as f:
            f.write(data)
        return True
    except Exception:
        return False


def ensure_uploaded(relpath, local_path):
    """Upload a copy if present locally but not yet on OSS (so a freshly generated file is immediately available)."""
    b = _get_bucket()
    if not b:
        return False
    key = _key(relpath)
    try:
        if b.object_exists(key):
            return True
        import oss2
        oss2.resumable_upload(b, key, local_path,
                              multipart_threshold=8 * 1024 * 1024, num_threads=3)
        return True
    except Exception:
        return False
