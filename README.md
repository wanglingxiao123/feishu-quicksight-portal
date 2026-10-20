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

## 部署前：由管理员配置 AWS 权限

**是的，部署所需的 AWS 权限主要通过 IAM 配置。**先确认本机 AWS profile 实际使用哪个 IAM 角色或用户，再由管理员给它授权；只登录 AWS 控制台不等于本机已经有部署权限。企业使用 IAM Identity Center（SSO）时，由管理员在相应权限集中配置并重新预置到目标 AWS 账户，部署人员再刷新登录会话。飞书应用权限、Keycloak 管理权限及 QuickSight 内的报表共享授权需分别配置。

| 身份 | 谁来配置 | 用于什么 |
|---|---|---|
| 部署身份（本机 AWS profile 对应角色／用户） | AWS 管理员；SSO 场景由权限集管理员处理 | 运行 SAM／CloudFormation，创建和更新应用资源，上传部署代码包、解析指定密钥 |
| 应用运行角色（`PortalRole`） | 本项目 CloudFormation 模板自动创建 | Lambda 读写会话和身份关联，查询 QuickSight 用户与报表权限，生成嵌入链接 |
| Cognito／QuickSight／飞书管理员 | 各系统管理员 | 配置登录客户端、开通用户、分享仪表盘及发布飞书应用 |

**下面的策略授予部署身份，不要挂到 Lambda 运行角色上。**当前脚本未指定独立的 CloudFormation 服务角色，默认使用调用者的权限部署；若已有 stack 配了服务角色，实际资源创建权限需配置在该服务角色上，并由管理员单独审核其使用权限。

### 管理员怎样配置

1. 部署人员提供 `config.local.json` 中的 AWS 账户 ID、区域、`stackName`、`runtimeSecretArn`，以及本机使用的部署角色名称。不要提供密钥值。
2. 管理员先准备好 `runtimeSecretArn` 指向的 Secrets Manager 密钥，内容见部署指南。以下策略允许部署解析该密钥，**不包含创建／修改密钥、创建 Cognito 客户端或开通 QuickSight 用户的管理权限**；这些准备工作由相应管理员完成。
3. 展开下面的 JSON，替换所有占位值。IAM → 策略 → 创建策略 → JSON，粘贴并检查，命名为 `FeishuReportPortalDeployer`。
4. IAM → 角色 → 目标部署角色 → 添加权限 → 附加策略，选择刚创建的策略。若企业使用 SSO，请通过权限集管理员配置，不直接改 IAM Identity Center 自动生成的角色。
5. 部署人员刷新 AWS 登录，然后执行部署指南中的 `npm run deploy -- --profile your-profile`。IAM 策略不能越过组织 SCP、权限边界、会话策略或资源策略中的限制；有明确拒绝时应交由管理员核对。

<details>
<summary><strong>展开：首次部署／更新权限 JSON（先替换占位值，再由管理员审核）</strong></summary>

对应文件：[infra/deployer-policy.example.json](infra/deployer-policy.example.json)。这是当前模板的部署权限基线，**不是经全新账户部署验证的最终最小权限策略**。适用于商业 AWS、同账户同区域、当前 SAM `--resolve-s3` 流程、默认加密及不使用 VPC／Lambda 层／自定义域名的部署。

| 占位值 | 替换为 |
|---|---|
| `ACCOUNT_ID` | 目标 12 位 AWS 账户 ID |
| `REGION` | 目标区域，例如 `us-east-1` |
| `STACK_NAME` | `config.local.json` 的 `stackName`，保留大小写；仅替换这段文字，保留后面的逻辑资源名与 `*` |
| `RUNTIME_SECRET_ARN` | 配置中的完整 Secrets Manager 密钥 ARN，包含末尾随机后缀 |

示例假定 CloudFormation 使用默认物理资源命名。建议资源栈名称使用不超过 24 个字符的名称，例如 `feishu-report-portal`，避免长名称截断后与策略中的角色／表名前缀不一致；已有自定义物理名称时按实际 ARN 调整。

SAM 默认会创建／复用 `aws-sam-cli-managed-default` 资源栈及其 S3 桶，桶内存放部署代码包，不能承诺部署后自动清空。本策略包含这些资源的准备与上传权限。若企业使用自备桶或已有自定义命名的 SAM 桶，需要按实际桶 ARN 调整策略，并同步调整部署命令。

HTTP API 初次创建时 ID 未知，`/apis/*` 会覆盖目标区域的其他 HTTP API；变更集权限也覆盖该账户区域中的变更集。若要求严格隔离，应由管理员设计专用部署服务角色及相应约束。策略允许创建并赋权应用运行角色，**仅供可信部署人员使用，不是隔离不可信操作者的权限边界**。没有在此授予 `AdministratorAccess`，也没有把 `iam:PassRole` 放到任意角色上。

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ApplicationAndSamStacks",
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
        "arn:aws:cloudformation:REGION:ACCOUNT_ID:stack/aws-sam-cli-managed-default/*",
        "arn:aws:cloudformation:REGION:ACCOUNT_ID:changeSet/*/*"
      ]
    },
    {
      "Sid": "SamTransform",
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
      "Sid": "SamDeploymentBucket",
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
        "arn:aws:s3:::aws-sam-cli-managed-default-samclisourcebucket-*"
      ]
    },
    {
      "Sid": "SamDeploymentObjects",
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
        "arn:aws:s3:::aws-sam-cli-managed-default-samclisourcebucket-*/*"
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

核对日期：2026-10-20。已对照当前 SAM 命令、AWS CloudFormation 公共资源类型的 handler 权限、AWS Service Authorization Reference 核对动作名称；JSON 语法及占位值范围已检查。**尚未用只挂此策略的新部署角色从零部署，仍需目标环境验收。**不将既有管理员身份部署成功当作这份策略已通过最小权限验证。

可复现地提取部署脚本直接调用 SDK 的基线：

```bash
uvx iam-policy-autopilot@latest generate-policies scripts/deploy.mjs scripts/outputs.mjs scripts/aws-context.mjs --language javascript --pretty
```

该命令不能覆盖通过外部 SAM／CloudFormation 创建资源的间接权限，因此不能把其输出直接当作完整部署策略。运行时权限另见 `infra/iam-baseline.json` 与 `scripts/template.mjs`。

官方参考：[CloudFormation 的 IAM 权限](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-iam-template.html)、[SAM deploy 与 resolve-s3](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-cli-command-reference-sam-deploy.html)、[PassRole](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_passrole.html)、[Secrets Manager 动态引用](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/dynamic-references-secretsmanager.html)。

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
