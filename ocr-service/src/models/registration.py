"""
注册数据模型
"""
from pydantic import BaseModel, Field


class RegistrationRequest(BaseModel):
    """用户注册请求"""
    phone: str = Field(..., description="用户 WhatsApp 手机号")
    ic_number: str = Field(..., description="马来西亚身份证号（XXXXXX-XX-XXXX）")


class RegistrationResult(BaseModel):
    """注册处理结果"""
    success: bool
    message: str
    duplicate: bool = False
