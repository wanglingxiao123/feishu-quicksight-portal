# 从空飞书应用开始部署

本指南面向负责实施的工程师。普通员工使用应用，不需要执行这些步骤。

## 准备条件

| 准备什么 | 用途 |
|---|---|
| AWS 部署身份及目标账户、区域 | 创建 API Gateway、Lambda、DynamoDB、IAM 角色、日志资源及 部署代码包的 S3 桶 |
| 同账户同区域的 QuickSight Enterprise 环境 | 提供已发布仪表盘；每位测试人员有自己的 QuickSight 用户及授权 |
| 现有 Cognito 用户池，或已对接企业身份源的 Keycloak Realm | 验证登录身份；本项目不创建用户池、Keycloak 或企业目录 |
| 飞书自建应用开发权限及发布审核人 | 创建应用和发布测试版本 |
| Node.js 22.12+、npm、Git、AWS CLI v2（本文登录示例使用 2.32.0+） | 安装、打包和部署 |

AWS 资源和 Secrets Manager 会产生费用。本项目不替你购买 QuickSight 容量套餐。部署身份需要相应 CloudFormation、制品桶、IAM、Lambda、API Gateway、DynamoDB、CloudWatch Logs 权限，以及解析指定 Secrets Manager secret 的权限；客户应按自身权限流程授权。应用的运行角色由模板单独创建，不继承部署身份权限。

