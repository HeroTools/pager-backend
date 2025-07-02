import { InvocationType, InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';

export const invokeLambdaFunction = async (functionName: string, payload: object, client: LambdaClient) => {
    const input = {
        FunctionName: functionName,
        InvocationType: InvocationType.Event,
        Payload: JSON.stringify(payload),
    };

    try {
        const command = new InvokeCommand(input);
        await client.send(command);
        console.log(`Successfully fired event to Lambda function: ${functionName}`);
    } catch (invokeError) {
        console.error(`Error invoking the Lambda function ${functionName}:`, invokeError);
        throw new Error(`Error invoking the Lambda function ${functionName}`);
    }
};
