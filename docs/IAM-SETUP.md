# 部署前：由管理员配置 AWS 权限

[返回部署入口](../README.md) · 本页由 AWS 管理员操作，部署人员无需自行选择 IAM 动作。


**部署所需的 AWS 权限主要通过 IAM 配置。**管理员先确定用于部署的 IAM 角色／用户并授予权限，再告知部署人员登录方式；部署人员登录后核对 profile 对应的身份；只登录 AWS 控制台不等于本机已经有部署权限。企业使用 IAM Identity Center（SSO）时，由管理员在相应权限集中配置并重新预置到目标 AWS 账户，部署人员再刷新登录会话。飞书应用权限、Keycloak 管理权限及 QuickSight 内的报表共享授权需分别配置。

| 身份 | 谁来配置 | 用于什么 |
|---|---|---|
| 部署身份（本机 AWS profile 对应角色／用户） | AWS 管理员；SSO 场景由权限集管理员处理 | 通过 AWS SDK 调用 CloudFormation，创建和更新应用资源，上传部署代码包、解析指定密钥 |
| 应用运行角色（`PortalRole`） | 本项目 CloudFormation 模板自动创建 | Lambda 读写会话和身份关联，查询 QuickSight 用户与报表权限，生成嵌入链接 |
| Cognito／QuickSight／飞书管理员 | 各系统管理员 | 配置登录客户端、开通用户、分享仪表盘及发布飞书应用 |

**下面的策略授予部署身份，不要挂到 Lambda 运行角色上。**当前脚本未指定独立的 CloudFormation 服务角色，默认使用调用者的权限部署；若已有 stack 配了服务角色，实际资源创建权限需配置在该服务角色上，并由管理员单独审核其使用权限。

### 管理员怎样配置

1. 管理员与部署人员确认目标 AWS 账户 ID、区域、资源栈名 `stackName`、专用密钥 ARN `runtimeSecretArn` 和部署角色名称。这些值随后填入 `config.local.json`；密钥尚未创建时，先完成下一项准备。不要提供密钥值。
2. 管理员先准备好 `runtimeSecretArn` 指向的 Secrets Manager 密钥，内容见部署指南。以下策略允许部署解析该密钥，**不包含创建／修改密钥、创建 Cognito 客户端或开通 QuickSight 用户的管理权限**；这些准备工作由相应管理员完成。
3. 展开下面的 JSON，替换所有占位值。IAM → 策略 → 创建策略 → JSON，粘贴并检查，命名为 `FeishuReportPortalDeployer`。
4. IAM → 角色 → 目标部署角色 → 添加权限 → 附加策略，选择刚创建的策略。若企业使用 SSO，请通过权限集管理员配置，不直接改 IAM Identity Center 自动生成的角色。
5. 部署人员刷新 AWS 登录，然后执行部署指南中的 `npm run deploy -- --profile portal-deploy`。IAM 策略不能越过组织 SCP、权限边界、会话策略或资源策略中的限制；有明确拒绝时应交由管理员核对。

<details>
<summary><strong>展开：首次部署／更新权限 JSON（先替换占位值，再由管理员审核）</strong></summary>

对应文件：[infra/deployer-policy.example.json](../infra/deployer-policy.example.json)。这是当前模板的部署权限基线，**不是经全新账户部署验证的最终最小权限策略**。适用于商业 AWS、同账户同区域、当前 Node.js AWS SDK 部署流程、默认加密及不使用 VPC／Lambda 层／自定义域名的部署。

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

