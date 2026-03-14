"""
Dashboard 数据模型
处理记录和处理步骤的结构定义
"""
from typing import Optional

from pydantic import BaseModel


class ProcessStep(BaseModel):
    """处理流水线中的单个步骤"""
    name: str          # save_image / preprocess / ocr / extract / eligibility / write_excel
    status: str        # success / failed
    durationMs: float  # 耗时（毫秒）
    detail: dict       # 步骤特有数据，不同步骤结构不同


class ProcessRecord(BaseModel):
    """一次完整的收据处理记录"""
    id: str                          # uuid4 hex
    timestamp: str                   # ISO 8601
    phone: str
    icNumber: Optional[str] = None
    # 处理结果
    success: bool
    qualified: bool = False
    receiptNo: Optional[str] = None
    brand: Optional[str] = None
    amount: Optional[float] = None
    confidence: float = 0.0
    disqualifyReason: Optional[str] = None
    imagePath: Optional[str] = None
    rawText: Optional[str] = None
    error: Optional[str] = None
    # 步骤详情（从 Excel 回填的历史记录无此数据）
    steps: list[ProcessStep] = []
    totalDurationMs: float = 0.0
