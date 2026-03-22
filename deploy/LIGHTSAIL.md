# AWS Lightsail ($5) 部署指南

本项目已重构为**单进程 AI 版**，不再需要昂贵的 GPU 实例。在 $5/月的 Lightsail (1GB RAM) 上即可流畅运行。

## 1. 准备工作

1.  在 AWS Console 开通一个 **Lightsail 实例**：
    - **OS**: Ubuntu 22.04 LTS
    - **Plan**: $5 USD (1 GB RAM, 2 vCPU)
2.  在 Lightsail 的 **Networking** 标签页，点击 **Create static IP** 并关联到该实例（防止 IP 变动导致 WhatsApp 封号）。
3.  获取你的 **Gemini API Key**：[Google AI Studio](https://aistudio.google.com/app/apikey)。

## 2. 服务器环境安装 (SSH)

连接到 Lightsail 实例后，执行以下命令安装 Docker：

```bash
# 更新并安装 Docker
sudo apt update
sudo apt install -y docker.io docker-compose
sudo usermod -aG docker $USER
newgrp docker
```

## 3. 部署

```bash
# 克隆代码
git clone https://github.com/kelvinlee97/automation-ocr.git
cd automation-ocr

# 创建环境变量文件
echo "GEMINI_API_KEY=你的_API_KEY" > .env

# 启动服务
docker-compose up -d --build

# 扫码登录 (重要)
# 第一次启动后，查看日志获取二维码
docker logs -f wa-bot
```

## 4. 常见问题

- **扫码失败**：如果二维码显示乱码，请尝试调小终端字体，或直接在日志中查看文字版二维码。
- **内存不足**：如果容器崩溃，请检查是否有其他占用内存的进程。1GB RAM 运行 Chrome Headless 稍紧，但对这个规模的应用是足够的。
