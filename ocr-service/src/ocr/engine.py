"""
EasyOCR 引擎单例
EasyOCR 初始化（加载模型）耗时 5-15 秒，必须复用实例
"""
import base64
import threading
from typing import Optional

import easyocr
import numpy as np

from ..config.loader import get_config
from .preprocessor import preprocess_receipt_image


# 用于线程安全的单例初始化
_lock = threading.Lock()
_reader: Optional[easyocr.Reader] = None


def get_reader() -> easyocr.Reader:
    """
    懒加载 EasyOCR Reader，全局只初始化一次
    使用双重检查锁（Double-Checked Locking）保证线程安全
    """
    global _reader
    if _reader is None:
        with _lock:
            if _reader is None:
                config = get_config()
                languages = config["ocr"]["languages"]
                # gpu=False 避免环境依赖，生产环境有 GPU 可改为 True
                _reader = easyocr.Reader(languages, gpu=False)
    return _reader


def recognize_image(image_base64: str) -> tuple[list[tuple], str]:
    """
    对 base64 图片执行 OCR 识别
    返回：(结果列表, 原始文本拼接)
    结果列表格式：[(bbox, text, confidence), ...]
    """
    config = get_config()
    preprocessing_cfg = config["ocr"]["preprocessing"]

    # 预处理图片
    img = preprocess_receipt_image(
        image_base64,
        grayscale=preprocessing_cfg.get("grayscale", True),
        enhance_contrast=preprocessing_cfg.get("enhance_contrast", True),
        denoise=preprocessing_cfg.get("denoise", True),
    )

    reader = get_reader()
    # detail=1 返回包含置信度的完整结果
    results = reader.readtext(img, detail=1)

    # 拼接所有识别文本，保留换行位置信息用于后续正则
    raw_text = "\n".join(text for _, text, _ in results)

    return results, raw_text
