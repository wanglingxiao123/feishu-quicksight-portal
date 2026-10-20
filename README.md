# 飞书 QuickSight 报表中心

在飞书中登录企业报表账号，查看本人有权限的 QuickSight 仪表盘。**管理员部署一次，员工直接使用，无需安装或部署。**

> **让 AI 协助部署**：把本仓库和下面这段提示词交给 Agent。
>
> 请先阅读 README、AGENTS.md 和 docs/DEPLOYMENT.md，按本文五步协助部署。先确认管理员授权、AWS 账户与区域、本机登录、现有身份系统和测试报表，再执行操作。使用我的真实配置，不照抄示例标识；密钥只保存在受控本地文件和 Secrets Manager，不输出到聊天或日志。首次部署保持 oidc.ready=false，取得回调后再配置登录。执行部署前让我核对资源计划和 CloudFormation 变更集。先发布给指定测试人员，验证各自身份、报表权限和多端体验；明确记录未完成的检查。

## 从哪里开始

**第一次部署：先完成下面的权限与本机登录准备，再按步骤 1—5 操作。** 修改应用代码、运行测试不是首次部署的前置步骤。

需要已有的业务系统；本项目不会替你创建它们：

| 准备项 | 谁来提供 |
|---|---|
| 目标 AWS 账户、QuickSight 所在区域、部署身份及权限 | AWS 管理员 |
| 已有 QuickSight Enterprise 环境、两名用户及各自的测试报表授权 | QuickSight 管理员 |
| 已有 Cognito 用户池和登录域名，或企业 Keycloak；测试用户的已验证邮箱与 QuickSight 一致 | 身份管理员 |
| 企业自建应用的创建、配置及发布权限 | 飞书管理员 |

