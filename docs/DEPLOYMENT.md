# 从空飞书应用开始部署

本指南面向负责实施的工程师。普通员工使用应用，不需要执行这些步骤。

## 准备条件

| 准备什么 | 用途 |
|---|---|
| AWS 部署身份及目标账户、区域 | 创建 API Gateway、Lambda、DynamoDB、IAM 角色、日志资源及 SAM 制品桶 |
| 同账户同区域的 QuickSight Enterprise 环境 | 提供已发布仪表盘；每位测试人员有自己的 QuickSight 用户及授权 |
| 现有 Cognito 用户池，或已对接企业身份源的 Keycloak Realm | 验证登录身份；本项目不创建用户池、Keycloak 或企业目录 |
| 飞书自建应用开发权限及发布审核人 | 创建应用和发布测试版本 |
| Node.js 22.12+、npm、Git、AWS SAM CLI | 安装、打包和部署 |

AWS 资源和 Secrets Manager 会产生费用。本项目不替你购买 QuickSight 容量套餐。部署身份需要相应 CloudFormation、制品桶、IAM、Lambda、API Gateway、DynamoDB、CloudWatch Logs 权限，以及解析指定 Secrets Manager secret 的权限；客户应按自身权限流程授权。应用的运行角色由模板单独创建，不继承部署身份权限。

## 步骤 1：创建空的飞书企业自建应用

1. 打开飞书开放平台 `https://open.feishu.cn`，选择目标企业。
2. 进入开发者后台 → 创建企业自建应用，填写名称，例如“报表中心”。
3. 在“凭证与基础信息”中取得 **App ID**；App Secret 只在受控本地位置使用，不发给 Agent 或贴进文档。
4. 添加网页应用能力。应用首页、登录回调待步骤 2 获得地址后再填写；此时不用全员发布。
5. 记录发布审核人。后续先将可用范围限制在两名测试人员。

**完成标志：**目标企业中已有一个自建应用，并取得其凭证。

## 步骤 2：获取代码、准备秘密并首次部署

### 2.1 下载代码

```bash
git clone https://github.com/wanglingxiao123/feishu-quicksight-portal.git
cd feishu-quicksight-portal
npm ci
cp config/example.json config.local.json
npm run secrets:generate
```

私有仓库需要先获得仓库访问权限。不要用未知第三方的 AWS 凭据。生成脚本只在本地创建权限为 0600 的 `runtime-secret.local.json`，不会把值打印出来，也不会覆盖已有文件。

### 2.2 将秘密保存到 Secrets Manager

1. 在本地编辑 `runtime-secret.local.json`，把 `FEISHU_APP_SECRET` 的占位内容换成步骤 1 的真实值；保留生成的 `SESSION_SECRET` 和 `ENROLLMENT_TOKEN`。
2. AWS 控制台 → Secrets Manager → 存储新密钥 → 其他类型的密钥 → 纯文本。
3. 由你本人将该文件的完整 JSON 存入密钥，三个键名保持不变。使用目标部署区域，首次可使用该服务的默认加密密钥。
4. 保存后复制 **密钥 ARN**，填入 `config.local.json` 的 `runtimeSecretArn`。

Agent 不需要检索密钥值。CloudFormation 用动态引用将秘密注入 Lambda；不得把秘密值写进配置模板、GitHub、日志或部署参数。更新 secret 本身不会保证现有 Lambda 环境立即更新；轮换时需规划函数配置更新，并注意 SESSION_SECRET 变化会使旧会话失效。

### 2.3 填写非秘密配置

编辑 `config.local.json`：

| 字段 | 哪里获得 / 怎样填写 |
|---|---|
| `stackName` | 自定义资源栈名，例如 `feishu-report-portal`；后续更新继续使用同名 |
| `awsAccountId`、`region` | 部署目标 AWS 账户 ID 和区域；必须与 QuickSight 相同 |
| `feishuAppId` | 步骤 1 的 App ID |
| `runtimeSecretArn` | 步骤 2.2 创建的密钥 ARN |
| `accountLabel` | 员工在账户选择框中看到的名称，如“集团报表” |
| `feishuAccessMode` | `tenant`：允许已登记企业的员工；`tester`：仅首次登记人员 |
| `oidc.provider` | `cognito` 或 `keycloak` |
| `oidc.issuer` | 身份系统的完整 issuer，不带末尾 `/` |
| `oidc.userPoolId` | Cognito → 用户池 → 概述中的 ID；Keycloak 无需此项 |
| `oidc.authorizationOrigin` | Cognito → 品牌 → 域中的 HTTPS 域名；不是 issuer；Keycloak 无需此项 |
| `oidc.clientId` | **首次部署留空**，步骤 3 创建客户端后填写 |
| `oidc.ready` | **首次部署为 false**，回调配置好后再改为 true |
| `identityMappings` | 每人的登录名及其 QuickSight UserArn，详见步骤 3.3 |

