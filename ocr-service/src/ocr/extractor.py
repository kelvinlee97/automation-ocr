"""
OCR 结果提取模块
从原始 OCR 文本中提取结构化字段：单据号、品牌、金额
"""
import re
import statistics
from typing import Optional

from rapidfuzz import fuzz

from ..config.loader import get_config
from ..models.receipt import ExtractedReceiptData


# 马来西亚收据常见的金额关键词（中/英/马来文混合）
_AMOUNT_KEYWORDS = [
    r"total",
    r"jumlah",       # 马来语"总计"
    r"grand\s*total",
    r"amount\s*due",
    r"subtotal",
    r"rm\s*[\d,]+\.?\d*",   # 直接跟金额的 RM
]

# 单据号常见关键词前缀
_RECEIPT_NO_KEYWORDS = [
    r"receipt\s*(?:no\.?|number|#)",
    r"invoice\s*(?:no\.?|number|#)",
    r"no\.\s*resit",         # 马来语
    r"resit\s*no",
    r"transaction\s*(?:id|no\.?)",
    r"ref(?:erence)?\s*(?:no\.?|#)",
]

# 编译后的金额提取正则（RM 后跟数字）
_AMOUNT_PATTERN = re.compile(
    r"(?:RM|MYR)\s*([\d,]+\.?\d*)|"
    r"([\d,]+\.\d{2})\s*(?:RM|MYR)",
    re.IGNORECASE,
)

# 单据号提取：关键词后跟字母数字组合（至少4位）
_RECEIPT_NO_PATTERN = re.compile(
    r"(?:" + "|".join(_RECEIPT_NO_KEYWORDS) + r")\s*[:\-#]?\s*([A-Z0-9\-/]{4,30})",
    re.IGNORECASE,
)


def extract_receipt_data(
    ocr_results: list[tuple],
    raw_text: str,
) -> ExtractedReceiptData:
    """
    从 OCR 结果提取结构化收据信息
    ocr_results: [(bbox, text, confidence), ...]
    raw_text: 所有识别文本的拼接
    """
    config = get_config()
    eligible_brands = config["eligibility"]["eligible_brands"]
    brand_threshold = config["eligibility"]["brand_match_threshold"]
    confidence_threshold = config["ocr"]["confidence_threshold"]

    # 计算 OCR 整体平均置信度
    confidences = [conf for _, _, conf in ocr_results if conf is not None]
    avg_confidence = statistics.mean(confidences) if confidences else 0.0

    receipt_no = _extract_receipt_no(raw_text)
    amount = _extract_amount(raw_text)
    raw_brand, matched_brand = _extract_brand(raw_text, eligible_brands, brand_threshold)

    return ExtractedReceiptData(
        receipt_no=receipt_no,
        raw_brand=raw_brand,
        matched_brand=matched_brand,
        amount=amount,
        confidence=avg_confidence,
        raw_text=raw_text,
    )


def _extract_receipt_no(text: str) -> Optional[str]:
    """从文本中提取单据号"""
    match = _RECEIPT_NO_PATTERN.search(text)
    if match:
        return match.group(1).strip()

    # 备用策略：识别独立的字母数字编号行（常见收据格式）
    fallback_pattern = re.compile(r"^[A-Z]{2,4}[-/]?\d{6,12}$", re.MULTILINE)
    fallback_match = fallback_pattern.search(text)
    if fallback_match:
        return fallback_match.group(0).strip()

    return None


def _extract_amount(text: str) -> Optional[float]:
    """
    从文本中提取最终消费金额
    策略：优先找 Total/Jumlah 附近的金额，找不到则取文本中最大金额
    （最大金额通常是总计，小金额是单项价格）
    """
    # 先尝试在 Total 关键词附近查找
    total_pattern = re.compile(
        r"(?:total|jumlah|grand\s*total|amount\s*due)\s*[:\-]?\s*(?:RM)?\s*([\d,]+\.?\d*)",
        re.IGNORECASE,
    )
    total_match = total_pattern.search(text)
    if total_match:
        return _parse_amount(total_match.group(1))

    # 全局找所有 RM 金额，取最大值
    all_amounts = []
    for match in _AMOUNT_PATTERN.finditer(text):
        raw_val = match.group(1) or match.group(2)
        parsed = _parse_amount(raw_val)
        if parsed is not None:
            all_amounts.append(parsed)

    return max(all_amounts) if all_amounts else None


def _parse_amount(raw: str) -> Optional[float]:
    """将字符串金额（可能含逗号）解析为 float"""
    try:
        return float(raw.replace(",", ""))
    except (ValueError, AttributeError):
        return None


def _extract_brand(
    text: str,
    eligible_brands: list[str],
    threshold: int,
) -> tuple[Optional[str], Optional[str]]:
    """
    从文本中识别品牌
    返回：(原始识别品牌文本, 匹配到的标准品牌名)
    使用 rapidfuzz.fuzz.partial_ratio 对 OCR 容错更好
    """
    # 将文本按行拆分，逐行与品牌白名单匹配
    lines = [line.strip() for line in text.split("\n") if line.strip()]

    best_score = 0
    best_raw = None
    best_matched = None

    for line in lines:
        for brand in eligible_brands:
            # partial_ratio: 检测子串相似度，对 OCR 识别多余字符更宽容
            score = fuzz.partial_ratio(brand.lower(), line.lower())
            if score > best_score:
                best_score = score
                best_raw = line
                best_matched = brand

    if best_score >= threshold:
        return best_raw, best_matched

    return best_raw, None
