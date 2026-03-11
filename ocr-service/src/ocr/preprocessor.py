"""
图像预处理模块
对收据截图进行 OpenCV 预处理，提升 OCR 识别准确率
"""
import base64
from typing import Optional

import cv2
import numpy as np


def preprocess_receipt_image(
    image_base64: str,
    grayscale: bool = True,
    enhance_contrast: bool = True,
    denoise: bool = True,
) -> np.ndarray:
    """
    将 base64 图片解码并预处理，返回处理后的 numpy 数组
    处理顺序：解码 → 灰度 → CLAHE 增强 → 去噪
    """
    img = _decode_base64_image(image_base64)

    if grayscale:
        img = _to_grayscale(img)

    if enhance_contrast:
        # CLAHE 比普通直方图均衡更适合收据：局部对比度差异大
        img = _apply_clahe(img)

    if denoise:
        # 非局部均值去噪，比高斯模糊保留边缘更好
        img = _denoise(img)

    return img


def _decode_base64_image(image_base64: str) -> np.ndarray:
    """将 base64 字符串解码为 OpenCV 图像数组"""
    # 去掉可能存在的 data:image/xxx;base64, 前缀
    if "," in image_base64:
        image_base64 = image_base64.split(",", 1)[1]

    img_bytes = base64.b64decode(image_base64)
    img_array = np.frombuffer(img_bytes, dtype=np.uint8)
    img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

    if img is None:
        raise ValueError("图片解码失败，请确认 base64 数据有效")

    return img


def _to_grayscale(img: np.ndarray) -> np.ndarray:
    """转灰度，若已是单通道则直接返回"""
    if len(img.shape) == 3:
        return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return img


def _apply_clahe(img: np.ndarray) -> np.ndarray:
    """
    CLAHE 自适应直方图均衡
    clipLimit=2.0 限制对比度放大倍数，防止噪声被过度放大
    tileGridSize=(8,8) 分块大小，影响局部处理粒度
    """
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    if len(img.shape) == 3:
        # 彩色图：只对亮度通道做 CLAHE
        lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        l_enhanced = clahe.apply(l)
        enhanced = cv2.merge([l_enhanced, a, b])
        return cv2.cvtColor(enhanced, cv2.COLOR_LAB2BGR)
    return clahe.apply(img)


def _denoise(img: np.ndarray) -> np.ndarray:
    """
    非局部均值去噪（Non-Local Means Denoising）
    比高斯模糊更好地保留文字边缘，代价是速度较慢
    h=10 去噪强度，过大会模糊文字
    """
    if len(img.shape) == 3:
        return cv2.fastNlMeansDenoisingColored(img, None, h=10, hColor=10)
    return cv2.fastNlMeansDenoising(img, None, h=10)
