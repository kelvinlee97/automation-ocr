"""
FastAPI 主入口
提供两个核心 API：注册写入 和 收据 OCR + 验证
以及 Dashboard 监控面板
"""
import base64
import os
import time
import uuid
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime

import aiofiles
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from src.config.loader import get_config
from src.dashboard.models import ProcessRecord, ProcessStep
from src.dashboard.router import router as dashboardRouter
from src.dashboard.store import backfill_from_excel, processStore
from src.dashboard.websocket_manager import wsManager
from src.excel.writer import is_ic_registered, write_receipt, write_registration
from src.models.receipt import ReceiptOCRRequest, ReceiptProcessResult
from src.models.registration import RegistrationRequest, RegistrationResult
from src.ocr.engine import get_reader
from src.ocr.extractor import extract_receipt_data
from src.ocr.preprocessor import preprocess_receipt_image


# ── 步骤采集器 ──────────────────────────────────────────────


class StepCollector:
    """收集处理流水线各步骤的耗时和中间数据"""

    def __init__(self):
        self.steps: list[ProcessStep] = []
        self._startTime = time.monotonic()

    @contextmanager
    def step(self, name: str):
        """
        上下文管理器，自动计时并记录步骤结果
        通过 info["detail"] 传递步骤特有数据
        """
        info: dict = {"detail": {}}
        t = time.monotonic()
        try:
            yield info
            status = "success"
        except Exception:
            status = "failed"
            raise
        finally:
            elapsed = round((time.monotonic() - t) * 1000, 1)
            self.steps.append(ProcessStep(
                name=name,
                status=status,
                durationMs=elapsed,
                detail=info["detail"],
            ))

    @property
    def totalDurationMs(self) -> float:
        return round((time.monotonic() - self._startTime) * 1000, 1)


# ── 应用生命周期 ────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用启动时预加载模型并回填历史数据"""
    print("正在预加载 EasyOCR 模型...")
    get_reader()
    print("EasyOCR 模型加载完成")

    # 从 Excel 回填历史记录到内存
    config = get_config()
    relativePath = config["excel"]["file_path"]
    projectRoot = os.path.abspath(os.path.join(os.path.dirname(__file__), "../"))
    excelPath = os.path.join(projectRoot, relativePath)

    count = backfill_from_excel(processStore, excelPath)
    if count > 0:
        print(f"已从 Excel 回填 {count} 条历史记录")

    yield


app = FastAPI(
    title="WhatsApp OCR Service",
    description="收据图片 OCR 识别与处理服务",
    version="1.0.0",
    lifespan=lifespan,
)

# 挂载 Dashboard API 路由
app.include_router(dashboardRouter)


# ── 健康检查 ────────────────────────────────────────────────


@app.get("/health")
async def health_check():
    """健康检查，用于 Node.js 端探测服务可用性"""
    return {"status": "ok", "timestamp": datetime.now().isoformat()}


# ── 注册 ────────────────────────────────────────────────────


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


# ── 收据 OCR 处理 ──────────────────────────────────────────


