import { APIGatewayProxyEventV2 } from 'aws-lambda';

export function getBaseUrl(e: APIGatewayProxyEventV2): string {
  const { domainName, stage } = e.requestContext;
  return `https://${domainName}/${stage}`;
}
