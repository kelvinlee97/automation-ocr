"""
收据数据模型
"""
from typing import Optional
from pydantic import BaseModel, Field


class ReceiptOCRRequest(BaseModel):
    """OCR 识别请求：base64 编码的图片"""
    image_base64: str = Field(..., description="Base64 编码的收据图片")
    phone: str = Field(..., description="用户手机号")
    ic_number: Optional[str] = Field(None, description="用户身份证号（可选）")


class ExtractedReceiptData(BaseModel):
    """OCR 提取的原始收据信息"""
    receipt_no: Optional[str] = None
    raw_brand: Optional[str] = None       # OCR 识别的原始品牌文字
    matched_brand: Optional[str] = None   # 经模糊匹配后的标准品牌名
    amount: Optional[float] = None
    confidence: float = 0.0               # OCR 整体置信度均值
    raw_text: str = ""                    # 完整原始 OCR 文本（用于审计）


class ReceiptProcessResult(BaseModel):
    """收据处理最终结果"""
    success: bool
    qualified: bool = False
    receipt_no: Optional[str] = None
    brand: Optional[str] = None
    amount: Optional[float] = None
    confidence: float = 0.0
    disqualify_reason: Optional[str] = None
    image_path: Optional[str] = None
    raw_text: Optional[str] = None           # 完整原始 OCR 文本，供前端展示
    error: Optional[str] = None