部署权限及可复制的 JSON 见 [README：部署前，由管理员配置 AWS 权限](../README.md#部署前由管理员配置-aws-权限)。该策略授予部署身份，运行角色由模板单独创建；准备密钥、Cognito 客户端和 QuickSight 用户由对应管理员完成。

## 先完成本机 AWS 登录

按 [README：本机准备与 AWS 登录](../README.md#本机准备与-aws-登录首次部署按这里操作) 安装并检查工具，选择企业 SSO 或控制台身份登录路线，创建或复用 profile，运行身份查询，核对账户、角色及区域。本指南后续统一用 `portal-deploy`；复用公司已有 profile 时，将此名称替换为你验证通过的 profile。浏览器已登录 AWS 控制台不能代替这一步。

完成标志：README 中的身份查询成功，且管理员已为同一部署身份准备部署权限。普通员工无需执行部署或本机 AWS 登录。

## 步骤 1：创建空的飞书企业自建应用

1. 打开飞书开放平台 `https://open.feishu.cn`，选择目标企业。
2. 进入开发者后台 → 创建企业自建应用，填写名称（例如“报表中心”）、描述，并选择一个内置图标，然后点击“创建”。
3. 在“凭证与基础信息”中取得 **App ID**；App Secret 只在受控本地文件中使用，不贴进聊天或文档。
4. 添加网页应用能力。应用首页、登录回调待步骤 2 获得地址后再填写；此时显示“未完成必填项配置”是正常的，不保存空主页地址，也不创建发布版本。
5. 记录发布审核人。后续先将可用范围限制在两名测试人员。

**完成标志：**目标企业中已有一个自建应用，并取得其凭证。

## 步骤 2：获取代码、准备秘密并首次部署

### 2.1 下载代码

```bash
git clone https://github.com/wanglingxiao123/feishu-quicksight-portal.git
cd feishu-quicksight-portal
git checkout v0.3.0
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
| `autoBinding` | 一次性配置自动关联规则：启用、QuickSight namespace、允许的企业邮箱域，详见步骤 3.3 |
| `identityMappings` | 可选的人工例外配置，正常自动关联时保持空列表 |

Cognito issuer 格式：`https://cognito-idp.REGION.amazonaws.com/USER_POOL_ID`。
Keycloak issuer 格式：`https://sso.example.com/realms/REALM`。

示例值不能部署，脚本会拒绝。首次部署允许登录客户端暂未就绪，从而先取得真实回调地址；应用不会因此绕过报表登录。

### 2.4 打包、检查并部署

先完成上方“本机 AWS 登录”。以下命令使用同一 profile `portal-deploy`；若用了其他名字，统一替换。请在有 `package.json`、`config.local.json` 的工程目录执行；不要在任意目录运行。

```bash
npm run package
npm run deploy -- --profile portal-deploy
npm run outputs -- --profile portal-deploy
```

`package` 只复制运行时文件并安装生产依赖；不会上传 `.env`、本地秘密、测试记录或 Git 历史。
`deploy` 会先确认 STS 返回的 AWS 账户与配置一致，再用 AWS SDK 调用 CloudFormation；先核对资源计划，输入 `yes` 准备代码包，再检查变更集并输入 `yes` 执行。它不会创建 Cognito/Keycloak 客户端，也不会修改 QuickSight 订阅。

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

现有用户池可能需要管理员配置登录页面、允许的身份源和测试用户状态。不要覆盖其他应用已有的回调地址。默认自动关联使用登录系统返回的已验证邮箱匹配 QuickSight 用户；只有显式人工例外／历史配置才按 `cognito:username` 选择预设关联，不按飞书姓名猜测。

### 3.2 已有 Keycloak 时

1. 登录管理后台，进入业务 Realm，不要直接使用 `master`。
2. Clients → 创建专用 OpenID Connect 客户端；启用 Standard flow，关闭 Client authentication，PKCE 使用 S256。
3. Valid redirect URIs 填写 **ReportCallback**；使用精确 HTTPS 地址，禁止 `*`。
4. 默认自动关联要求 token 中有 `sub`、`email`，且 `email_verified` 为布尔值 `true`；提供 `openid profile email` scopes。仅有 `preferred_username` 不满足默认邮箱自动关联规则。
5. 如果 Realm 已通过 Identity Provider 对接飞书，可复用该认证来源，但必须为本报表应用新建专用客户端。
6. 填写 Keycloak issuer 和 Client ID，并将 `oidc.provider` 改为 `keycloak`。

Quick Desktop 示例中的 `http://localhost:18080` 是桌面客户端回调，**不能填到本应用**。Keycloak identity broker 从飞书返回的回调也不是本应用的 ReportCallback。

### 3.3 配置一次自动关联规则

默认配置：

```json
"autoBinding": {
  "enabled": true,
  "namespace": "default",
  "allowedEmailDomains": ["your-company.com"]
},
"identityMappings": []
```

把 `your-company.com` 换成企业实际邮箱域（只写域名，不带 `@`）。多个域可列在数组中；只匹配精确域，不自动包含子域。空数组代表不额外限制邮箱域，但仍限定为当前可信 IdP、已验证邮箱、已登记飞书企业和指定 QuickSight namespace；仅在身份管理员确认符合企业策略时使用。

管理员准备一次：
1. 确认 Cognito / Keycloak 是可信的企业身份来源，用户不能伪造已验证邮箱。建议关闭无约束自助注册；由企业目录或管理员管理成员。
2. 确认登录 token 可读 `email`，并且 `email_verified` 是布尔值 `true`。Cognito 用户状态 CONFIRMED 本身不等于邮箱已验证；不要为了通过测试批量伪造验证状态。
3. QuickSight 管理员确认已有用户的邮箱准确、唯一、用户有效，且被授权查看相应报表。
4. 设置 namespace 和企业邮箱域，保留 `identityMappings: []`。

员工第一次登录时：应用核验 OIDC token → 读取验证邮箱 → 分页查询目标 namespace 的 QuickSight 用户 → 精确匹配唯一邮箱 → 以 DynamoDB 事务保存 `issuer + sub` 与 QuickSight `Arn + PrincipalId` 的关联，并锁定该 QuickSight 用户的关联归属。

以后登录复用关联，不重新遍历整个用户目录；每次受保护的报表请求检查 QuickSight 用户是否有效、邮箱与 PrincipalId 是否仍一致。邮箱变化、同邮箱多个 QuickSight 用户、用户删除重建、另一 sub 尝试占用已有用户时不会静默改绑。

**日常增加员工：在企业身份系统和 QuickSight 中正常开通账号，确保验证邮箱一致，并分享相应报表。员工首次登录即自动接入，不需要修改本项目配置或重新部署。**这不是自动创建 QuickSight 用户；没有 QuickSight 用户仍需要管理员开通。

设置 `oidc.clientId`、将 `oidc.ready` 改为 `true`，首次启用规则时重新打包部署：

```bash
npm run package
npm run verify:identity -- --profile portal-deploy
npm run deploy -- --profile portal-deploy
```

自动模式的运行权限限定在指定账户、区域和 namespace 的用户资源，并允许读取用户目录。嵌入链接仍限定应用域名；个人可见报表仍由自己的 QuickSight 用户权限决定。

**人工例外与旧配置兼容：**确需不同邮箱或历史测试身份时，可以保留显式 `identityMappings`（旧版 pilot 配置也兼容）。人工配置优先，已占用的用户不会被自动关联接管；已禁用的显式映射不会自动回退到邮箱匹配。普通员工不需要这些例外。

```json
"identityMappings": [{
  "id": "legacy-exception",
  "login": "legacy-login-name",
  "quickSightUserArn": "arn:aws:quicksight:us-east-1:123456789012:user/default/legacy-user",
  "enabled": true
}]
```

回调预检不会登录真实用户，不能代替最终验收。如果 IdP 的自定义页面不满足预检行为，先定位差异，不要直接关闭校验。

### 3.4 QuickSight 嵌入域名

QuickSight → 管理账户 → 管理域 / 嵌入域名，登记 **ApplicationUrl 的 HTTPS 来源**（不带回调路径）。代码同时在生成嵌入链接时传入该来源，IAM 条件也将其限制到此域名。不要开启“互联网任何人公开访问”。

## 步骤 4：填写飞书应用入口并发布测试版本

1. 返回步骤 1 的飞书自建应用。
2. 网页应用：桌面端和移动端首页都填写 **ApplicationUrl**。在打开方式配置中选择“在飞书内新标签页打开”，再保存；漏选打开方式会提示必填错误。
3. 安全设置 / 重定向 URL：输入 **FeishuCallback** 后点击“添加”，确认地址出现在列表中；不能填写 Cognito 的 ReportCallback。
4. 本轮基础登录授权页显示“获取用户身份标识”，无需开通额外通讯录权限即可取得入口所需身份。目标企业如另有审批要求，按实际授权页处理。
5. 版本管理与发布 → 创建版本 → 可用范围先保留本人完成首轮测试，之后添加第二名测试人员。保存版本、复核范围，再确认发布；显示免审时可直接发布，需要审核时等待通过。不要选全员。

**完成标志：**页面显示“已发布”，可用范围仍为选定成员。随后完成首次登记和实际登录测试；发布成功不代表报表验收完成。

## 步骤 5：登记企业并完成验收

### 5.1 管理员首次登记

由指定管理员在受控环境取得 `ENROLLMENT_TOKEN`，在自己的浏览器打开：

```text
ApplicationUrl/auth/enroll/ENROLLMENT_TOKEN
```

把两处占位符替换为实际值。不要把完整链接贴进公共文档、日志、截图或群聊。此链接只用于首次登记：首次完成飞书授权后，DynamoDB 固定允许的飞书 tenantKey；以后该链接不再可用，普通员工直接打开首页。

`tenant` 模式允许同一飞书企业的员工进入；`tester` 模式只允许登记者。无论哪种模式，报表访问都还必须通过 OIDC 核验与自动关联/既有关联检查。登记后后台不会自动改变飞书的应用可用范围。

### 5.2 测试清单

- 管理员打开首页，选择账户并登录，连续打开两张已授权仪表盘。
- 第二名测试人员通过自己的飞书和 OIDC 身份登录，个人中心显示自己的 QuickSight 用户。
- 两人的私有报表目录正确；尝试直接访问对方的仪表盘 ID，后端拒绝。
- 新增一个符合规则的员工：不改项目配置即可首次登录、自动保存关联；重复登录仍是同一用户。
- 未验证邮箱、QuickSight 用户不存在、重复邮箱、其他 sub 争用已关联用户时被拒绝，不能看到他人的目录。
- 切换账号后旧 iframe 被清除，不把外部 Chrome 的 QuickSight 登录状态当作本应用身份。
- 分别在飞书网页、桌面端、手机端测试。桌面 Chrome 成功不等于手机 WebView 已通过。
- 应用会话默认 8 小时、报表身份 1 小时、嵌入会话 60 分钟；当前没有自动刷新 OIDC 登录的功能。

通过后，再按组织流程扩大飞书可用范围。**符合自动关联规则的新增员工无需改代码、配置或重新部署。**修改全局规则/人工例外需部署；自动创建 QuickSight 用户、企业目录同步或授权管理界面仍不包含。

## 更新、回滚与卸载

- 保留 stackName、region、account、应用客户端和 API 资源；代码变更使用同一部署命令更新。
- 更新前保留当前 Git tag 和安全保存的 `config.local.json`。回滚时检出对应版本，使用匹配配置重新打包、审核 change set 后更新。
- 不要为了修回调删除整个 stack。删除重建可能更换应用地址，使回调失效。
- DynamoDB 和日志默认 Retain；删除 stack 不会自动删除它们，避免丢失授权绑定，但保留资源仍可能计费。部署代码包的 S3 桶和 Secrets Manager secret 也需单独按组织流程清理。
- 改变邮箱、issuer、sub、namespace、允许邮箱域或 QuickSight 用户 PrincipalId 前，先规划身份重新绑定。自动关联和反向归属锁没有 TTL，不会随登录会话过期而消失；停用用户应由管理员将对应身份记录 `enabled` 设为 false，并在 QuickSight 侧执行相应停用。改绑必须核实两边真实身份，处理两条记录的一致性，不要仅删其中一条锁，也不要清空整张会话表。已兑换的嵌入会话仍可能持续到期。

## 常见问题

| 现象 | 排查方式 |
|---|---|
| IAM、资源或 secret AccessDenied | 区分部署身份权限和 Lambda 运行角色；核对账户、区域、secret ARN |
| 首次打包被拒绝 | 检查 REPLACE_ME、示例账户、跨账户 UserArn、缺少 Client ID 却设 ready=true |
| Cognito 回调失败 | 核对 ReportCallback 完整地址、客户端、授权码流程和 scopes |
| Keycloak client not found | 核对业务 Realm 和专用客户端 ID |
| 能进飞书应用但无报表权限 | 核对验证邮箱、namespace、唯一 QuickSight 用户、既有关联和报表分享；发布给全员不等于获得报表权限 |
| 登录提示其他企业不可用 | 检查首次登记的企业是否正确；不要删除企业限制来绕过问题 |
| 更新后地址变化 | 是否误用了新 stackName 或重建 API；按新输出同步两个回调 |
