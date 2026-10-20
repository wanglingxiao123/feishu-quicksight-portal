# 本机准备与 AWS 登录

[返回部署入口](../README.md) · 先由 AWS 管理员按[权限说明](IAM-SETUP.md)准备部署身份。


**本节只由部署人员执行一次；普通员工直接在飞书使用应用，不安装这些工具。**“在本机部署”指从电脑把应用发布到 AWS；应用随后在云端运行，电脑关机不影响员工访问。

浏览器能打开 AWS 控制台，不代表终端里的 Node.js 与 AWS CLI 已获得凭据。本节的完成目标是：在同一个终端中，用同一个 **profile** 验证正确的 AWS 账户和角色，并把它交给部署命令。profile 是本机保存 AWS 登录配置的名字，本文统一叫 `portal-deploy`，与 QuickSight 账户名称、飞书账号无关。

### 先拿齐这四项资料

| 向 AWS 管理员确认 | 例子／用途 |
|---|---|
| 部署目标 AWS 账户 ID | 12 位数字；后面必须与 `config.local.json` 的 `awsAccountId` 相同 |
| 应用与 QuickSight 的部署区域 | 例如 `us-east-1`，以目标 QuickSight 所在区域为准 |
| 被授权的部署角色／权限集 | 须具备[部署权限策略](IAM-SETUP.md)中的权限；只读角色不能创建应用 |
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

### 2｜查看本机 profile，再选择登录方式

#### 2.1｜profile 在哪里看？

**在电脑终端里查看，不是在 AWS 或 QuickSight 网页里查。**profile 是一组本机 AWS 登录配置的名称，不是一个需要上传的文件。

打开刚才检查工具版本的同一个终端，在任意文件夹执行：

```bash
aws configure list-profiles
```

例如输出：

```text
default
portal-deploy
```

每一行都是一个已有的 profile 名称，`default` 也是名称；你的输出可能不同。**列出名称不代表已经登录，也不能凭名称判断它属于哪个 AWS 账户。**

| 看到什么 | 下一步 |
|---|---|
| 已有公司指定的 profile | 记下完整名称，按公司流程刷新登录，再按第 3 节验证账户、角色和区域 |
| 有多个名称，不知道选哪个 | 按第 3 节的身份查询命令逐个核对；把命令中的 `portal-deploy` 换成待核对的名称，不默认选择第一行 |
| 没有输出 | 当前终端未找到已配置的 profile；按下面的路线 A 或 B 创建，完成后重新执行查看命令 |
| 提示 `aws: command not found` | 回到第 1 节安装 AWS CLI，并重新打开终端 |

例如验证通过的名称为 `portal-deploy`，后续命令中的 `your-profile` 就替换为 `portal-deploy`；实际名称不同则使用实际名称。无需重命名已有 profile。

#### 2.2｜需要新建或刷新登录时，选择一条路线

已有公司规定的凭据工具／profile 时，继续使用它，按公司的流程刷新凭据，然后直接做第 3 节验证。不知道公司采用哪一种时，向 AWS 管理员确认本节开头的四项资料，不要把报表登录的 Cognito 账号填进 AWS CLI。

下文用 `portal-deploy` 作为新 profile 的示例名称。如果已被其他项目使用，请换一个新名称，并在后续命令中一致使用，不覆盖原配置。

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
| AWS account | 选择 AWS 管理员提供的 12 位目标账户；只有一个选项时可能自动跳过 |
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

1. 管理员在该 IAM 用户／角色上授予 AWS 托管策略 `SignInLocalDevelopmentAccess`（或符合企业限制的等效权限）。这只允许本机登录，**不替代[部署权限策略](IAM-SETUP.md)**。
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

下面以 `portal-deploy` 为例。已有 profile 时，将两条命令中的名称都替换为第 2.1 节查到的实际名称；不要原样执行一个本机不存在的名称。

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

**完成标志：**身份查询成功，账户、角色、区域均正确。此查询只证明凭据有效，不能证明所有创建权限都已具备；管理员还需完成[部署权限说明](IAM-SETUP.md)中的授权。登录与 IAM 授权两项都完成后，才执行部署。

### 4｜让后续部署使用同一个 profile

按[部署指南](DEPLOYMENT.md)创建飞书应用、下载工程并填写配置后，在包含 `package.json` 和 `config.local.json` 的工程目录执行：

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
| 身份查询成功，部署却 `AccessDenied` | 按错误中的 API 和资源 ARN 核对[部署权限策略](IAM-SETUP.md)、权限边界／SCP；反复登录不会补齐部署权限 |
| 浏览器选了正确账号，终端仍显示别的账号 | 检查指定的 profile 和企业凭据工具；重新走对应授权流程，再以身份查询结果为准 |
| CLI 身份查询成功，但 Node.js 使用了另一身份 | 请管理员检查终端是否残留其他项目的 AWS 凭据环境变量、`AWS_CONFIG_FILE`／`AWS_SHARED_CREDENTIALS_FILE` 或自定义 endpoint；不要打印变量值或直接删除整个 `.aws` 目录 |

以上登录方式依据 AWS 官方文档核对；本文未替你完成企业授权或在新的部署身份下执行部署。参考：[Identity Center SSO](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html)、[控制台身份本机登录与凭据兼容配置](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html)、[本机登录策略](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/SignInLocalDevelopmentAccess.html)。
