import serverless from 'serverless-http';
import { app } from './server.mjs';
const handle = serverless(app);
export const handler = async (event, context) => {
  // API Gateway is the only invocation source. Set trusted protocol at this boundary.
  event.headers = { ...event.headers, 'x-forwarded-proto': 'https' };
  return handle(event, context);
};
