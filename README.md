# 飞书 QuickSight 报表中心

在飞书网页、桌面端或手机端打开报表应用，经企业身份系统登录后，查看**当前登录身份对应的 QuickSight 用户有权限访问的仪表盘**。

本仓库提供应用源码、AWS 部署模板生成器、测试和操作说明。Cognito 是主线示例；已有“飞书 SSO → Keycloak”的企业可以接入现有 Keycloak。不是把 QuickSight 整个管理界面放进飞书。

> **给 AI Agent 的部署提示词**（复制以下整段，并把本仓库提供给 Agent）：
>
> 请阅读本仓库 README、AGENTS.md、config/example.json 和 docs/DEPLOYMENT.md，协助我部署飞书 QuickSight 报表中心。先检查依赖和配置，整理缺少的信息，再开始实施。按“创建空的飞书企业自建应用 → 在我的 AWS 账户部署应用并取得 HTTPS 地址 → 配置 Cognito/Keycloak 登录回调和已验证邮箱的自动关联规则 → 配置飞书入口与登录回调 → 先向测试人员发布 → 验收后扩大飞书可用范围”的顺序操作。使用我的 AWS 账户、区域、用户池、客户端和报表用户；不要使用示例标识或通过未验证邮箱猜测用户身份。不要读取或输出密码、App Secret、会话 Cookie、OIDC token、首次登记令牌和报表嵌入链接；指导我将秘密放入本地忽略文件和 Secrets Manager。先列出将创建的资源，展示 CloudFormation change set，由我确认实际部署。不要改变 QuickSight 计费套餐、开启报表互联网公开访问，或让多人共用管理员的 QuickSight 身份。完成后核对两个回调地址、两名用户的权限隔离、连续打开两张报表及飞书多端体验；明确区分实际验证、自动化模拟验证和待验证项。我的环境如果不满足支持范围，请说明缺口，不要声称部署成功。

## 先看当前支持范围

| 能力 | 状态 |
|---|---|
| 飞书企业内多用户进入 | 支持 `feishuAccessMode: "tenant"`；先登记一名管理员以固定允许的飞书企业 |
| 每人看到自己的报表 | 默认按已验证邮箱精确查找唯一 QuickSight 用户，首次登录自动保存独立关联 |
| 飞书测试范围 | 由飞书发布时的可用范围控制；建议先选两名测试人员 |
| Cognito / Keycloak | 支持 OIDC 授权码 + PKCE S256；默认使用无 secret 的专用 public client |
| 自动创建 QuickSight 用户 / 自动同步全企业 | **未实现**；员工仍需已有 QuickSight 用户。符合邮箱规则的员工无需逐人配置 |
| 匿名嵌入、公开共享、共享报表管理界面 | **未实现**；本仓库不切换计费、不公开报表 |
| 跨 AWS 账户部署 | 此部署入口仅支持应用与 QuickSight 位于同一商业 AWS 账户、同一区域 |

**管理员配置一次自动关联规则后，符合条件的员工首次登录即可自动保存关联，无需逐人改配置或重新部署。**条件是身份系统返回已验证邮箱，且指定 QuickSight namespace 中有唯一、有效的同邮箱用户。缺少用户、邮箱未验证、重复邮箱或关联冲突时会拒绝访问并显示具体原因。系统不会自动创建 QuickSight 用户，也不会把员工关联到其他人的既有身份。

### 验证状态

原应用的 Cognito 登录及注册用户报表嵌入曾完成真实环境验证。本仓库是移除个人配置后整理的交付版本，多用户隔离、首次登录自动关联、重复登录复用、邮箱变化与身份冲突已有自动化测试。**本次没有在第二个全新 AWS 账户实际部署，也没有用两名真实员工完成联调；Keycloak、飞书手机 WebView 仍需按验收清单验证。**

## 从哪里开始

完整逐步操作见 [部署指南](docs/DEPLOYMENT.md)。请按以下顺序执行，不能跳过第一步：

1. **创建空的飞书应用**：取得 App ID 和 App Secret，先不用填应用首页地址。
2. **部署报表中心**：将代码部署到 AWS，得到应用访问地址。
3. **配置身份系统和自动关联规则**：为应用登记登录回调，配置已验证邮箱到 QuickSight 用户的自动关联规则。
4. **配置飞书入口**：填入应用首页和飞书登录回调，发布给测试人员。
5. **登记允许的飞书企业并验收**：管理员完成首次登记，两名测试人员验证各自权限；通过后再扩大发布范围。

## 应用访问地址是什么

它是部署完成后打开“报表中心”网页的网址，由 API Gateway 提供。例如 `https://reports.example.com` 只是说明格式，不是本项目预先提供的服务。无需在第一步猜测这个地址。

| 地址 | 填写位置 |
|---|---|
| `应用地址/` | 飞书网页应用的桌面端、移动端首页 |
| `应用地址/auth/callback` | 飞书应用的重定向 URL / 登录回调 |
| `应用地址/auth/report/callback` | Cognito 或 Keycloak 专用客户端的登录回调 |

同一个 CloudFormation stack 更新代码时不会主动替换 API Gateway，通常保持地址不变；删除重建 stack 或更换域名时必须重新核对回调。不要把首次登记链接当作普通首页。

## 项目结构

- `public/`：登录、报表目录、个人中心、嵌入查看界面。
- `server.mjs`：飞书登录、企业准入、持久会话。
- `report-*.mjs`、`access-policy.mjs`、`automatic-identity.mjs`：OIDC 核验、自动关联、逐用户绑定、报表授权。
- `config/example.json`：不含个人配置的示例。
- `scripts/`：配置校验、打包、部署、输出与身份预检。
- `infra/iam-baseline.json`：从运行时代码生成的 IAM 基线，构建时收敛到指定资源。
- `test/`：身份、权限隔离和桌面/手机布局测试。

## 本地检查

需要 Node.js 22.12+、npm；部署另需 AWS SAM CLI、Python 环境及可用的 AWS 凭据。

```bash
npm ci
npm run check
npm test
npx playwright install chromium
npm run test:ui
```

已有本机 Chrome 时可以通过 `CHROME_PATH` 指定浏览器可执行文件。UI 测试使用模拟 API，不会登录企业账号或读取真实报表。

## 参考资料

- [Amazon Quick 飞书 SSO 对接指南](https://aws.amazon.com/cn/blogs/china/amazon-quick-sso-integration-guide/)：参考飞书与 Keycloak 的身份桥接；其 Quick Desktop 的 localhost 回调不能照搬到本应用。
- [注册用户嵌入 API](https://docs.aws.amazon.com/quicksight/latest/APIReference/API_GenerateEmbedUrlForRegisteredUser.html)
- [Amazon Cognito 应用客户端](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-client-apps.html)
- [AWS SAM CLI 安装](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
