"""
FastAPI 主入口
提供两个核心 API：注册写入 和 收据 OCR + 验证
"""
import base64
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime

import aiofiles
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse

from src.config.loader import get_config
from src.excel.writer import is_ic_registered, write_receipt, write_registration
from src.models.receipt import ReceiptOCRRequest, ReceiptProcessResult
from src.models.registration import RegistrationRequest, RegistrationResult
from src.ocr.engine import get_reader, recognize_image
from src.ocr.extractor import extract_receipt_data


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用启动时预加载 EasyOCR 模型，避免第一次请求超时"""
    print("正在预加载 EasyOCR 模型...")
    get_reader()
    print("EasyOCR 模型加载完成")
    yield


app = FastAPI(
    title="WhatsApp OCR Service",
    description="收据图片 OCR 识别与处理服务",
    version="1.0.0",
    lifespan=lifespan,
)


@app.get("/health")
async def health_check():
    """健康检查，用于 Node.js 端探测服务可用性"""
    return {"status": "ok", "timestamp": datetime.now().isoformat()}


@app.post("/data/register", response_model=RegistrationResult)
async def register_user(request: RegistrationRequest):
    """
    写入用户注册信息到 Excel Sheet1
    会检查 IC 是否已注册（防重复）
    """
    try:
        already_registered = await is_ic_registered(request.ic_number)
        if already_registered:
            return RegistrationResult(
                success=False,
                message="身份证已注册",
                duplicate=True,
            )

        await write_registration(request.phone, request.ic_number)
        return RegistrationResult(
            success=True,
            message="注册成功",
            duplicate=False,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"注册写入失败: {str(e)}")


@app.post("/ocr/receipt", response_model=ReceiptProcessResult)
async def process_receipt(request: ReceiptOCRRequest):
    """
    收据图片 OCR 识别 + 资格验证 + 写入 Excel Sheet2
    完整处理链路：解码 → 预处理 → OCR → 提取 → 验证 → 写入 → 返回
    """
    config = get_config()
    eligible_brands = config["eligibility"]["eligible_brands"]
    minimum_amount = config["eligibility"]["minimum_amount"]
    confidence_threshold = config["ocr"]["confidence_threshold"]

    try:
        # 1. 保存图片到临时目录（用于审计）
        image_path = await _save_image(request.image_base64, request.phone)

        # 2. OCR 识别
        ocr_results, raw_text = recognize_image(request.image_base64)

        # 3. 提取结构化数据
        extracted = extract_receipt_data(ocr_results, raw_text)

        # 4. 资格验证
        qualified, disqualify_reason = _check_eligibility(
            extracted, eligible_brands, minimum_amount, confidence_threshold
        )

        # 5. 写入 Excel
        await write_receipt(
            phone=request.phone,
            ic_number=request.ic_number or "",
            receipt_no=extracted.receipt_no,
            raw_brand=extracted.raw_brand,
            matched_brand=extracted.matched_brand,
            amount=extracted.amount,
            qualified=qualified,
            disqualify_reason=disqualify_reason,
            confidence=extracted.confidence,
            image_path=image_path,
        )

        return ReceiptProcessResult(
            success=True,
            qualified=qualified,
            receipt_no=extracted.receipt_no,
            brand=extracted.matched_brand,
            amount=extracted.amount,
            confidence=extracted.confidence,
            disqualify_reason=disqualify_reason,
            image_path=image_path,
            raw_text=extracted.raw_text,
        )

    except Exception as e:
        # 异常不中断服务，返回失败结果便于 Bot 提示用户重试
        return ReceiptProcessResult(
            success=False,
            error=str(e),
        )


def _check_eligibility(
    extracted,
    eligible_brands: list[str],
    minimum_amount: float,
    confidence_threshold: float,
) -> tuple[bool, str | None]:
    """
    资格验证逻辑
    返回：(是否合格, 不合格原因)
    """
    # 低置信度：先记录，不直接拒绝，标注待人工审核
    if extracted.confidence < confidence_threshold:
        return False, f"OCR 置信度过低（{extracted.confidence:.2%}），请提交更清晰的图片"

    # 品牌不在白名单
    if extracted.matched_brand is None:
        brand_display = extracted.raw_brand or "未识别"
        brands_str = "、".join(eligible_brands)
        return False, f"品牌「{brand_display}」不在活动范围内（支持：{brands_str}）"

    # 金额未识别
    if extracted.amount is None:
        return False, "无法识别消费金额，请确认收据清晰可见"

    # 金额不达标
    if extracted.amount < minimum_amount:
        return False, f"消费金额 RM {extracted.amount:.2f} 未达到最低门槛 RM {minimum_amount:.2f}"

    return True, None


async def _save_image(image_base64: str, phone: str) -> str:
    """
    将 base64 图片保存到 data/uploads 目录
    文件名格式：手机号_时间戳_uuid.jpg
    """
    # 去掉 data URI 前缀
    if "," in image_base64:
        image_base64 = image_base64.split(",", 1)[1]

    project_root = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "../")
    )
    upload_dir = os.path.join(project_root, "data", "uploads")
    os.makedirs(upload_dir, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{phone}_{timestamp}_{uuid.uuid4().hex[:8]}.jpg"
    file_path = os.path.join(upload_dir, filename)

    img_bytes = base64.b64decode(image_base64)
    async with aiofiles.open(file_path, "wb") as f:
        await f.write(img_bytes)

    return file_path
