# -*- coding: utf-8 -*-
"""从阿里云 OSS 取文件的签名直链(私有桶)。App 请求某文件时,后端 302 跳到这个
签名 URL,让浏览器直接从 OSS 拉,省 xx01 带宽。找不到就让调用方回退本地。

复用 start-server.sh 里已有的 ALIBABA_CLOUD_ACCESS_KEY_ID/SECRET;
桶/地域可用 OSS_BUCKET/OSS_REGION 覆盖,默认 live-caption-kt / oss-cn-shanghai。
OSS 上的 key = 'records/' + 相对 records 根目录的路径(与同步脚本一致)。
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
    """生成私有对象的签名 GET URL。对象不存在或出错返回 None(调用方回退本地)。
      disposition=文件名 → 强制以该名下载(attachment);
      inline=True → 强制内嵌显示(response-content-disposition=inline,覆盖对象上误存的 attachment);
      content_type → 覆盖返回的 Content-Type(如 application/pdf,保证浏览器内嵌预览而不是下载)。"""
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
    """直接从 OSS 读对象内容(本地已删的文件靠它读回)。没有/出错返回 None。"""
    b = _get_bucket()
    if not b:
        return None
    try:
        return b.get_object(_key(relpath)).read()
    except Exception:
        return None


def download_to(relpath, local_path):
    """把 OSS 上的对象下载到本地路径(续录时回灌已下沉的旧 transcript/audio)。成功返回 True。"""
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
    """本地有、OSS 还没有就补传一份(供刚生成的文件即时可用)。"""
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
