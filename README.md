# 飞书 QuickSight 报表中心

在飞书网页、桌面端或手机端打开报表应用，经企业身份系统登录后，查看**当前登录身份对应的 QuickSight 用户有权限访问的仪表盘**。

本仓库提供应用源码、AWS 部署模板生成器、测试和操作说明。Cognito 是主线示例；已有“飞书 SSO → Keycloak”的企业可以接入现有 Keycloak。不是把 QuickSight 整个管理界面放进飞书。

> **给 AI Agent 的部署提示词**（复制以下整段，并把本仓库提供给 Agent）：
>
> 请阅读本仓库 README、AGENTS.md、config/example.json 和 docs/DEPLOYMENT.md，协助我部署飞书 QuickSight 报表中心。先阅读 README 的“本机准备与 AWS 登录”并按当前企业环境选择登录路线，检查依赖、AWS profile 的账户／角色／区域和配置，整理缺少的信息，再开始实施。按“创建空的飞书企业自建应用 → 在我的 AWS 账户部署应用并取得 HTTPS 地址 → 配置 Cognito/Keycloak 登录回调和已验证邮箱的自动关联规则 → 配置飞书入口与登录回调 → 先向测试人员发布 → 验收后扩大飞书可用范围”的顺序操作。使用我的 AWS 账户、区域、用户池、客户端和报表用户；不要使用示例标识或通过未验证邮箱猜测用户身份。不要读取或输出密码、App Secret、会话 Cookie、OIDC token、首次登记令牌和报表嵌入链接；指导我将秘密放入本地忽略文件和 Secrets Manager。先列出将创建的资源，展示 CloudFormation change set，由我确认实际部署。不要改变 QuickSight 计费套餐、开启报表互联网公开访问，或让多人共用管理员的 QuickSight 身份。完成后核对两个回调地址、两名用户的权限隔离、连续打开两张报表及飞书多端体验；明确区分实际验证、自动化模拟验证和待验证项。我的环境如果不满足支持范围，请说明缺口，不要声称部署成功。

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

原应用的 Cognito 登录及注册用户报表嵌入曾完成真实环境验证。本仓库是移除个人配置后整理的交付版本，多用户隔离、首次登录自动关联、重复登录复用、邮箱变化与身份冲突已有自动化测试。**待验收：第二个全新 AWS 账户部署、两名真实员工联调、企业 Keycloak，以及飞书手机 WebView。**

## 从哪里开始

当前部署代码版本：**v0.3.0**，使用 AWS SDK；旧版 v0.2.1 的部署入口依赖 SAM CLI，不适用本次更新后的命令说明。