本文以 Cognito 为例；应用与 QuickSight 位于同一 AWS 商业账户、同一区域。Keycloak 使用[对应配置分支](docs/DEPLOYMENT.md#22-已有-keycloak-时)。匿名访问及自动创建 QuickSight 用户未实现。

## 部署前：由管理员配置 AWS 权限

**AWS 管理员先操作：** 按[部署权限说明](docs/IAM-SETUP.md)准备部署角色／权限集，并把目标账户 ID、区域、角色名称及登录方式交给部署人员。权限 JSON 在该页面的展开块中。

**完成标志：** 部署人员知道要登录哪个账户、使用哪个已授权身份。

## 本机准备与 AWS 登录：首次部署按这里操作

**部署人员操作：** 按[工具安装与 AWS 登录指南](docs/AWS-LOGIN.md)安装 Node.js 22.12+、npm、Git、AWS CLI v2，并选择企业规定的登录路线。无需 SAM CLI。

在电脑终端查看已有的登录配置名称（profile）：

```bash
aws configure list-profiles
```

每行是一个名称；没有输出时先完成登录配置。下面以 `portal-deploy` 为例，**请换成自己实际使用的名称**：

```bash
aws sts get-caller-identity --profile portal-deploy
aws configure get region --profile portal-deploy
```

**完成标志：**`Account` 是目标 AWS 账户，`Arn` 是管理员授权的部署身份，区域与 QuickSight 一致。后续命令统一使用这个 profile；浏览器登录控制台不能代替本机登录。

## 步骤 1｜创建空飞书应用，部署报表中心

1. 飞书开发者后台 → 创建企业自建应用 → 添加网页应用能力，取得 App ID 和 App Secret。主页地址先留空，不发布。[操作详情](docs/DEPLOYMENT.md#11-创建空飞书应用)
2. 在电脑终端进入准备存放项目的文件夹，逐条执行：

```bash
git clone https://github.com/wanglingxiao123/feishu-quicksight-portal.git
cd feishu-quicksight-portal
git checkout v0.3.0
npm ci
cp config/example.json config.local.json
npm run secrets:generate
```

3. 按[密钥保存步骤](docs/DEPLOYMENT.md#13-将密钥保存到-secrets-manager)填写 `runtime-secret.local.json` 并存入 Secrets Manager；按[配置表](docs/DEPLOYMENT.md#14-填写应用配置)填写 `config.local.json`。首次部署保持 `oidc.clientId` 为空、`oidc.ready=false`。
4. 在项目文件夹执行以下命令，按提示核对资源计划及变更集后确认部署：

```bash
npm run package
npm run deploy -- --profile portal-deploy
npm run outputs -- --profile portal-deploy
```

**完成标志：** 资源栈为 `CREATE_COMPLETE`，应用首页能打开。保存下面三个真实输出地址；此时尚未启用报表登录。

| 输出名称 | 后续填在哪里 |
|---|---|
| `ApplicationUrl` | 飞书网页应用的桌面端、移动端主页 |
| `ReportCallback` | Cognito／Keycloak 客户端的登录回调 |
| `FeishuCallback` | 飞书应用的重定向 URL |

## 步骤 2｜配置登录系统

身份管理员在已有 Cognito 用户池中新建专用客户端：无客户端密钥，授权码流程，范围为 `openid`、`profile`、`email`，回调填 `ReportCallback`。将创建后取得的 Client ID 填入 `oidc.clientId`。[Cognito 逐项操作](docs/DEPLOYMENT.md#21-cognito-示例)

**完成标志：** 客户端已保存，回调与部署输出一致。`oidc.ready` 暂时保持 `false`。

## 步骤 3｜配置报表权限，启用登录

1. 管理员确认测试用户的已验证邮箱，在指定 QuickSight namespace 内只对应一个有效用户，并向该用户分享测试仪表盘。
2. 按[自动关联配置](docs/DEPLOYMENT.md#31-配置自动关联规则)填写企业邮箱域和 namespace，启用 `autoBinding`；使用自动关联时，`identityMappings` 保持 `[]`。
3. 将 `oidc.ready` 改为 `true`，保存配置，执行：

```bash
npm run package
npm run verify:identity -- --profile portal-deploy
npm run deploy -- --profile portal-deploy
```

**完成标志：** 预检通过，资源栈为 `UPDATE_COMPLETE`。继续使用同一资源栈和三个输出地址。

## 步骤 4｜填写飞书应用入口

返回步骤 1 创建的应用：桌面端和移动端主页填 `ApplicationUrl`；打开方式选“在飞书内新标签页打开”；安全设置中的重定向 URL 填 `FeishuCallback`，点击“添加”。[操作详情](docs/DEPLOYMENT.md#步骤-4填写飞书应用入口)

**完成标志：** 主页已保存，飞书回调出现在重定向 URL 列表。

## 步骤 5｜发布给测试人员，验收后推广

1. 飞书“版本管理与发布”→ 创建版本 → 可用范围选择指定测试人员 → 完成发布审核。
2. 管理员按[首次登记步骤](docs/DEPLOYMENT.md#52-管理员首次登记)登记允许访问的飞书企业。普通员工以后直接打开应用首页，不使用登记链接。
3. 两名测试人员分别登录，核对个人中心及各自报表权限；连续打开两张报表，并在飞书网页、桌面端和手机端分别验证。[验收清单](docs/DEPLOYMENT.md#53-测试清单)

**完成标志：** 身份、报表权限和多端验收通过，再扩大飞书可用范围。符合自动关联规则的新员工无需改代码；仍需企业登录账号、QuickSight 用户及报表授权。

## 遇到问题／后续维护

- 安装或登录失败：[本机登录排错](docs/AWS-LOGIN.md#登录卡住时按现象处理)。
- 部署、回调或报表异常：[部署排错](docs/DEPLOYMENT.md#常见问题)。
- 更新与回滚：[维护步骤](docs/DEPLOYMENT.md#更新回滚与卸载)；修改代码与测试：[开发说明](docs/MAINTENANCE.md)。
- 已完成独立部署、Cognito 登录及 Chrome 连续查看报表；第二名真实用户、撤权、企业 Keycloak 和飞书多端仍需验收。详见[验证记录](docs/VALIDATION.md)及[安全说明](docs/SECURITY.md)。
