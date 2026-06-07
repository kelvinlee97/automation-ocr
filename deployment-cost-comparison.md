# automation-ocr 部署成本对比

日期：2026-05-26

## 结论

> **状态：已迁移至 DigitalOcean sgp1 (2026-05-27)**

如果只是稳定运行这个 WhatsApp + OCR bot，AWS EC2 不是最便宜的选择。

推荐顺序：

1. **省心生产**：DigitalOcean 2GB 或 Vultr 2GB
2. **最低成本**：Hetzner CX23
3. **继续 AWS**：优先 AWS Lightsail 2GB，其次 EC2 t3.small

当前 AWS 模板使用 `t3.micro`，只有 1GB RAM。由于项目依赖 `whatsapp-web.js` 和 Chromium，长期运行偏紧，建议至少 2GB RAM。

---

## 项目资源需求判断

项目是单容器部署，不需要 RDS / Redis / Kubernetes。

关键依据：

- `docker-compose.yml` 只有一个 `wa-bot` 服务
- 持久化目录包括 `./data`、`./data/wwebjs_auth`
- 使用 SQLite 本地数据库
- 使用 `whatsapp-web.js`，会启动 Chromium
- 使用 Gemini API 做 OCR / AI 解析

主要资源消耗：

1. Node.js 应用
2. Chromium / whatsapp-web.js
3. SQLite 数据库
4. 收据图片存储
5. Excel 导出文件
6. Docker 本身开销

推荐规格：

| 场景 | CPU | RAM | 磁盘 |
|---|---:|---:|---:|
| 最低可跑 | 1 vCPU | 1.5-2GB | 20-30GB |
| 推荐生产 | 1-2 vCPU | 2GB | 40-60GB |
| 更舒适 | 2 vCPU | 4GB | 50GB+ |

必须保留的数据目录：

- `data/app.db`：SQLite 数据库
- `data/images/`：收据图片
- `data/excel/`：Excel 导出文件
- `data/wwebjs_auth/`：WhatsApp 登录状态，丢失后需要重新扫码

---

## 月成本粗算

以下按 24/7 运行、730 小时/月估算，未含税。

| 平台 | 推荐规格 | 月费估算 | 部署难度 | 评价 |
|---|---:|---:|---|---|
| AWS EC2 当前 t3.micro | 2 vCPU / 1GB | 约 $14-17/月 | 高 | 便宜但内存偏小，不推荐长期跑 |
| AWS EC2 推荐 t3.small | 2 vCPU / 2GB | 约 $22-27/月 | 高 | 稳，但比 VPS 贵 |
| AWS Lightsail | 2 vCPU / 2GB / 60GB | $12/月 | 中低 | 如果想留在 AWS，比 EC2 简单便宜 |
| DigitalOcean | 1 vCPU / 2GB / 50GB | $12/月 | 低 | 很适合这个项目 |
| Vultr | 1 vCPU / 2GB / 55GB | $10/月 | 低 | 性价比好 |
| Akamai / Linode | 1 vCPU / 2GB / 50GB | $12/月 | 低 | 稳定，和 DO 类似 |
| Hetzner CX23 | 2 vCPU / 4GB / 40GB | 约 €4.49/月，约 $5 左右 | 中 | 最便宜，但区域/账号审核/支持体验要考虑 |
| OVH d2-2 | 1 vCPU / 2GB / 25GB | 约 $9/月 | 中 | 流量慷慨，体验不如 DO 简单 |
| Oracle Always Free | ARM 免费额度 | $0/月 | 高 | 免费但抢容量、ARM 架构、部署麻烦，不建议生产首选 |

---

## AWS EC2 成本

当前 AWS 部署区域是 Singapore：`ap-southeast-1`。

### 方案 A：当前模板 t3.micro

当前 CloudFormation 模板使用：

```yaml
InstanceType: t3.micro
```

粗算：

| 项目 | 月费 |
|---|---:|
| EC2 t3.micro Singapore | 约 $9.64 |
| EBS 20-30GB | 约 $2-3 |
| 公网 IPv4 | 约 $3.60 |
| 镜像仓库 / 少量存储 | 约 $0-1 |
| 低流量出站 | 通常很低 |

合计：**约 $15-17/月**

问题：1GB RAM 对 Chromium 偏小。能跑，但不稳。

### 方案 B：推荐 EC2 t3.small

| 项目 | 月费 |
|---|---:|
| EC2 t3.small Singapore | 约 $19.27 |
| EBS 30GB | 约 $2-3 |
| 公网 IPv4 | 约 $3.60 |
| 其他 | 约 $0-1 |

