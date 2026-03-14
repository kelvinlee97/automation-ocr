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

# 复制业务配置（config 目录在项目根，通过 docker-compose volumes 挂载）
# 这里不 COPY config，因为运行时从挂载卷读取

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
