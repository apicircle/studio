import { z } from 'zod';
import type { Assertion, Environment, ExecutionPlan } from '@apicircle/shared';
import { generateId } from '@apicircle/shared';
import type { AnyToolDef } from './types';

// =============================================================================
// Prompt-driven authoring tools. The AI client converts the user's natural-
// language request into JSON matching the schemas below; the server validates
// + persists. The actual NL → JSON conversion happens client-side in the AI's
// own model, not here.
// =============================================================================

export const promptCreateEnvironmentTool: AnyToolDef = {
  name: 'prompt.create_environment',
  description:
    'Create a new environment from an LLM-shaped JSON envelope. The model produces { name, variables: [{ key, value, encrypted }] }; this tool validates and persists it.',
  inputSchema: z.object({
    name: z.string(),
    variables: z.array(
      z.object({
        key: z.string(),
        value: z.string(),
        encrypted: z.boolean().default(false),
      }),
    ),
  }),
  async handler(input, ctx) {
    const env: Environment = { name: input.name, variables: input.variables };
    const out = await ctx.workspace.apply({ kind: 'environment.upsert', environment: env });
    return { name: env.name, changedIds: out.changedIds };
  },
};

export const promptCreateAssertionTool: AnyToolDef = {
  name: 'prompt.create_assertion',
  description:
    'Add an assertion to a request from an LLM-shaped JSON envelope. Useful when the user asks "assert that the response status is 200 and body.id matches".',
  inputSchema: z.object({
    requestId: z.string(),
    assertion: z.object({
      kind: z.enum(['status', 'header', 'json-path', 'duration']),
      op: z.enum(['equals', 'not-equals', 'contains', 'lt', 'gt', 'matches']),
      target: z.string().optional(),
      expected: z.union([z.string(), z.number()]),
    }),
  }),
  async handler(input, ctx) {
    const assertion: Assertion = {
      ...input.assertion,
      id: generateId(),
    } as Assertion;
    const out = await ctx.workspace.apply({
      kind: 'assertion.upsert',
      requestId: input.requestId,
      assertion,
    });
    return { id: assertion.id, changedIds: out.changedIds };
  },
};

export const promptCreatePlanTool: AnyToolDef = {
  name: 'prompt.create_plan',
  description:
    'Create an execution plan from an LLM-shaped JSON envelope. The model produces { name, stepRequestIds: [...] } and the tool validates that each id exists in the workspace before persisting.',
  inputSchema: z.object({
    name: z.string(),
    stepRequestIds: z.array(z.string()).default([]),
    envPriorityOrder: z.array(z.string()).default([]),
  }),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    const missing: string[] = [];
    for (const rid of input.stepRequestIds) {
      if (!state.synced.collections.requests[rid]) missing.push(rid);
    }
    if (missing.length) {
      return {
        ok: false,
        error: `Unknown request ids: ${missing.join(', ')}`,
        missing,
      };
    }
    const id = generateId();
    const now = new Date().toISOString();
    const plan: ExecutionPlan = {
      id,
      name: input.name,
      steps: input.stepRequestIds.map((requestId: string) => ({ requestId })),
      envPriorityOrder: input.envPriorityOrder,
      createdAt: now,
      updatedAt: now,
    };
    const out = await ctx.workspace.apply({ kind: 'plan.upsert', plan });
    return { ok: true, id, changedIds: out.changedIds };
  },
};