Cognito issuer 格式：`https://cognito-idp.REGION.amazonaws.com/USER_POOL_ID`。
Keycloak issuer 格式：`https://sso.example.com/realms/REALM`。

示例值不能部署，脚本会拒绝。首次部署允许登录客户端暂未就绪，从而先取得真实回调地址；应用不会因此绕过报表登录。

### 2.4 打包、检查并部署

先在本机完成组织允许的 AWS 登录，确保目标 profile 可用。将下方 `your-profile` 换成自己的 profile 名。

```bash
npm run package
npm run deploy -- --profile your-profile
npm run outputs -- --profile your-profile
```

`package` 只复制运行时文件并安装生产依赖；不会上传 `.env`、本地秘密、测试记录或 Git 历史。
`deploy` 会先确认 STS 返回的 AWS 账户与配置一致，再用 SAM 做模板检查和部署；**检查 change set 后确认创建资源**。它不会创建 Cognito/Keycloak 客户端，也不会修改 QuickSight 订阅。

记录输出：`ApplicationUrl`、`FeishuCallback`、`ReportCallback`。这就是应用地址和两个回调，不要填写字面量“ApplicationUrl”。

**完成标志：**CloudFormation 栈创建成功；打开 `ApplicationUrl/healthz` 返回正常状态，首页可打开，但报表登录尚未启用。

## 步骤 3：配置登录系统和每人的报表身份

### 3.1 Cognito 示例

1. AWS 控制台 → Cognito → 正确区域 → 目标用户池。
2. 品牌 → 域：确认已有可用的 Cognito 登录域名。本示例支持该服务的 hosted domain；不使用自定义域名。
3. 应用程序 → 应用程序客户端 → 创建专用客户端，选择不生成 client secret 的 public client。
4. 启用授权码流程，允许 `openid`、`profile`、`email`；应用使用 PKCE S256。
5. 登录成功的允许回调 URL：填写步骤 2 输出的 **ReportCallback**。
6. 保存 Client ID，填入 `config.local.json` 的 `oidc.clientId`。

现有用户池可能需要管理员配置登录页面、允许的身份源和测试用户状态。不要覆盖其他应用已有的回调地址。本仓库按 Cognito 的 `cognito:username` 匹配用户，不按飞书姓名猜测。

### 3.2 已有 Keycloak 时

1. 登录管理后台，进入业务 Realm，不要直接使用 `master`。
2. Clients → 创建专用 OpenID Connect 客户端；启用 Standard flow，关闭 Client authentication，PKCE 使用 S256。
3. Valid redirect URIs 填写 **ReportCallback**；使用精确 HTTPS 地址，禁止 `*`。
4. 确保 token 中有 `sub` 和用于映射的 `preferred_username`，或已验证的 `email`；提供 `openid profile email` scopes。
5. 如果 Realm 已通过 Identity Provider 对接飞书，可复用该认证来源，但必须为本报表应用新建专用客户端。
6. 填写 Keycloak issuer 和 Client ID，并将 `oidc.provider` 改为 `keycloak`。

Quick Desktop 示例中的 `http://localhost:18080` 是桌面客户端回调，**不能填到本应用**。Keycloak identity broker 从飞书返回的回调也不是本应用的 ReportCallback。

### 3.3 配置每个用户的映射

由 QuickSight 管理员提供每位用户的 **UserArn**，确认该用户 Active 且已被分享对应仪表盘。ARN 包含 namespace 和用户名，不能用账户名称替代；可通过已授权的 `DescribeUser` / `ListUsers` API 查询。Agent 只读取身份标识，不需要用户密码。

```json
"identityMappings": [
  {
    "id": "employee-001",
    "login": "alice",
    "quickSightUserArn": "arn:aws:quicksight:us-east-1:123456789012:user/default/alice",
    "enabled": true
  },
  {
    "id": "employee-002",
    "login": "bob",
    "quickSightUserArn": "arn:aws:quicksight:us-east-1:123456789012:user/default/bob",
    "enabled": true
  }
]
```

以上标识全部是示例。`id` 是稳定唯一的配置键；`login` 为 Cognito 用户名，或 Keycloak 返回的用户名/已验证邮箱。需要更严格预绑定时，加入 `subject`，填写可信身份系统实际的用户 `sub`。

首次成功登录会把已经验证的 `issuer + sub` 与这条映射固定存入 DynamoDB；同名但不同 `sub` 的身份不能覆盖绑定。不要把多个员工映射到管理员 UserArn。删除/禁用映射会阻止下一次应用 API 授权，已兑换的 QuickSight iframe 会话可能持续到自身到期。

将 `oidc.ready` 改为 `true`，重新打包并部署：

