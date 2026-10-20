# 开发与本地检查

[返回部署入口](../README.md) · 以下内容供修改代码的维护人员使用，首次部署无需执行测试命令。

## 项目结构

- `public/`：登录、报表目录、个人中心、嵌入查看界面。
- `server.mjs`：飞书登录、企业准入、持久会话。
- `report-*.mjs`、`access-policy.mjs`、`automatic-identity.mjs`：OIDC 核验、自动关联、逐用户绑定、报表授权。
- `config/example.json`：不含个人配置的示例。
- `scripts/`：配置校验、打包、部署、输出与身份预检。
- `infra/iam-baseline.json`：从运行时代码生成的 IAM 基线，构建时收敛到指定资源。
- `test/`：身份、权限隔离和桌面/手机布局测试。

## 本地检查

需要 Node.js 22.12+、npm；部署另需 Git、AWS CLI v2，以及按上文验证通过的 AWS profile。工具安装与版本检查见[本机准备与 AWS 登录](AWS-LOGIN.md)。

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
