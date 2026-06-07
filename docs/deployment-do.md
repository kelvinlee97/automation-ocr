# DigitalOcean 部署指南

## 前置条件

- DigitalOcean 账户
- 一个域名，可配置 A 记录
- GitHub repo 的 Settings > Secrets 权限

## 一、创建 Droplet

1. 登录 DigitalOcean 控制台
2. Create Droplet:
   - Region: Singapore (sgp1)
   - Image: Ubuntu 24.04 LTS
   - Size: Basic, 1 vCPU / 2GB / 50GB SSD ($12/月)
   - Authentication: SSH Key
3. 记下 Droplet 公网 IP

## 二、配置 DigitalOcean 云端防火墙

> **重要**：DigitalOcean 云端防火墙在虚拟机之外，UFW 无法控制它。必须在 DO 控制台配置，否则 80/443 入站流量会被拦截，导致 Let's Encrypt 证书申请失败。

1. 打开 [DigitalOcean 控制台 > Networking > Firewalls](https://cloud.digitalocean.com/networking/firewalls)
2. Create Firewall，绑定到刚创建的 Droplet
3. **入站规则（Inbound Rules）**——按表格添加：

   | 协议 | 端口 | 来源（Sources） | 用途 |
   |------|------|-----------------|------|
   | TCP  | 22   | 你的办公网 IP（推荐）或 `All IPv4 + All IPv6` | SSH 管理 |
   | TCP  | 80   | `All IPv4 + All IPv6` | HTTP（Let's Encrypt challenge + HTTPS 重定向） |
   | TCP  | 443  | `All IPv4 + All IPv6` | HTTPS（用户访问 + WhatsApp Web） |
   | UDP  | 443  | `All IPv4 + All IPv6` | HTTP/3（可选但推荐） |

   > ⚠️ 来源 `All IPv4 + All IPv6` 意味着全网可访问。80/443 必须全网开放，否则 Let's Encrypt 无法完成域名验证。22 端口建议限制为你的办公网 IP。

4. **出站规则（Outbound Rules）**：保持默认（允许所有出站）即可
5. 保存防火墙，等待规则生效（约 1 分钟）

验证防火墙已生效：

```bash
# 在本地机器执行，确认 80 端口可访问（应返回 308 或 200）
curl -s -o /dev/null -w "%{http_code}" http://<DROPLET_IP>/
```

## 三、DNS 配置

将域名 A 记录指向 Droplet IP：

```
A    admin.example.com    <DROPLET_IP>    300
```

## 四、初始化 Droplet

```bash
# SSH 到 Droplet（首次用 root）
ssh root@<DROPLET_IP>

# 下载并运行 bootstrap（system 阶段）
curl -fsSL https://raw.githubusercontent.com/kelvinlee97/automation-ocr/main/scripts/bootstrap.sh | bash -s system
```

## 五、配置 deploy 用户 SSH

```bash
# 在 Droplet 上
mkdir -p /home/deploy/.ssh
cp ~/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys
```

为 CI/CD 生成专用密钥对：

```bash
# 在本地机器上
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/do_deploy_key -N ""

# 将公钥追加到 Droplet
ssh root@<DROPLET_IP> "echo '$(cat ~/.ssh/do_deploy_key.pub)' >> /home/deploy/.ssh/authorized_keys"
```

## 六、配置 GitHub Secrets

在 GitHub repo Settings > Secrets and variables > Actions 中添加：

| Secret | 值 |
|---|---|
| `DO_SSH_HOST` | Droplet 公网 IP |
| `DO_SSH_USER` | `deploy` |
| `DO_SSH_KEY` | `~/.ssh/do_deploy_key` 的内容（私钥） |
| `GHCR_PAT` | GitHub PAT（需要 `read:packages` scope），如果仓库/包是 public 则不需要 |

## 七、部署项目

```bash
# 以 deploy 用户 SSH 到 Droplet
ssh deploy@<DROPLET_IP>

# clone 代码
git clone git@github.com:kelvinlee97/automation-ocr.git /opt/automation-ocr
cd /opt/automation-ocr

# 创建 .env
cat > .env << 'EOF'
GEMINI_API_KEY=<你的 key>
SESSION_SECRET=<openssl rand -hex 32 生成>
DOMAIN=admin.example.com
EOF

# 运行 deploy 阶段
bash scripts/bootstrap.sh deploy
```

## 八、数据迁移（如有旧数据）

```bash
# 在 AWS EC2 上打包
cd /home/ubuntu/automation-ocr
tar czf /tmp/data-backup.tar.gz data/

# 传输到 DO Droplet
scp /tmp/data-backup.tar.gz deploy@<DROPLET_IP>:/opt/automation-ocr/

# 在 DO Droplet 上解压
cd /opt/automation-ocr
tar xzf data-backup.tar.gz && rm data-backup.tar.gz

# 重启容器加载数据
docker compose restart
```

注意：`data/wwebjs_auth/` 搬迁后可能因 IP 变化需要重新扫码。

## 九、验证

1. 访问 `https://your-domain.com` 确认管理后台可用
2. 检查 WhatsApp bot 是否正常响应消息
3. 触发一次 `git push` 到 main，确认自动部署正常

## 十、AWS 清理

验证一切正常后：

```bash
# 删除 CloudFormation stack
aws cloudformation delete-stack --stack-name automation-ocr --region ap-southeast-1

# 等待删除完成
aws cloudformation wait stack-delete-complete --stack-name automation-ocr --region ap-southeast-1
```

然后在 GitHub Settings 中删除 AWS 相关 Secrets：
- `AWS_DEPLOY_ROLE_ARN`
- 其他 AWS 相关 Secrets