合计：**约 $25-27/月**

这是 AWS EC2 上比较稳的起点。

### 方案 C：AWS Lightsail 2GB

Lightsail 2GB Linux 方案：

- 2GB RAM
- 2 vCPU
- 60GB SSD
- 3TB 流量
- IPv4 included

月费：**$12/月**

如果不强依赖当前 CloudFormation / SSM / IAM 体系，Lightsail 比 EC2 更适合这个项目。

---

## 非 AWS 方案

### DigitalOcean

推荐方案：

- Basic Droplet
- 1 vCPU / 2GB RAM / 50GB SSD
- 2TB 流量
- IPv4 included
- $12/月

部署难度：低。

适合当前项目。迁移步骤大致是：

1. 创建 Ubuntu Droplet
2. 配 SSH key
3. 跑 bootstrap 脚本
4. 配 `.env`
5. `docker compose up -d`

缺点：

- 没有 AWS SSM 这种免 SSH 管理
- 备份额外收费
- IAM / 权限体系比 AWS 简单很多

综合推荐度很高。

---

### Vultr

推荐方案：

- Regular Performance
- 1 vCPU / 2GB RAM / 55GB SSD
- 2TB 流量
- IPv4 included
- $10/月

部署难度：低。

比 DigitalOcean 便宜一点，体验也直接。如果只是要一台 VPS 跑 Docker，Vultr 很合适。

---

### Hetzner

推荐方案：

- CX23
- 2 vCPU / 4GB RAM / 40GB SSD
- 20TB 流量
- IPv4 约 €0.50/月
- 总计约 €4.49/月

这是价格/性能最强的选项。

注意事项：

- 账号审核可能比较烦
- 亚洲访问延迟可能不如 Singapore 区域
- 支持和产品体验不如 AWS / DigitalOcean 直观
- 如果 WhatsApp / 管理后台主要给马来西亚或新加坡用户使用，延迟要实测

如果追求最低成本，选 Hetzner。

---

### Akamai / Linode

推荐方案：

- 1 vCPU / 2GB RAM / 50GB SSD
- 2TB 流量
- $12/月

部署难度：低。

和 DigitalOcean 类似，稳定性不错，但没有明显价格优势。

---

### OVH

推荐方案：

- d2-2：1 vCPU / 2GB / 25GB，约 $9/月
- d2-4：2 vCPU / 4GB / 50GB，约 $18/月

优点是流量政策通常比较友好。

缺点是控制台和运维体验没有 DigitalOcean / Vultr 顺滑。

---

### Oracle Cloud Always Free

理论成本最低：$0/月。

但不建议直接作为生产首选，原因：

1. ARM 实例经常有容量限制
2. 当前 GitHub Actions 构建没有明确指定 multi-arch
3. ARM 部署要改镜像构建、实例架构，排查成本更高
4. 免费资源稳定性和可获得性不可控

适合折腾，不适合作为省心生产环境。

---

## 部署难度排序

从简单到复杂：

1. **DigitalOcean / Vultr / Linode**
   - 创建 VPS，SSH，Docker Compose
   - 最适合当前项目的简单部署

2. **AWS Lightsail**
   - 也简单，但仍在 AWS 生态
   - 适合想留在 AWS 但不想维护完整 EC2 复杂度

3. **Hetzner / OVH**
   - 价格强，但账号、区域、控制台体验略差

4. **AWS EC2**
   - 当前项目已有 CloudFormation / SSM / IAM / GitHub OIDC
   - 专业但复杂
   - 小项目成本偏高

5. **Oracle Free**
   - 便宜但最折腾

---

## 推荐决策

### 如果目标是省钱

选 **Hetzner CX23**。

大概 $5/月级别，而且 4GB RAM 对 Chromium 很舒服。

### 如果目标是省心

选 **DigitalOcean 2GB Droplet** 或 **Vultr 2GB**。

大概 $10-12/月，部署最直接。

### 如果目标是继续 AWS

不要长期用 EC2 t3.micro。建议二选一：

1. **AWS Lightsail 2GB：$12/月**
   - 更适合这个项目
   - 简单、成本固定

2. **AWS EC2 t3.small：约 $25/月**
   - 保留当前 SSM / IAM / CloudFormation 工作流
   - 但贵一倍左右

---

## 最终建议

生产省心方案：**DigitalOcean 2GB / Vultr 2GB**

最低成本方案：**Hetzner CX23**

继续 AWS 方案：**优先 Lightsail 2GB，其次 EC2 t3.small**
