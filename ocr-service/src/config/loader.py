"""
配置加载模块
使用单例模式确保 config.yaml 只被解析一次，避免重复 IO
"""
import os
from functools import lru_cache
from typing import Any

import yaml


# 默认配置文件路径（相对于项目根目录）
_DEFAULT_CONFIG_PATH = os.path.join(
    os.path.dirname(__file__), "../../../config/config.yaml"
)


@lru_cache(maxsize=1)
def get_config(config_path: str = None) -> dict[str, Any]:
    """
    加载并缓存配置，首次调用后结果被 lru_cache 缓存
    config_path 为 None 时使用默认路径
    """
    path = config_path or os.environ.get("CONFIG_PATH", _DEFAULT_CONFIG_PATH)
    abs_path = os.path.abspath(path)

    if not os.path.exists(abs_path):
        raise FileNotFoundError(f"配置文件不存在: {abs_path}")

    with open(abs_path, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)

    if not config:
        raise ValueError(f"配置文件为空: {abs_path}")

    return config