@app.post("/ocr/receipt", response_model=ReceiptProcessResult)
async def process_receipt(request: ReceiptOCRRequest):
    """
    收据图片 OCR 识别 + 资格验证 + 写入 Excel Sheet2
    完整处理链路：保存 → 预处理 → OCR → 提取 → 验证 → 写入 → 返回
    每个步骤的耗时和详情通过 StepCollector 采集，存入 Dashboard 内存供前端展示
    """
    collector = StepCollector()
    config = get_config()
    eligibleBrands = config["eligibility"]["eligible_brands"]
    minimumAmount = config["eligibility"]["minimum_amount"]
    confidenceThreshold = config["ocr"]["confidence_threshold"]

    try:
        # 1. 保存图片到临时目录（用于审计）
        with collector.step("save_image") as s:
            imagePath = await _save_image(request.image_base64, request.phone)
            fileSize = os.path.getsize(imagePath) if os.path.exists(imagePath) else 0
            s["detail"] = {"filePath": imagePath, "fileSize": fileSize}

        # 2. 图像预处理（拆分自原 recognize_image，独立计时）
        preprocessingCfg = config["ocr"]["preprocessing"]

        with collector.step("preprocess") as s:
            img = preprocess_receipt_image(
                request.image_base64,
                grayscale=preprocessingCfg.get("grayscale", True),
                enhance_contrast=preprocessingCfg.get("enhance_contrast", True),
                denoise=preprocessingCfg.get("denoise", True),
            )
            s["detail"] = {
                "grayscale": preprocessingCfg.get("grayscale", True),
                "enhanceContrast": preprocessingCfg.get("enhance_contrast", True),
                "denoise": preprocessingCfg.get("denoise", True),
            }

        # 3. OCR 识别
        with collector.step("ocr") as s:
            reader = get_reader()
            ocrResults = reader.readtext(img, detail=1)
            rawText = "\n".join(text for _, text, _ in ocrResults)
            s["detail"] = {
                "textBlockCount": len(ocrResults),
                "languages": config["ocr"]["languages"],
            }

        # 4. 提取结构化数据
        with collector.step("extract") as s:
            extracted = extract_receipt_data(ocrResults, rawText)
            s["detail"] = {
                "receiptNo": extracted.receipt_no,
                "rawBrand": extracted.raw_brand,
                "matchedBrand": extracted.matched_brand,
                "amount": extracted.amount,
                "avgConfidence": round(extracted.confidence, 4),
            }

        # 5. 资格验证
        with collector.step("eligibility") as s:
            qualified, disqualifyReason = _check_eligibility(
                extracted, eligibleBrands, minimumAmount, confidenceThreshold
            )
            s["detail"] = {
                "qualified": qualified,
                "reason": disqualifyReason,
            }

        # 6. 写入 Excel
        with collector.step("write_excel") as s:
            seq = await write_receipt(
                phone=request.phone,
                ic_number=request.ic_number or "",
                receipt_no=extracted.receipt_no,
                raw_brand=extracted.raw_brand,
                matched_brand=extracted.matched_brand,
                amount=extracted.amount,
                qualified=qualified,
                disqualify_reason=disqualifyReason,
                confidence=extracted.confidence,
                image_path=imagePath,
            )
            s["detail"] = {"written": True}

        # 构建处理结果
        result = ReceiptProcessResult(
            success=True,
            qualified=qualified,
            receipt_no=extracted.receipt_no,
            brand=extracted.matched_brand,
            amount=extracted.amount,
            confidence=extracted.confidence,
            disqualify_reason=disqualifyReason,
            image_path=imagePath,
            raw_text=extracted.raw_text,
        )

        # 存入 Dashboard 内存 + WebSocket 广播
        record = ProcessRecord(
            id=uuid.uuid4().hex,
            timestamp=datetime.now().isoformat(),
            phone=request.phone,
            icNumber=request.ic_number,
            success=True,
            qualified=qualified,
            receiptNo=extracted.receipt_no,
            brand=extracted.matched_brand,
            amount=extracted.amount,
            confidence=extracted.confidence,
            disqualifyReason=disqualifyReason,
            imagePath=imagePath,
            rawText=extracted.raw_text,
            error=None,
            steps=collector.steps,
        excelSeq=seq,
            totalDurationMs=collector.totalDurationMs,
        )
        processStore.add(record)
        await wsManager.broadcast("new_receipt", record.model_dump())

        return result

    except Exception as e:
        # 异常时也记录到 Dashboard
        record = ProcessRecord(
            id=uuid.uuid4().hex,
            timestamp=datetime.now().isoformat(),
            phone=request.phone,
            icNumber=request.ic_number,
            success=False,
            error=str(e),
            steps=collector.steps,
            excelSeq=None, # 此处明确为 None，因为报错时尚未获得 seq
            totalDurationMs=collector.totalDurationMs,
        )
        processStore.add(record)
        await wsManager.broadcast("new_receipt", record.model_dump())

        return ReceiptProcessResult(
            success=False,
            error=str(e),
        )


# ── 资格验证 ───────────────────────────────────────────────


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


# ── 工具函数 ───────────────────────────────────────────────


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


# ── 静态文件挂载（必须放最后，避免 catch-all 覆盖 API 路由）──

_staticDir = os.path.join(os.path.dirname(__file__), "static")
if os.path.isdir(_staticDir):
    from fastapi import Depends
    from fastapi.responses import FileResponse
    from src.dashboard.auth import verify_admin_credentials
    
    # 建立一个专用于返回前端页面的受保护路由
    @app.get("/dashboard", dependencies=[Depends(verify_admin_credentials)], include_in_schema=False)
    @app.get("/dashboard/", dependencies=[Depends(verify_admin_credentials)], include_in_schema=False)
    async def get_dashboard_html():
        return FileResponse(os.path.join(_staticDir, "index.html"))

    # 把 app.js, style.css 等静态资源直接挂载在 dashboard 的静态路径下
    # 为避免直接通过资源 URL 访问（如有必要），也可以加上中间件，但通常只保护 HTML 入口即可
    app.mount("/dashboard/static", StaticFiles(directory=_staticDir), name="dashboard_assets")
