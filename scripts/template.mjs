import baseline from '../infra/iam-baseline.json' with { type: 'json' };
const ref=x=>({Ref:x}),sub=x=>({'Fn::Sub':x}),attr=(x,y)=>({'Fn::GetAtt':[x,y]});
export function makeTemplate(c){
 const actions=baseline.Policies.flatMap(p=>p.Policy.Statement.flatMap(s=>[].concat(s.Action)));
 const qsActions=actions.filter(a=>a.startsWith('quicksight:'));
 if(qsActions.length!==4)throw Error('Review changed IAM baseline before building');
 const userResources = c.autoBinding?.enabled
  ? [...new Set([`arn:aws:quicksight:${c.region}:${c.awsAccountId}:user/${c.autoBinding.namespace}/*`,...(c.identityMappings||[]).filter(m=>m.enabled!==false).map(m=>m.quickSightUserArn),...(c.quickSightUserArn?[c.quickSightUserArn]:[])])]
  : (c.identityMappings?.length?c.identityMappings.filter(m=>m.enabled!==false).map(m=>m.quickSightUserArn):c.quickSightUserArn);
 const origin=sub('https://${PortalApi}.execute-api.${AWS::Region}.${AWS::URLSuffix}');
 const secret=k=>`{{resolve:secretsmanager:${c.runtimeSecretArn}:SecretString:${k}}}`;
 const resources={
 StateTable:{Type:'AWS::DynamoDB::Table',DeletionPolicy:'Retain',UpdateReplacePolicy:'Retain',Properties:{BillingMode:'PAY_PER_REQUEST',AttributeDefinitions:[{AttributeName:'pk',AttributeType:'S'}],KeySchema:[{AttributeName:'pk',KeyType:'HASH'}],TimeToLiveSpecification:{AttributeName:'expiresAt',Enabled:true},SSESpecification:{SSEEnabled:true},PointInTimeRecoverySpecification:{PointInTimeRecoveryEnabled:true}}},
 PortalApi:{Type:'AWS::ApiGatewayV2::Api',Properties:{Name:sub('${AWS::StackName}-api'),ProtocolType:'HTTP'}},
 PortalStage:{Type:'AWS::ApiGatewayV2::Stage',Properties:{ApiId:ref('PortalApi'),StageName:'$default',AutoDeploy:true,DefaultRouteSettings:{ThrottlingBurstLimit:10,ThrottlingRateLimit:5}}},
 PortalIntegration:{Type:'AWS::ApiGatewayV2::Integration',Properties:{ApiId:ref('PortalApi'),IntegrationType:'AWS_PROXY',IntegrationUri:attr('PortalFunction','Arn'),PayloadFormatVersion:'2.0',TimeoutInMillis:30000}},
 PortalRoute:{Type:'AWS::ApiGatewayV2::Route',Properties:{ApiId:ref('PortalApi'),RouteKey:'$default',Target:sub('integrations/${PortalIntegration}')}},
 PortalInvokePermission:{Type:'AWS::Lambda::Permission',Properties:{FunctionName:ref('PortalFunction'),Action:'lambda:InvokeFunction',Principal:'apigateway.amazonaws.com',SourceAccount:ref('AWS::AccountId'),SourceArn:sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${PortalApi}/*')}} ,
 PortalLogs:{Type:'AWS::Logs::LogGroup',DeletionPolicy:'Retain',UpdateReplacePolicy:'Retain',Properties:{LogGroupName:sub('/aws/lambda/${AWS::StackName}-app'),RetentionInDays:14}},
 PortalRole:{Type:'AWS::IAM::Role',Properties:{AssumeRolePolicyDocument:{Version:'2012-10-17',Statement:[{Effect:'Allow',Principal:{Service:'lambda.amazonaws.com'},Action:'sts:AssumeRole'}]},Policies:[{PolicyName:'PortalRuntime',PolicyDocument:{Version:'2012-10-17',Statement:[
 {Effect:'Allow',Action:actions.filter(a=>['dynamodb:GetItem','dynamodb:PutItem','dynamodb:DeleteItem'].includes(a)),Resource:attr('StateTable','Arn')},
 ...qsActions.filter(a=>a!=='quicksight:ListUsers'||c.autoBinding?.enabled).map(a=>({Effect:'Allow',Action:a,Resource:a==='quicksight:SearchDashboards'?`arn:aws:quicksight:${c.region}:${c.awsAccountId}:dashboard/*`:(a==='quicksight:ListUsers'?`arn:aws:quicksight:${c.region}:${c.awsAccountId}:user/${c.autoBinding.namespace}/*`:userResources),...(a==='quicksight:GenerateEmbedUrlForRegisteredUser'?{Condition:{'ForAllValues:StringEquals':{'quicksight:AllowedEmbeddingDomains':[origin]},Null:{'quicksight:AllowedEmbeddingDomains':'false'}}}:{})})),
 {Effect:'Allow',Action:['logs:CreateLogStream','logs:PutLogEvents'],Resource:attr('PortalLogs','Arn')},
 ]}}]}},
 PortalFunction:{Type:'AWS::Serverless::Function',Properties:{FunctionName:sub('${AWS::StackName}-app'),Runtime:'nodejs22.x',Architectures:['arm64'],Handler:'handler.handler',CodeUri:'runtime/',MemorySize:512,Timeout:30,Role:attr('PortalRole','Arn'),Environment:{Variables:{
 STATE_TABLE:ref('StateTable'),PUBLIC_ORIGIN:origin,FEISHU_APP_ID:c.feishuAppId,FEISHU_ACCESS_MODE:c.feishuAccessMode || 'tester',
 FEISHU_APP_SECRET:secret('FEISHU_APP_SECRET'),SESSION_SECRET:secret('SESSION_SECRET'),ENROLLMENT_TOKEN:secret('ENROLLMENT_TOKEN'),
 REPORT_OIDC_CLIENT_ID:c.oidc.clientId,REPORT_AUTH_READY:String(c.oidc.ready),
 }}}},
 };
 const contexts={StateTable:['Persist sessions and the per-user identities across code releases',['Retain on stack removal; do not reuse for another customer']],PortalApi:['HTTPS entry and stable callback origin',['Do not log auth query strings or embed URLs']],PortalLogs:['Runtime diagnostics without credentials',['Retain logs for 14 days']],PortalRole:['Scope generated SDK baseline to this table and configured namespace and explicit QuickSight exceptions',['No anonymous or subscription operations; embed only on application origin']],PortalFunction:['Serve frontend, Feishu gate and OIDC dashboard APIs',['Same-account commercial AWS deployment only; credentials via dynamic references']]};
 for(const [id,[why,must]]of Object.entries(contexts))resources[id].Metadata={'com.aws.cloudformation.Context':{why,must}};
 return {AWSTemplateFormatVersion:'2010-09-09',Transform:'AWS::Serverless-2016-10-31',Description:'Feishu QuickSight dashboard portal. Registered-user embedding, OIDC identity and persistent authorization; no anonymous or public access.',Metadata:{AWSToolsMetrics:{AWSAgentToolkit:'aws-cloudformation@3'}},Resources:resources,Outputs:{
 ApplicationUrl:{Value:origin},FeishuCallback:{Value:sub('https://${PortalApi}.execute-api.${AWS::Region}.${AWS::URLSuffix}/auth/callback')},ReportCallback:{Value:sub('https://${PortalApi}.execute-api.${AWS::Region}.${AWS::URLSuffix}/auth/report/callback')},FunctionName:{Value:ref('PortalFunction')},StateTableName:{Value:ref('StateTable')},
 }};
}