部署人员先完成下方[本机准备与 AWS 登录](#本机准备与-aws-登录首次部署按这里操作)和 IAM 授权，再按五步创建应用。登录不要求先下载代码；登录后也不应直接跳过配置就运行部署。

完整逐步操作见 [部署指南](docs/DEPLOYMENT.md)。请按以下顺序执行，不能跳过第一步：

1. **创建空的飞书应用**：取得 App ID 和 App Secret，先不用填应用首页地址。
2. **部署报表中心**：将代码部署到 AWS，得到应用访问地址。
3. **配置身份系统和自动关联规则**：为应用登记登录回调，配置已验证邮箱到 QuickSight 用户的自动关联规则。
4. **配置飞书入口**：填入应用首页和飞书登录回调，发布给测试人员。
5. **登记允许的飞书企业并验收**：管理员完成首次登记，两名测试人员验证各自权限；通过后再扩大发布范围。

## 本机准备与 AWS 登录：首次部署按这里操作

**本节只由部署人员执行一次；普通员工直接在飞书使用应用，不安装这些工具。**“在本机部署”指从电脑把应用发布到 AWS；应用随后在云端运行，电脑关机不影响员工访问。

浏览器能打开 AWS 控制台，不代表终端里的 Node.js 与 AWS CLI 已获得凭据。本节的完成目标是：在同一个终端中，用同一个 **profile** 验证正确的 AWS 账户和角色，并把它交给部署命令。profile 是本机保存 AWS 登录配置的名字，本文统一叫 `portal-deploy`，与 QuickSight 账户名称、飞书账号无关。

### 先拿齐这四项资料

| 向 AWS 管理员确认 | 例子／用途 |
|---|---|
| 部署目标 AWS 账户 ID | 12 位数字；后面必须与 `config.local.json` 的 `awsAccountId` 相同 |
| 应用与 QuickSight 的部署区域 | 例如 `us-east-1`，以目标 QuickSight 所在区域为准 |
| 被授权的部署角色／权限集 | 须具备下节部署策略中的权限；只读角色不能创建应用 |
| 本机登录方式 | IAM Identity Center 的 SSO；或允许 `aws login` 的控制台身份；或公司指定的本机凭据工具 |

选择 Identity Center 路线时，还需要 **SSO Start URL 和 SSO Region**。可在企业 AWS 访问门户选择目标账户／权限集旁的 “Access keys／访问密钥” → “IAM Identity Center credentials” 查看，或向管理员索取。这一步只记录 Start URL 和 Region，不复制临时密钥。**SSO Region 是 Identity Center 所在区域，可能与应用部署区域不同；Cognito issuer 和 QuickSight 登录链接都不是 SSO Start URL。**

### 1｜安装工具并确认终端能找到它们

本指南部署命令使用 macOS／Linux 的终端。macOS 打开“终端”；Linux 打开 Terminal。Windows 用户应在同一套 WSL2 Linux 环境中安装工具、下载工程、登录及部署，不混用 Windows 和 WSL 的凭据目录；原生 Windows 部署脚本尚未验收。

| 工具 | 安装入口与选择 | 安装后检查 |
|---|---|---|
| Node.js 与 npm | [Node.js 官方下载](https://nodejs.org/en/download)：选 Node.js 22 的 22.12 或更高补丁版本，安装包包含 npm | `node --version`、`npm --version` |
| Git | [Git 官方安装](https://git-scm.com/install/)：选择本机系统 | `git --version` |
| AWS CLI v2 | [AWS CLI 官方安装](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)：macOS 可下载 PKG，Linux 按实际 CPU 架构安装；本文统一要求 2.32.0 或更高版本 | `aws --version` |

安装完成后关闭并重新打开终端，逐条执行：

```bash
node --version
npm --version
git --version
aws --version
```

**完成标志：**四条命令均显示版本。`node` 至少为 `v22.12.0`，AWS CLI 显示 `aws-cli/2.…` 且不低于 2.32.0。出现 `command not found` 时先按对应安装页面处理 PATH，不继续部署。部署通过项目自带的 AWS SDK 脚本完成，不需要安装 SAM CLI、Python 或 Docker。

### 2｜选择符合企业环境的登录方式，只执行一条路线

已有公司规定的凭据工具／profile 时，继续使用它，按公司的流程刷新凭据，然后直接做第 3 节验证；部署命令中的 `portal-deploy` 全部换成该 profile 名称。不知道公司采用哪一种时，将本节四项资料清单交给 AWS 管理员确认，不要把报表登录的 Cognito 账号填进 AWS CLI。

可先列出已有 profile 名称，不会输出密钥：

```bash
aws configure list-profiles
```

如果下文示例名已被其他项目使用，请换一个新的名字，并在后续命令中一致使用，不覆盖原配置。

<details open>
<summary><strong>路线 A：公司已使用 IAM Identity Center（企业 AWS SSO）</strong></summary>

第一次在本机配置，运行：

```bash
aws configure sso --profile portal-deploy
```

按终端问题逐项填写；下表是说明，不是让你整段复制进终端：

| 终端提示 | 填什么 |
|---|---|
| `SSO session name` | 自定义会话名，例如 `portal-sso` |
| `SSO start URL` | 管理员提供的企业 AWS 访问门户地址 |
| `SSO region` | 管理员提供的 Identity Center 所在区域 |
| `SSO registration scopes` | 接受默认 `sso:account:access` |
| 浏览器授权 | 用自己的企业身份登录，核对 AWS CLI 授权请求后确认 |
| AWS account | 选择准备清单中的 12 位目标账户；只有一个选项时可能自动跳过 |
| IAM role／permission set | 选择管理员授权用于本应用部署的角色，不能选只读角色；单一选项也可能跳过 |
| `Default client Region`／`CLI default client Region` | 应用部署区域，与后续 `config.local.json` 的 `region` 一致 |
| `CLI default output format` | `json`；某些版本不询问此项 |
| Profile name（如出现） | `portal-deploy`；命令已指定名称时可能不再询问 |

完成配置后执行：

```bash
aws sso login --profile portal-deploy
```

浏览器登录／授权成功后返回终端，看到登录成功提示，再进入第 3 节验证。以后会话过期，只需再次运行 `aws sso login --profile portal-deploy`，不用每次重建 profile。

浏览器无法自动打开时，按终端提示在本机打开授权地址；跨设备授权可使用：

```bash
aws sso login --profile portal-deploy --use-device-code
```

**这条路线不需要运行 `aws login`，也不要求附加 `SignInLocalDevelopmentAccess`。**

</details>

<details>
<summary><strong>路线 B：公司允许使用现有 AWS 控制台身份进行本机登录</strong></summary>

适用于 IAM 用户或通过企业联合身份进入 AWS 控制台、且管理员允许 `aws login` 的环境。IAM Identity Center 用户走路线 A。这里使用管理员提供的部署身份，不需要新建 Access Key。

1. 管理员在该 IAM 用户／角色上授予 AWS 托管策略 `SignInLocalDevelopmentAccess`（或符合企业限制的等效权限）。这只允许本机登录，**不替代下面的资源部署策略**。
2. 运行以下命令；新 profile 提示 Region 时填写目标应用区域：

```bash
aws login --profile portal-console
```

3. 浏览器打开后选择正确 AWS 账户和部署身份，完成授权，再返回终端。只有浏览器显示控制台首页而终端仍在等待时，登录步骤尚未完成。
4. 为兼容读取临时凭据的本机工具，创建统一的 `portal-deploy` profile，由 AWS CLI 自动为工具提供临时凭据。下面第二条中的 `us-east-1` 必须换成自己的应用区域：

```bash
aws configure set credential_process "aws configure export-credentials --profile portal-console --format process" --profile portal-deploy
aws configure set region us-east-1 --profile portal-deploy
aws configure set output json --profile portal-deploy
```

第一条只是保存“由 AWS CLI 提供凭据”的配置，**不要另外单独运行里面的 `export-credentials` 子命令或把凭据输出贴进聊天／文档**。`portal-console` 保存浏览器登录，`portal-deploy` 供本项目部署使用；两个 profile 名称不能写成同一个，以免递归调用。

完成后进入第 3 节验证。以后会话过期，重新执行 `aws login --profile portal-console`，不需要重建 `portal-deploy`。浏览器不在同一设备时可使用 `aws login --profile portal-console --remote`，只在本机终端按提示填写授权码。

</details>

### 3｜验证实际 AWS 账户、角色与区域

在之后执行部署命令的同一个终端中运行：

```bash
aws sts get-caller-identity --profile portal-deploy --query '{Account:Account,Arn:Arn}' --output json --no-cli-pager
aws configure get region --profile portal-deploy
```

第一条成功时会显示类似下面的身份信息，不包含密码或访问密钥。下例均为虚构值：

```json
{
  "Account": "111122223333",
  "Arn": "arn:aws:sts::111122223333:assumed-role/PortalDeploymentRole/example-session"
}
```

逐项检查：

- `Account` 等于管理员给你的目标账户 ID，之后将同一值填入 `config.local.json` 的 `awsAccountId`。
- `Arn` 对应被授权的部署角色／用户。即使账户相同，使用了只读角色也不能部署；IAM 用户登录时 ARN 格式与上面的角色示例不同。
- 第二条显示的区域，与目标 QuickSight 区域及后续配置的 `region` 一致。SSO 的 `sso_region` 可以不同。

账户或角色错误时回到所选登录路线重新选择；**不要为了通过检查，把项目配置改成错误账户。**区域错误时用 `aws configure set region 你的实际区域 --profile portal-deploy` 修正，再检查一次。

**完成标志：**身份查询成功，账户、角色、区域均正确。此查询只证明凭据有效，不能证明所有创建权限都已具备；管理员还需完成下一节 IAM 授权。登录与 IAM 授权两项都完成后，才执行部署。

### 4｜让后续部署使用同一个 profile

按[部署指南](docs/DEPLOYMENT.md)创建飞书应用、下载工程并填写配置后，在包含 `package.json` 和 `config.local.json` 的工程目录执行：

```bash
npm run package
npm run deploy -- --profile portal-deploy
npm run outputs -- --profile portal-deploy
```

`npm run package` 只做本地打包；`deploy` 才创建／更新 AWS 资源。`--` 用于把后面的 `--profile` 传给项目脚本，不要删除。本项目会再次核对真实 AWS 账户与配置是否一致，并要求查看 CloudFormation 变更集后确认部署。资料中旧的 `your-profile` 都应替换为这次验证通过的名字。

部署后记录 `ApplicationUrl`、`ReportCallback` 和 `FeishuCallback`；它们与 profile 名称是不同的东西。以后更新应用仍使用同一账户、区域和资源栈，员工无需重复执行本节。

### 登录卡住时，按现象处理

| 现象 | 下一步 |
|---|---|
| `aws`／`node` 命令找不到 | 完成对应安装，重开终端；WSL 用户确认工具也装在 WSL 内 |
| `aws login` 显示无此命令 | 检查 `aws --version`，按官方安装方式更新到 AWS CLI v2 2.32.0 或以上 |
| `The config profile ... could not be found` | 执行 `aws configure list-profiles` 检查拼写；若未配置，返回路线 A／B；不同电脑或系统用户不共用本机配置 |
| `ExpiredToken`、SSO 会话过期 | 路线 A 重新 `aws sso login --profile portal-deploy`；路线 B 重新 `aws login --profile portal-console`，然后再运行身份查询 |
| `Unable to locate credentials`／`CredentialsProviderError` | 确认同一终端、同一 profile；路线 B 检查是否完成 `credential_process` 配置，不打印缓存或密钥排查 |
| `aws login` 阶段 `AccessDenied` | 管理员检查实际身份是否允许 `SignInLocalDevelopmentAccess` 及组织限制；这是登录权限问题 |
| 身份查询成功，部署却 `AccessDenied` | 按错误中的 API 和资源 ARN 核对下一节部署 IAM 策略、权限边界／SCP；反复登录不会补齐部署权限 |
| 浏览器选了正确账号，终端仍显示别的账号 | 检查指定的 profile 和企业凭据工具；重新走对应授权流程，再以身份查询结果为准 |
| CLI 身份查询成功，但 Node.js 使用了另一身份 | 请管理员检查终端是否残留其他项目的 AWS 凭据环境变量、`AWS_CONFIG_FILE`／`AWS_SHARED_CREDENTIALS_FILE` 或自定义 endpoint；不要打印变量值或直接删除整个 `.aws` 目录 |
| GitHub `Repository not found`／无权克隆 | 仓库是私有的，先接受访问邀请并完成 GitHub 身份验证；这不是 AWS IAM 错误 |

以上登录方式依据 AWS 官方文档核对；本文未替你完成企业授权或在新的部署身份下执行部署。参考：[Identity Center SSO](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html)、[控制台身份本机登录与凭据兼容配置](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html)、[本机登录策略](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/SignInLocalDevelopmentAccess.html)。

## 部署前：由管理员配置 AWS 权限

**部署所需的 AWS 权限主要通过 IAM 配置。**先确认本机 AWS profile 实际使用哪个 IAM 角色或用户，再由管理员给它授权；只登录 AWS 控制台不等于本机已经有部署权限。企业使用 IAM Identity Center（SSO）时，由管理员在相应权限集中配置并重新预置到目标 AWS 账户，部署人员再刷新登录会话。飞书应用权限、Keycloak 管理权限及 QuickSight 内的报表共享授权需分别配置。

| 身份 | 谁来配置 | 用于什么 |
|---|---|---|
| 部署身份（本机 AWS profile 对应角色／用户） | AWS 管理员；SSO 场景由权限集管理员处理 | 通过 AWS SDK 调用 CloudFormation，创建和更新应用资源，上传部署代码包、解析指定密钥 |
| 应用运行角色（`PortalRole`） | 本项目 CloudFormation 模板自动创建 | Lambda 读写会话和身份关联，查询 QuickSight 用户与报表权限，生成嵌入链接 |
| Cognito／QuickSight／飞书管理员 | 各系统管理员 | 配置登录客户端、开通用户、分享仪表盘及发布飞书应用 |

**下面的策略授予部署身份，不要挂到 Lambda 运行角色上。**当前脚本未指定独立的 CloudFormation 服务角色，默认使用调用者的权限部署；若已有 stack 配了服务角色，实际资源创建权限需配置在该服务角色上，并由管理员单独审核其使用权限。

### 管理员怎样配置

1. 部署人员提供 `config.local.json` 中的 AWS 账户 ID、区域、`stackName`、`runtimeSecretArn`，以及本机使用的部署角色名称。不要提供密钥值。
2. 管理员先准备好 `runtimeSecretArn` 指向的 Secrets Manager 密钥，内容见部署指南。以下策略允许部署解析该密钥，**不包含创建／修改密钥、创建 Cognito 客户端或开通 QuickSight 用户的管理权限**；这些准备工作由相应管理员完成。
3. 展开下面的 JSON，替换所有占位值。IAM → 策略 → 创建策略 → JSON，粘贴并检查，命名为 `FeishuReportPortalDeployer`。
4. IAM → 角色 → 目标部署角色 → 添加权限 → 附加策略，选择刚创建的策略。若企业使用 SSO，请通过权限集管理员配置，不直接改 IAM Identity Center 自动生成的角色。
5. 部署人员刷新 AWS 登录，然后执行部署指南中的 `npm run deploy -- --profile portal-deploy`。IAM 策略不能越过组织 SCP、权限边界、会话策略或资源策略中的限制；有明确拒绝时应交由管理员核对。

<details>
<summary><strong>展开：首次部署／更新权限 JSON（先替换占位值，再由管理员审核）</strong></summary>

对应文件：[infra/deployer-policy.example.json](infra/deployer-policy.example.json)。这是当前模板的部署权限基线，**不是经全新账户部署验证的最终最小权限策略**。适用于商业 AWS、同账户同区域、当前 Node.js AWS SDK 部署流程、默认加密及不使用 VPC／Lambda 层／自定义域名的部署。

| 占位值 | 替换为 |
|---|---|
| `ACCOUNT_ID` | 目标 12 位 AWS 账户 ID |
| `REGION` | 目标区域，例如 `us-east-1` |
| `STACK_NAME` | `config.local.json` 的 `stackName`，保留大小写；仅替换这段文字，保留后面的逻辑资源名与 `*` |
| `RUNTIME_SECRET_ARN` | 配置中的完整 Secrets Manager 密钥 ARN，包含末尾随机后缀 |

示例假定 CloudFormation 使用默认物理资源命名。建议资源栈名称使用不超过 24 个字符的名称，例如 `feishu-report-portal`，避免长名称截断后与策略中的角色／表名前缀不一致；已有自定义物理名称时按实际 ARN 调整。

部署脚本会创建／复用专用 S3 桶 `feishu-portal-ACCOUNT_ID-REGION`，用于保存代码 ZIP。它会检查桶归属及项目标签，开启阻止公开访问、加密和版本控制。该桶由 SDK 准备，不属于应用资源栈；删除应用栈不会删除代码包。示例策略的桶 ARN 已与此命名一致。

HTTP API 初次创建时 ID 未知，`/apis/*` 会覆盖目标区域的其他 HTTP API；变更集权限也覆盖该账户区域中的变更集。若要求严格隔离，应由管理员设计专用部署服务角色及相应约束。策略允许创建并赋权应用运行角色，**仅供可信部署人员使用，不是隔离不可信操作者的权限边界**。没有在此授予 `AdministratorAccess`，也没有把 `iam:PassRole` 放到任意角色上。

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ApplicationStack",
      "Effect": "Allow",
      "Action": [
        "cloudformation:CreateStack",
        "cloudformation:UpdateStack",
        "cloudformation:DeleteStack",
        "cloudformation:DescribeStacks",
        "cloudformation:DescribeStackEvents",
        "cloudformation:DescribeStackResources",
        "cloudformation:ListStackResources",
        "cloudformation:GetTemplate",
        "cloudformation:GetTemplateSummary",
        "cloudformation:CreateChangeSet",
        "cloudformation:DescribeChangeSet",
        "cloudformation:ExecuteChangeSet",
        "cloudformation:DeleteChangeSet",
        "cloudformation:ListChangeSets",
        "cloudformation:ContinueUpdateRollback",
        "cloudformation:RollbackStack"
      ],
      "Resource": [
        "arn:aws:cloudformation:REGION:ACCOUNT_ID:stack/STACK_NAME/*",
        "arn:aws:cloudformation:REGION:ACCOUNT_ID:changeSet/portal-*/*"
      ]
    },
    {
      "Sid": "CloudFormationServerlessTransform",
      "Effect": "Allow",
      "Action": [
        "cloudformation:CreateChangeSet"
      ],
      "Resource": [
        "arn:aws:cloudformation:REGION:aws:transform/Serverless-2016-10-31"
      ]
    },
    {
      "Sid": "TemplateValidation",
      "Effect": "Allow",
      "Action": [
        "cloudformation:ValidateTemplate",
        "cloudformation:GetTemplateSummary",
        "cloudformation:ListStacks"
      ],
      "Resource": [
        "*"
      ],
      "Condition": {
        "StringEquals": {
          "aws:RequestedRegion": "REGION"
        }
      }
    },
    {
      "Sid": "ManageApplicationRuntimeRole",
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole",
        "iam:GetRole",
        "iam:DeleteRole",
        "iam:UpdateRole",
        "iam:UpdateRoleDescription",
        "iam:UpdateAssumeRolePolicy",
        "iam:PutRolePolicy",
        "iam:GetRolePolicy",
        "iam:DeleteRolePolicy",
        "iam:ListRolePolicies",
        "iam:ListAttachedRolePolicies",
        "iam:TagRole",
        "iam:UntagRole"
      ],
      "Resource": [
        "arn:aws:iam::ACCOUNT_ID:role/STACK_NAME-PortalRole-*"
      ]
    },
    {
      "Sid": "PassOnlyApplicationRoleToLambda",
      "Effect": "Allow",
      "Action": [
        "iam:PassRole"
      ],
      "Resource": [
        "arn:aws:iam::ACCOUNT_ID:role/STACK_NAME-PortalRole-*"
      ],
      "Condition": {
        "StringEquals": {
          "iam:PassedToService": "lambda.amazonaws.com"
        }
      }
    },
    {
      "Sid": "ApplicationFunction",
      "Effect": "Allow",
      "Action": [
        "lambda:CreateFunction",
        "lambda:GetFunction",
        "lambda:DeleteFunction",
        "lambda:UpdateFunctionCode",
        "lambda:UpdateFunctionConfiguration",
        "lambda:GetFunctionConfiguration",
        "lambda:TagResource",
        "lambda:UntagResource",
        "lambda:ListTags",
        "lambda:AddPermission",
        "lambda:RemovePermission",
        "lambda:GetPolicy",
        "lambda:GetFunctionCodeSigningConfig",
        "lambda:GetFunctionRecursionConfig",
        "lambda:GetRuntimeManagementConfig",
        "lambda:GetFunctionScalingConfig"
      ],
      "Resource": [
        "arn:aws:lambda:REGION:ACCOUNT_ID:function:STACK_NAME-app"
      ]
    },
    {
      "Sid": "ApplicationStateTable",
      "Effect": "Allow",
      "Action": [
        "dynamodb:CreateTable",
        "dynamodb:DeleteTable",
        "dynamodb:UpdateTable",
        "dynamodb:DescribeTable",
        "dynamodb:DescribeContinuousBackups",
        "dynamodb:UpdateContinuousBackups",
        "dynamodb:DescribeTimeToLive",
        "dynamodb:UpdateTimeToLive",
        "dynamodb:DescribeContributorInsights",
        "dynamodb:DescribeKinesisStreamingDestination",
        "dynamodb:GetResourcePolicy",
        "dynamodb:ListTagsOfResource",
        "dynamodb:TagResource",
        "dynamodb:UntagResource"
      ],
      "Resource": [
        "arn:aws:dynamodb:REGION:ACCOUNT_ID:table/STACK_NAME-StateTable-*"
      ]
    },
    {
      "Sid": "HttpApiProvisioning",
      "Effect": "Allow",
      "Action": [
        "apigateway:GET",
        "apigateway:POST",
        "apigateway:PUT",
        "apigateway:PATCH",
        "apigateway:DELETE"
      ],
      "Resource": [
        "arn:aws:apigateway:REGION::/apis",
        "arn:aws:apigateway:REGION::/apis/*",
        "arn:aws:apigateway:REGION::/tags/*"
      ]
    },
    {
      "Sid": "ApplicationLogGroup",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:DeleteLogGroup",
        "logs:PutRetentionPolicy",
        "logs:DeleteRetentionPolicy",
        "logs:TagResource",
        "logs:UntagResource",
        "logs:ListTagsForResource",
        "logs:TagLogGroup",
        "logs:UntagLogGroup",
        "logs:ListTagsLogGroup",
        "logs:GetDataProtectionPolicy",
        "logs:DescribeIndexPolicies"
      ],
      "Resource": [
        "arn:aws:logs:REGION:ACCOUNT_ID:log-group:/aws/lambda/STACK_NAME-app",
        "arn:aws:logs:REGION:ACCOUNT_ID:log-group:/aws/lambda/STACK_NAME-app:*"
      ]
    },
    {
      "Sid": "DescribeLogs",
      "Effect": "Allow",
      "Action": [
        "logs:DescribeLogGroups",
        "logs:DescribeResourcePolicies"
      ],
      "Resource": [
        "*"
      ],
      "Condition": {
        "StringEquals": {
          "aws:RequestedRegion": "REGION"
        }
      }
    },
    {
      "Sid": "DeploymentBucket",
      "Effect": "Allow",
      "Action": [
        "s3:CreateBucket",
        "s3:DeleteBucket",
        "s3:ListBucket",
        "s3:GetBucket*",
        "s3:Get*Configuration",
        "s3:PutBucketPublicAccessBlock",
        "s3:PutEncryptionConfiguration",
        "s3:PutBucketVersioning",
        "s3:PutBucketTagging",
        "s3:PutBucketPolicy",
        "s3:DeleteBucketPolicy",
        "s3:ListTagsForResource",
        "s3:TagResource",
        "s3:UntagResource"
      ],
      "Resource": [
        "arn:aws:s3:::feishu-portal-ACCOUNT_ID-REGION"
      ]
    },
    {
      "Sid": "DeploymentObjects",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:GetObjectVersion",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts"
      ],
      "Resource": [
        "arn:aws:s3:::feishu-portal-ACCOUNT_ID-REGION/*"
      ]
    },
    {
      "Sid": "ResolveOnlyApplicationSecret",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": [
        "RUNTIME_SECRET_ARN"
      ]
    }
  ]
}
```

</details>

<details>
<summary><strong>展开：仅在 Secrets Manager 使用客户管理的 KMS 密钥时追加</strong></summary>

默认 `aws/secretsmanager` 密钥不需要照搬这一段。使用客户管理密钥时，把 `KMS_KEY_ARN` 换成该密钥的完整 ARN，替换区域，作为另一个策略授予解析秘密的部署身份；KMS 密钥策略也必须允许相应身份使用。应用代码不直接读取 Secrets Manager。

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "DecryptApplicationSecretThroughSecretsManager",
    "Effect": "Allow",
    "Action": "kms:Decrypt",
    "Resource": "KMS_KEY_ARN",
    "Condition": {
      "StringEquals": {
        "kms:ViaService": "secretsmanager.REGION.amazonaws.com"
      }
    }
  }]
}
```

