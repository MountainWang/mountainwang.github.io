## 2026 AI GPU 云服务商价格总览（按单 GPU 折算）

| 厂商 | H100 ($/GPU/hr) | H200 ($/GPU/hr) | B200 ($/GPU/hr) | A100 80G ($/GPU/hr) | InfiniBand/RDMA | Spot实例 | K8S托管 | 主要客户 | 备注 |
|--------|--------:|--------:|--------:|--------:|--------|--------|--------|--------|--------|
| AWS | 6–9 | 5–7 | 企业预留 | 3–5 | ✓ | ✓ | EKS | Anthropic、Scale AI、NVIDIA | 企业生态最强 |
| Azure | 6–9 | 5–7 | 企业预留 | 3–5 | ✓ | ✓ | AKS | OpenAI、xAI、Meta | OpenAI生态优势 |
| GCP | 6–8 | 5–7 | 部分开放 | 2.5–4 | ✓ | ✓ | GKE | Character.AI、Midjourney | TPU生态完善 |
| OCI | 4–6 | 4–6 | 少量供应 | 2–3 | ✓ | ✓ | OKE | Cohere、MosaicML | 性价比较高 |
| CoreWeave | 6.16 | 6.31 | 8.60 | 2.70 | ✓ | 部分 | 原生K8S | OpenAI、Microsoft、Mistral | AI专用云 |
| Lambda Labs | 3–4 | 需申请 | 6–7 | 1.8–2.5 | ✓ | × | 原生K8S | AI初创公司、高校 | 容量较紧张 |
| Crusoe Cloud | 1.6–2.5 | 暂无公开 | 暂无公开 | 暂无公开 | ✓ | 部分 | 原生K8S | Oracle、AI训练客户 | 训练场景优势 |
| RunPod | 2.89–3.29 | 4.39 | 5.89 | 1.39–1.49 | 部分 | ✓ | 原生K8S | 开发者、开源社区 | 开发者友好 |

### 分类说明

| 类型 | 厂商 |
|--------|--------|
| Hyperscaler | AWS、Azure、GCP、OCI |
| NeoCloud | CoreWeave、Lambda Labs、Crusoe |

### H100 成本排名（低 → 高）

| 排名 | 厂商 | H100 ($/GPU/hr) |
|--------|--------|--------:|
| 1 | Crusoe Cloud | 1.6–2.5 |
| 3 | RunPod | 2.89–3.29 |
| 4 | Lambda Labs | 3–4 |
| 5 | OCI | 4–6 |
| 6 | CoreWeave | 6.16 |
| 7 | GCP | 6–8 |
| 8 | Azure | 6–9 |
| 9 | AWS | 6–9 |
