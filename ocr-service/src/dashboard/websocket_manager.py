"""
WebSocket 连接管理器
管理所有 Dashboard 前端的 WebSocket 连接，广播处理事件
"""
import json
from typing import Any

from fastapi import WebSocket


class WebSocketManager:
    """管理 WebSocket 连接集合，支持广播"""

    def __init__(self):
        self._connections: set[WebSocket] = set()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._connections.add(ws)

    def disconnect(self, ws: WebSocket) -> None:
        self._connections.discard(ws)

    async def broadcast(self, eventType: str, data: Any) -> None:
        """
        向所有连接广播事件
        自动清理已断开的连接
        """
        if not self._connections:
            return

        payload = json.dumps(
            {"type": eventType, "data": data},
            ensure_ascii=False,
            default=str,
        )

        stale: list[WebSocket] = []
        for ws in self._connections:
            try:
                await ws.send_text(payload)
            except Exception:
                stale.append(ws)

        for ws in stale:
            self._connections.discard(ws)

    @property
    def connectionCount(self) -> int:
        return len(self._connections)


# 全局单例
wsManager = WebSocketManager()
