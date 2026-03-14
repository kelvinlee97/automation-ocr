FROM python:3.11-slim

WORKDIR /app

# 安装 OpenCV headless 依赖的系统库
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libsm6 \
    libxrender1 \
    libxext6 \
    && rm -rf /var/lib/apt/lists/*

# 先复制依赖文件，利用 Docker layer 缓存（依赖不变时不重新安装）
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制服务代码
COPY . .

# 代码中相对路径会解析到 /config/，但 docker-compose 挂载在 /app/config/
# 创建符号链接让两条路径都能正确访问配置文件
RUN ln -s /app/config /config

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