此段只覆盖 Secrets Manager 解密，不覆盖企业自定义的 S3、Lambda、DynamoDB 或日志加密配置。

</details>

### 权限示例如何核对

核对日期：2026-10-20。已对照当前 SDK 部署脚本、AWS CloudFormation 公共资源类型的 handler 权限、AWS Service Authorization Reference 核对动作名称；JSON 语法及占位值范围已检查。**尚未用只挂此策略的新部署角色从零部署，仍需目标环境验收。**不将既有管理员身份部署成功当作这份策略已通过最小权限验证。

可复现地提取部署脚本直接调用 SDK 的基线：

```bash
uvx iam-policy-autopilot@latest generate-policies scripts/deploy.mjs scripts/outputs.mjs scripts/aws-context.mjs --language javascript --pretty
```

该命令不能覆盖通过 CloudFormation 创建资源的间接权限，因此不能把其输出直接当作完整部署策略。运行时权限另见 `infra/iam-baseline.json` 与 `scripts/template.mjs`。

官方参考：[CloudFormation 的 IAM 权限](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-iam-template.html)、[PassRole](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_passrole.html)、[Secrets Manager 动态引用](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/dynamic-references-secretsmanager.html)。

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

需要 Node.js 22.12+、npm；部署另需 Git、AWS CLI v2，以及按上文验证通过的 AWS profile。工具安装与版本检查见“本机准备与 AWS 登录”。

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
- [CloudFormation 变更集](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-updating-stacks-changesets.html)
