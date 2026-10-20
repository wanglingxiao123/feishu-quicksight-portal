import * as oidc from 'openid-client';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import {
  QuickSightClient, paginateSearchDashboards, GenerateEmbedUrlForRegisteredUserCommand, DescribeUserCommand,
} from '@aws-sdk/client-quicksight';

export function createReportServices(env, origin) {
  const providers = new Map(), clients = new Map();
  const ready = tenant => Boolean(tenant.issuer && (tenant.pilotLogin || tenant.identityMappings?.length) && env[tenant.clientIdEnv]
    && env[tenant.readyEnv] === 'true');
  const configuration = async tenant => {
    if (!ready(tenant)) throw Error('ReportIdentityNotConfigured');
    if (!providers.has(tenant.id)) {
      providers.set(tenant.id, oidc.discovery(new URL(tenant.issuer), env[tenant.clientIdEnv],
        env[tenant.clientSecretEnv] || undefined, env[tenant.clientSecretEnv] ? undefined : oidc.None())
        .then(config => { oidc.enableNonRepudiationChecks(config); return config; })
        .catch(error => { providers.delete(tenant.id); throw error; }));
    }
    return providers.get(tenant.id);
  };
  const client = tenant => {
    if (!ready(tenant)) throw Error('ReportIdentityNotConfigured');
    if (!clients.has(tenant.id)) clients.set(tenant.id, new QuickSightClient({
      region: tenant.region,
      ...(tenant.useExecutionRole ? {} : { credentials: fromTemporaryCredentials({
        clientConfig: { region: tenant.region },
        params: { RoleArn: tenant.roleArn, ExternalId: tenant.externalId, RoleSessionName: 'feishu-report-session' },
      }) }),
    }));
    return clients.get(tenant.id);
  };
  return {
    ready,
    provider: {
      async begin(tenant, { redirectUri, forceLogin }) {
        const config = await configuration(tenant);
        const transaction = {
          verifier: oidc.randomPKCECodeVerifier(), state: oidc.randomState(), nonce: oidc.randomNonce(),
        };
        const url = oidc.buildAuthorizationUrl(config, {
          redirect_uri: redirectUri, scope: 'openid profile email',
          code_challenge: await oidc.calculatePKCECodeChallenge(transaction.verifier),
          code_challenge_method: 'S256', state: transaction.state, nonce: transaction.nonce,
          ...(forceLogin ? { prompt: 'login' } : {}),
        });
        // Classic Hosted UI doesn't support prompt=login; clear its session before switching.
        if (forceLogin && tenant.provider === 'cognito') {
          if (url.origin !== tenant.authorizationOrigin) throw Error('UnexpectedCognitoEndpoint');
          url.pathname = '/logout';
          url.searchParams.delete('prompt');
        }
        return { transaction, url: url.href };
      },
      async finish(tenant, callbackUrl, pending) {
        const tokens = await oidc.authorizationCodeGrant(await configuration(tenant), callbackUrl, {
          pkceCodeVerifier: pending.verifier, expectedState: pending.state,
          expectedNonce: pending.nonce, idTokenExpected: true,
        });
        return tokens.claims();
      },
    },
    async describeUser(tenant) {
      const [namespace, ...name] = tenant.pilotUserArn.split(':user/')[1].split('/');
      return (await client(tenant).send(new DescribeUserCommand({
        AwsAccountId: tenant.accountId, Namespace: namespace, UserName: name.join('/'),
      }))).User;
    },
    async searchDashboards(tenant, binding) {
      const dashboards = [];
      for await (const page of paginateSearchDashboards({ client: client(tenant) }, {
        AwsAccountId: tenant.accountId,
        Filters: [{ Name: 'QUICKSIGHT_VIEWER_OR_OWNER', Operator: 'StringEquals', Value: binding.quickSightUserArn }],
      })) {
        for (const d of page.DashboardSummaryList ?? []) {
          dashboards.push({ id: d.DashboardId, name: d.Name, updatedAt: d.LastUpdatedTime });
        }
      }
      return dashboards.sort((a, b) => a.name.localeCompare(b.name));
    },
    async createEmbed(tenant, binding, dashboardId) {
      const result = await client(tenant).send(new GenerateEmbedUrlForRegisteredUserCommand({
        AwsAccountId: tenant.accountId, UserArn: binding.quickSightUserArn,
        SessionLifetimeInMinutes: 60, AllowedDomains: [origin()],
        ExperienceConfiguration: { Dashboard: { InitialDashboardId: dashboardId,
          FeatureConfigurations: {
            AmazonQInQuickSight: { ExecutiveSummary: { Enabled: false } },
            Schedules: { Enabled: false }, SharedView: { Enabled: false },
          },
        } },
      }));
      return result.EmbedUrl;
    },
  };
}
