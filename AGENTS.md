# Deployment instructions for AI agents

Read README.md and docs/DEPLOYMENT.md before acting. This is a Feishu dashboard portal with separate Feishu entry authorization and per-user OIDC-to-QuickSight authorization.

- Start by creating an EMPTY enterprise Feishu app. Obtain its App ID before AWS deployment; fill home/callback URLs only after CloudFormation produces them.
- Never deploy example identifiers. Ask for missing account, region, existing identity system, namespace, trusted verified-email rules and any legacy exceptions. Verify STS account before AWS mutations.
- Work with config.local.json. Keep secrets only in runtime-secret.local.json (0600, gitignored) and the customer's Secrets Manager. Never print, retrieve, commit or paste secret values, auth codes, cookies, bearer embed URLs or enrollment tokens into chats or logs.
- Initial deployment uses oidc.ready=false and clientId="" to resolve the callback-address dependency. Then register the real callback, set clientId/ready and run identity preflight before update.
- Follow the configured feishuAccessMode. Never remove tenant checks or map all employees to one administrator. Automatic matching requires email_verified=true and exactly one existing QuickSight user. Missing/duplicate users must fail closed; never auto-create paid users or use a caller-provided UserArn.
- Do not change QuickSight billing, purchase capacity, enable internet-public dashboards, message others, or expand Feishu visibility without the user's authorization for that action.
- Use existing AWS tooling or SDK. npm run deploy uses the AWS SDK with S3 and CloudFormation and asks the operator to review the CloudFormation change set. Do not bypass that review.
- Run npm run check, npm test, UI tests and template lint as maintainer validation (Python/cfn-lint are not end-user deployment prerequisites). These do NOT prove real SSO or mobile behavior; report validation limits honestly.
- Package only the allowlisted runtime files. Never upload local secrets, deployment artifacts, test recordings, account inventories, private screenshots or a preexisting project's Git history.
- Preserve the existing stack, API address and identity records during updates. Never delete/recreate resources to work around an authentication error.
