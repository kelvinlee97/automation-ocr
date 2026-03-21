"""
Dashboard API 路由
提供收据记录查询、图片预览、服务状态、WebSocket 实时推送
"""
import os
import time
from pathlib import PurePosixPath
from typing import Optional

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse

from ..config.loader import get_config
from .models import ProcessRecord
from .store import processStore
from .websocket_manager import wsManager

router = APIRouter()

# 服务启动时间，用于计算 uptime
_startTime = time.monotonic()


@router.get("/api/receipts")
async def list_receipts(
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    phone: Optional[str] = Query(None, description="手机号模糊搜索"),
):
    """分页查询收据处理记录"""
    items, total = processStore.list(offset=offset, limit=limit, phone=phone)
    return {
        "items": [item.model_dump() for item in items],
        "total": total,
        "offset": offset,
        "limit": limit,
    }


@router.get("/api/receipts/{recordId}")
async def get_receipt(recordId: str):
    """查询单条记录详情（含处理步骤）"""
    record = processStore.get(recordId)
    if not record:
        return JSONResponse(status_code=404, content={"detail": "记录不存在"})
    return record.model_dump()


@router.get("/api/receipts/{recordId}/image")
async def get_receipt_image(recordId: str):
    """获取收据图片，校验路径防止目录穿越"""
    record = processStore.get(recordId)
    if not record or not record.imagePath:
        return JSONResponse(status_code=404, content={"detail": "图片不存在"})

    imagePath = os.path.realpath(record.imagePath)

    # 校验路径必须在 data/uploads 目录下，防止穿越攻击
    projectRoot = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../"))
    allowedDir = os.path.realpath(os.path.join(projectRoot, "data", "uploads"))

    if not imagePath.startswith(allowedDir + os.sep) and imagePath != allowedDir:
        return JSONResponse(status_code=403, content={"detail": "路径不允许"})

    if not os.path.isfile(imagePath):
        return JSONResponse(status_code=404, content={"detail": "图片文件不存在"})

    return FileResponse(imagePath, media_type="image/jpeg")


@router.get("/api/status")
async def get_status():
    """服务状态概览"""
    config = get_config()
    uptimeSeconds = round(time.monotonic() - _startTime)

    return {
        "ocr": {
            "status": "healthy",
            "uptimeSeconds": uptimeSeconds,
            "processedCount": processStore.count,
            "lastProcessedAt": processStore.lastProcessedAt,
        },
        "websocket": {
            "activeConnections": wsManager.connectionCount,
        },
        "config": {
            "ocrLanguages": config["ocr"]["languages"],
            "confidenceThreshold": config["ocr"]["confidence_threshold"],
        },
    }


@router.websocket("/ws/events")
async def websocket_events(ws: WebSocket):
    """实时事件推送：新收据处理完成时广播给所有连接"""
    await wsManager.connect(ws)
    try:
        # 保持连接，等待客户端断开
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        wsManager.disconnect(ws)

from pydantic import BaseModel

class ReceiptUpdateRequest(BaseModel):
    brand: Optional[str] = None
    amount: Optional[float] = None
    qualified: bool
    receiptNo: Optional[str] = None
    disqualifyReason: Optional[str] = None

@router.put("/api/receipts/{recordId}")
async def update_receipt(recordId: str, req: ReceiptUpdateRequest):
    """人工审核更新结果，并同步修改 Excel"""
    record = processStore.get(recordId)
    if not record:
        return JSONResponse(status_code=404, content={"detail": "记录不存在"})

    if record.excelSeq is None:
        return JSONResponse(status_code=400, content={"detail": "该记录无对应的 Excel 行，无法更新"})

    from ..excel.writer import update_receipt_in_excel
    success = await update_receipt_in_excel(
        seq=record.excelSeq,
        matched_brand=req.brand,
        amount=req.amount,
        qualified=req.qualified,
        disqualify_reason=req.disqualifyReason,
        receipt_no=req.receiptNo,
    )

    if not success:
        return JSONResponse(status_code=500, content={"detail": "写入 Excel 失败，可能是对应行已被删除"})

    # 更新内存记录
    record.brand = req.brand
    record.amount = req.amount
    record.qualified = req.qualified
    record.receiptNo = req.receiptNo
    record.disqualifyReason = req.disqualifyReason

    # 广播更新（可选）
    await wsManager.broadcast("update_receipt", record.model_dump())

    return {"status": "ok", "record": record.model_dump()}
