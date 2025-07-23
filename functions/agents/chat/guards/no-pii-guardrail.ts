import { Agent, OutputGuardrail, run } from '@openai/agents';
import { z } from 'zod';

const piiGuardrailSchema = z.object({
  isPii: z.boolean(),
  reasoning: z.string(),
});

const MessageOutput = z.object({ response: z.string() });

export const piiGuardrailAgent = new Agent({
  name: 'Pii Guardrail Check',
  instructions: `You are a PII detection specialist. Analyze the given text and determine if it contains any personally identifiable information that should not be shared in a workplace chat context.

    Be especially careful about:
    - Personal contact information
    - Financial information
    - Authentication credentials
    - Private personal details

    Return your analysis with a clear safety determination.`,
  outputType: piiGuardrailSchema,
});

export const piiGuardrail: OutputGuardrail<typeof MessageOutput> = {
  name: 'pii_guardrail',
  async execute({ agentOutput, context }) {
    const result = await run(piiGuardrailAgent, agentOutput.response, {
      context,
    });
    return {
      outputInfo: result.finalOutput,
      tripwireTriggered: result.finalOutput?.isPii ?? false,
    };
  },
};