```bash
npm run package
npm run verify:identity -- --profile your-profile
npm run deploy -- --profile your-profile
```

回调预检不会登录真实用户，不能代替最终验收。如果 IdP 的自定义页面不满足预检行为，先定位差异，不要直接关闭校验。

### 3.4 QuickSight 嵌入域名

QuickSight → 管理账户 → 管理域 / 嵌入域名，登记 **ApplicationUrl 的 HTTPS 来源**（不带回调路径）。代码同时在生成嵌入链接时传入该来源，IAM 条件也将其限制到此域名。不要开启“互联网任何人公开访问”。

## 步骤 4：填写飞书应用入口并发布测试版本

1. 返回步骤 1 的飞书自建应用。
2. 网页应用：桌面端和移动端首页都填写 **ApplicationUrl**。
3. 安全设置 / 重定向 URL：添加 **FeishuCallback**，不能填写 Cognito 的 ReportCallback。
4. 按控制台要求启用用户身份获取能力，确认用户授权能返回 `open_id`、`tenant_key` 和姓名；不同租户的审批要求以实际页面为准。不为此申请全量通讯录权限。
5. 版本管理与发布 → 创建版本 → 可用范围先选择两名测试人员 → 提交企业要求的审批并发布。

**完成标志：**两名测试人员都能在飞书找到应用，打开首页；其他企业的账号不能通过后端企业检查。

## 步骤 5：登记企业并完成验收

### 5.1 管理员首次登记

由指定管理员在受控环境取得 `ENROLLMENT_TOKEN`，在自己的浏览器打开：

```text
ApplicationUrl/auth/enroll/ENROLLMENT_TOKEN
```

把两处占位符替换为实际值。不要把完整链接贴进公共文档、日志、截图或群聊。此链接只用于首次登记：首次完成飞书授权后，DynamoDB 固定允许的飞书 tenantKey；以后该链接不再可用，普通员工直接打开首页。

`tenant` 模式允许同一飞书企业的员工进入；`tester` 模式只允许登记者。无论哪种模式，报表访问都还必须通过 OIDC 身份及映射检查。登记后后台不会自动改变飞书的应用可用范围。

### 5.2 测试清单

- 管理员打开首页，选择账户并登录，连续打开两张已授权仪表盘。
- 第二名测试人员通过自己的飞书和 OIDC 身份登录，个人中心显示自己的 QuickSight 用户。
- 两人的私有报表目录正确；尝试直接访问对方的仪表盘 ID，后端拒绝。
- 未配置映射的用户显示“联系管理员”，不能看到别人的目录。
- 切换账号后旧 iframe 被清除，不把外部 Chrome 的 QuickSight 登录状态当作本应用身份。
- 分别在飞书网页、桌面端、手机端测试。桌面 Chrome 成功不等于手机 WebView 已通过。
- 应用会话默认 8 小时、报表身份 1 小时、嵌入会话 60 分钟；当前没有自动刷新 OIDC 登录的功能。

通过后，再按组织流程扩大飞书可用范围。**已配置身份映射的员工无需改代码；新增映射需更新配置、打包部署。**如需自动同步企业目录或管理界面，应另行开发。

## 更新、回滚与卸载

- 保留 stackName、region、account、应用客户端和 API 资源；代码变更使用同一部署命令更新。
- 更新前保留当前 Git tag 和安全保存的 `config.local.json`。回滚时检出对应版本，使用匹配配置重新打包、审核 change set 后更新。
- 不要为了修回调删除整个 stack。删除重建可能更换应用地址，使回调失效。
- DynamoDB 和日志默认 Retain；删除 stack 不会自动删除它们，避免丢失授权绑定，但保留资源仍可能计费。SAM 制品桶和 Secrets Manager secret 也需单独按组织流程清理。
- 改变映射 id、issuer 或用户 sub 前，先规划身份重新绑定。不要直接把已有用户绑定改成另一个人。

## 常见问题

| 现象 | 排查方式 |
|---|---|
| IAM、资源或 secret AccessDenied | 区分部署身份权限和 Lambda 运行角色；核对账户、区域、secret ARN |
| 首次打包被拒绝 | 检查 REPLACE_ME、示例账户、跨账户 UserArn、缺少 Client ID 却设 ready=true |
| Cognito 回调失败 | 核对 ReportCallback 完整地址、客户端、授权码流程和 scopes |
| Keycloak client not found | 核对业务 Realm 和专用客户端 ID |
| 能进飞书应用但无报表权限 | 核对 identityMappings、OIDC 用户声明、QuickSight UserArn 和报表分享；发布给全员不等于获得报表权限 |
| 登录提示其他企业不可用 | 检查首次登记的企业是否正确；不要删除企业限制来绕过问题 |
| 更新后地址变化 | 是否误用了新 stackName 或重建 API；按新输出同步两个回调 |
