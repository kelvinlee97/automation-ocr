"""
Excel 表头 Schema 模块
从 config.yaml 动态读取列结构，避免硬编码表头
"""
from ..config.loader import get_config


def get_registration_columns() -> list[str]:
    """获取注册记录 Sheet 的列名列表"""
    config = get_config()
    return config["excel"]["sheets"]["registrations"]["columns"]


def get_receipt_columns() -> list[str]:
    """获取收据记录 Sheet 的列名列表"""
    config = get_config()
    return config["excel"]["sheets"]["receipts"]["columns"]


def get_registrations_sheet_name() -> str:
    config = get_config()
    return config["excel"]["sheets"]["registrations"]["name"]


def get_receipts_sheet_name() -> str:
    config = get_config()
    return config["excel"]["sheets"]["receipts"]["name"]
