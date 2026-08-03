# -*- coding: utf-8 -*-
"""识别板书/PPT 截图内容,供课堂总结、课程总结、考点、模拟卷等一起参考。
有阿里云百炼 DashScope key 就用 Qwen-VL 视觉大模型"看懂"板书(公式/图/字),
否则退回本地 RapidOCR 提取文字。结果按图片文件名缓存(OCR/大模型都慢)。"""
import os
import json

_BOARD_PROMPT = (
    "这是一张课堂板书或投影(PPT)的照片。请把其中的文字、公式、图示/表格内容尽量完整地识别出来,"
    "并用简洁的文字说明它在讲什么(用于课程总结)。直接输出内容,不要客套、不要说'这张图片显示'之类。"
)


def _qwen_describe(image_bytes, api_key, model="qwen-vl-max"):
    import base64
    import urllib.request
    b64 = base64.b64encode(image_bytes).decode()
    payload = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
            {"type": "text", "text": _BOARD_PROMPT},
        ]}],
    }, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req, timeout=60) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return (data["choices"][0]["message"]["content"] or "").strip()


def _rapidocr_text(image_bytes):
    import numpy as np
    import cv2
    from timetable import _get_ocr
    img = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return ""
    res, _ = _get_ocr()(img)
    if not res:
        return ""
    return " ".join(t.strip() for _box, t, _c in res if t.strip())


def recognize_board(image_bytes, cfg):
    key = (os.environ.get("DASHSCOPE_API_KEY")
           or ((cfg.get("ocr") or {}).get("aliyun") or {}).get("api_key") or "")
    if key:
        try:
            return _qwen_describe(image_bytes, key)
        except Exception:
            pass  # 云端失败退回本地
    try:
        return _rapidocr_text(image_bytes)
    except Exception:
        return ""


def board_content(session_dir, cfg):
    """识别一节课的所有板书,返回合并文本;按文件名缓存到 shots/board_ocr.json。"""
    shots_dir = os.path.join(session_dir, "shots")
    if not os.path.isdir(shots_dir):
        return ""
    cache_p = os.path.join(shots_dir, "board_ocr.json")
    cache = {}
    if os.path.exists(cache_p):
        try:
            cache = json.load(open(cache_p, encoding="utf-8"))
        except Exception:
            cache = {}
    files = sorted(f for f in os.listdir(shots_dir)
                   if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp")))
    parts, changed = [], False
    for i, f in enumerate(files):
        txt = cache.get(f)
        if txt is None:
            try:
                with open(os.path.join(shots_dir, f), "rb") as fh:
                    txt = recognize_board(fh.read(), cfg)
            except Exception:
                txt = ""
            cache[f] = txt
            changed = True
        if txt and txt.strip():
            parts.append(f"【板书{i + 1}】{txt.strip()}")
    if changed:
        try:
            json.dump(cache, open(cache_p, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        except Exception:
            pass
    return "\n".join(parts)
