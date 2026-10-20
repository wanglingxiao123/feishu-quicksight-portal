import { fromIni } from '@aws-sdk/credential-providers';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
export async function awsContext(c){
 const index=process.argv.indexOf('--profile'),profile=index>=0?process.argv[index+1]:process.env.AWS_PROFILE;
 if(index>=0&&!profile)throw Error('Missing --profile value');
 const options={region:c.region,...(profile?{credentials:fromIni({profile})}:{})};
 const identity=await new STSClient(options).send(new GetCallerIdentityCommand({}));
 if(identity.Account!==c.awsAccountId)throw Error('AWS identity does not match config.local.json; refusing deployment');
 return {options,profile};
}
