# 授权边界与敏感信息

1. 飞书开放范围决定可见性；后端 `mayEnter` 根据已验证飞书 tenantKey 决定准入，不信任前端提交的企业信息。
2. OIDC code、state、nonce、PKCE 和 ID token 签名核验通过后才匹配可信已验证邮箱或管理员配置的身份例外。用户身份逐条固定到 issuer/sub，不使用外部浏览器 QuickSight cookie。
3. 每次请求目录或生成 iframe 都检查服务器会话及映射；生成链接前再次查询当前 QuickSight 用户的报表权限。
4. CloudFormation 运行权限从 IAM Policy Autopilot 输出基线收敛：DynamoDB 限本表、QuickSight 用户 API 在自动模式限指定 namespace，在人工模式限配置 UserArn 列表；SearchDashboards 限目标账户区域的 dashboard 资源；嵌入域条件要求非空且仅为应用来源。
5. 基线中的 DynamoDB replication 和 KMS 操作没有加入运行策略：模板没有配置复制或客户自管 KMS 密钥。CloudWatch 日志写权限仅允许本函数日志组。
6. 本应用不注册 QuickSight 用户、不购买套餐、不生成匿名链接、不修改报表分享权限。
7. 登记令牌是一次性准入引导能力。要由指定人员首先完成登记，否则可能固定到错误企业；不应公开分发。
8. 企业范围开放不是员工自动开通：每名用户必须通过已验证邮箱的唯一匹配或人工例外。首次自动匹配后持久保存 issuer/sub、QuickSight PrincipalId 与反向归属锁；旧邮箱或用户名不能接管既有关联。当前无 QuickSight 用户自动创建、目录同步/授权管理 UI，不能作为完整企业身份生命周期管理系统。
9. 日志不应记录请求查询串、token 或报表链接。不要擅自开启带 OAuth 回调查询参数的访问日志。
10. 保留实际环境与模拟测试的区别。上线前完成跨用户、跨端验收及组织安全检查。

重新生成基线（不上传 IAM）：

```bash
uvx iam-policy-autopilot@latest generate-policies server.mjs report-services.mjs --language javascript --pretty > infra/iam-baseline.json
```

检查基线变化后再修改资源收敛逻辑，不要直接部署自动生成的宽泛 Resource。

自动模式要求 DynamoDB 持久事务，不支持仅靠进程内存完成注册。DynamoDB 事务写入使用 PutItem 权限；两条带条件的 Put 同时成功或同时失败。基线中的 UpdateItem/ConditionCheckItem 没有加入运行策略，因为实现没有使用独立 Update 或 ConditionCheck 事务项。
