import { z } from 'zod';
import type {
  Assertion,
  Environment,
  ExecutionPlan,
  Folder,
  Request as ApiRequest,
} from '@apicircle/shared';
import { generateId } from '@apicircle/shared';
import type { AnyToolDef } from './types';

// =============================================================================
// CRUD tool definitions for every workspace entity. Reads always go through
// `workspace.read()`; writes always go through `workspace.apply(patch)` so the
// mutation API in @apicircle/core is the single semantic source of truth.
// =============================================================================

const HTTP_METHOD = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const requestCreateTool: AnyToolDef = {
  name: 'request.create',
  description: 'Create a new request from explicit fields and persist it.',
  inputSchema: z.object({
    name: z.string().default('New request'),
    method: HTTP_METHOD.default('GET'),
    url: z.string().default(''),
    folderId: z.string().nullable().optional(),
  }),
  async handler(input, ctx) {
    const now = new Date().toISOString();
    const request: ApiRequest = {
      id: generateId(),
      name: input.name,
      folderId: input.folderId ?? null,
      method: input.method,
      url: input.url,
      headers: [],
      query: [],
      body: { type: 'none', content: '' },
      // Default to `inherit` so requests created via MCP inside a folder
      // pick up folder auth automatically. Mirrors editorActions.createRequest.
      auth: { type: 'inherit' },
      contextVars: [],
      extractions: [],
      assertions: [],
      createdAt: now,
      updatedAt: now,
    };
    const out = await ctx.workspace.apply({ kind: 'request.create', request });
    return { id: request.id, changedIds: out.changedIds };
  },
};

export const requestReadTool: AnyToolDef = {
  name: 'request.read',
  description:
    'Read a request by id, or list summaries (id, name, method, url) when no id is provided.',
  inputSchema: z.object({ id: z.string().optional() }),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    if (input.id) {
      const req = state.synced.collections.requests[input.id];
      if (!req) return { found: false };
      return { found: true, request: req };
    }
    const list = Object.values(state.synced.collections.requests).map((r) => ({
      id: r.id,
      name: r.name,
      method: r.method,
      url: r.url,
      folderId: r.folderId,
    }));
    return { count: list.length, requests: list };
  },
};

export const requestUpdateTool: AnyToolDef = {
  name: 'request.update',
  description: 'Patch fields on an existing request.',
  inputSchema: z.object({
    id: z.string(),
    patch: z
      .object({
        name: z.string().optional(),
        method: HTTP_METHOD.optional(),
        url: z.string().optional(),
        folderId: z.string().nullable().optional(),
      })
      .strict(),
  }),
  async handler(input, ctx) {
    const out = await ctx.workspace.apply({
      kind: 'request.update',
      id: input.id,
      patch: input.patch as Partial<Omit<ApiRequest, 'id' | 'createdAt'>>,
    });
    return { changedIds: out.changedIds };
  },
};

export const requestDeleteTool: AnyToolDef = {
  name: 'request.delete',
  description: 'Delete a request by id.',
  inputSchema: z.object({ id: z.string() }),
  async handler(input, ctx) {
    const out = await ctx.workspace.apply({ kind: 'request.delete', id: input.id });
    return { changedIds: out.changedIds };
  },
};

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

export const folderCreateTool: AnyToolDef = {
  name: 'folder.create',
  description: 'Create a folder under an optional parent folder.',
  inputSchema: z.object({
    name: z.string().default('New folder'),
    parentId: z.string().nullable().optional(),
  }),
  async handler(input, ctx) {
    const folder: Folder = {
      id: generateId(),
      name: input.name,
      parentId: input.parentId ?? null,
    };
    const out = await ctx.workspace.apply({ kind: 'folder.create', folder });
    return { id: folder.id, changedIds: out.changedIds };
  },
};

export const folderReadTool: AnyToolDef = {
  name: 'folder.read',
  description: 'Read a folder by id, or list all folders when no id is provided.',
  inputSchema: z.object({ id: z.string().optional() }),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    if (input.id) {
      const folder = state.synced.collections.folders[input.id];
      return folder ? { found: true, folder } : { found: false };
    }
    return {
      count: Object.keys(state.synced.collections.folders).length,
      folders: Object.values(state.synced.collections.folders),
    };
  },
};

export const folderUpdateTool: AnyToolDef = {
  name: 'folder.update',
  description: 'Move a folder to a new parent (or to root with parentId: null).',
  inputSchema: z.object({
    id: z.string(),
    parentId: z.string().nullable(),
  }),
  async handler(input, ctx) {
    const out = await ctx.workspace.apply({
      kind: 'folder.move',
      id: input.id,
      newParentId: input.parentId,
    });
    return { changedIds: out.changedIds };
  },
};

export const folderDeleteTool: AnyToolDef = {
  name: 'folder.delete',
  description:
    "Delete a folder. Direct children (sub-folders + requests) are reparented to the deleted folder's parent.",
  inputSchema: z.object({ id: z.string() }),
  async handler(input, ctx) {
    const out = await ctx.workspace.apply({ kind: 'folder.delete', id: input.id });
    return { changedIds: out.changedIds };
  },
};

// ---------------------------------------------------------------------------
// Environments
// ---------------------------------------------------------------------------

const VARIABLE = z.object({
  key: z.string(),
  value: z.string(),
  encrypted: z.boolean().default(false),
});

export const environmentCreateTool: AnyToolDef = {
  name: 'environment.create',
  description: 'Create a new environment (or upsert one with the same name).',
  inputSchema: z.object({
    name: z.string(),
    variables: z.array(VARIABLE).default([]),
  }),
  async handler(input, ctx) {
    const env: Environment = { name: input.name, variables: input.variables };
    const out = await ctx.workspace.apply({ kind: 'environment.upsert', environment: env });
    return { name: env.name, changedIds: out.changedIds };
  },
};

export const environmentReadTool: AnyToolDef = {
  name: 'environment.read',
  description: 'Read environments — pass `name` for one, or omit for the full list.',
  inputSchema: z.object({ name: z.string().optional() }),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    if (input.name) {
      const env = state.synced.environments.items[input.name];
      return env ? { found: true, environment: env } : { found: false };
    }
    return {
      activeName: state.synced.environments.activeName,
      priorityOrder: state.synced.environments.priorityOrder,
      environments: Object.values(state.synced.environments.items),
    };
  },
};

export const environmentUpdateTool: AnyToolDef = {
  name: 'environment.update',
  description: 'Replace the variables list of an environment.',
  inputSchema: z.object({
    name: z.string(),
    variables: z.array(VARIABLE),
  }),
  async handler(input, ctx) {
    const out = await ctx.workspace.apply({
      kind: 'environment.upsert',
      environment: { name: input.name, variables: input.variables },
    });
    return { changedIds: out.changedIds };
  },
};

export const environmentDeleteTool: AnyToolDef = {
  name: 'environment.delete',
  description: 'Delete an environment by name.',
  inputSchema: z.object({ name: z.string() }),
  async handler(input, ctx) {
    const out = await ctx.workspace.apply({ kind: 'environment.delete', name: input.name });
    return { changedIds: out.changedIds };
  },
};

export const environmentSetActiveTool: AnyToolDef = {
  name: 'environment.set_active',
  description:
    'Set (or clear) the active environment. Pass `name: null` to deactivate the current environment.',
  inputSchema: z.object({ name: z.string().nullable() }),
  async handler(input, ctx) {
    const out = await ctx.workspace.apply({
      kind: 'environment.setActive',
      name: input.name,
    });
    return { changedIds: out.changedIds };
  },
};

export const environmentSetPriorityTool: AnyToolDef = {
  name: 'environment.set_priority',
  description:
    'Replace the global environment priority order (highest priority first). Names not in the list keep their current relative order at the end of the priority list.',
  inputSchema: z.object({ order: z.array(z.string()) }),
  async handler(input, ctx) {
    const out = await ctx.workspace.apply({
      kind: 'environment.setPriority',
      order: input.order,
    });
    return { changedIds: out.changedIds };
  },
};

export const environmentExportTool: AnyToolDef = {
  name: 'environment.export',
  description:
    'Serialize an environment to a portable JSON string. Encrypted variables drop their value (only `secretKeyId` survives) so the export can be safely pasted elsewhere — re-attach secrets locally on the receiving side.',
  inputSchema: z.object({ name: z.string() }),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    const env = state.synced.environments.items[input.name];
    if (!env) return { ok: false as const, error: 'environment not found' as const };
    const payload = {
      apicircleEnvironment: 1 as const,
      name: env.name,
      variables: env.variables.map((v) =>
        v.encrypted && v.secretKeyId
          ? { key: v.key, encrypted: true as const, secretKeyId: v.secretKeyId }
          : { key: v.key, value: v.value, encrypted: false as const },
      ),
    };
    return { ok: true as const, json: JSON.stringify(payload, null, 2) };
  },
};

export const environmentImportTool: AnyToolDef = {
  name: 'environment.import',
  description:
    'Import an environment from the JSON shape produced by `environment.export`. When a target with the same name exists, pass `overwrite: true` to replace it, otherwise the import is rejected.',
  inputSchema: z.object({
    json: z.string().min(1),
    overwrite: z.boolean().default(false),
  }),
  async handler(input, ctx) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.json);
    } catch {
      return { ok: false as const, error: 'invalid JSON' as const };
    }
    const obj = parsed as {
      apicircleEnvironment?: number;
      name?: string;
      variables?: Array<
        | { key: string; encrypted: true; secretKeyId: string }
        | { key: string; encrypted: false; value: string }
      >;
    };
    if (
      obj.apicircleEnvironment !== 1 ||
      typeof obj.name !== 'string' ||
      !Array.isArray(obj.variables)
    ) {
      return { ok: false as const, error: 'unsupported export shape' as const };
    }
    const state = await ctx.workspace.read();
    if (state.synced.environments.items[obj.name] && !input.overwrite) {
      return {
        ok: false as const,
        error: 'environment already exists; pass overwrite:true' as const,
      };
    }
    const env: Environment = {
      name: obj.name,
      variables: obj.variables.map((v) =>
        v.encrypted
          ? { key: v.key, value: '', encrypted: true, secretKeyId: v.secretKeyId }
          : { key: v.key, value: v.value, encrypted: false },
      ),
    };
    const out = await ctx.workspace.apply({ kind: 'environment.upsert', environment: env });
    return { ok: true as const, name: env.name, changedIds: out.changedIds };
  },
};

// ---------------------------------------------------------------------------
// Execution plans
// ---------------------------------------------------------------------------

const PLAN_STEP = z.object({
  requestId: z.string(),
  linkedWorkspaceId: z.string().optional(),
});

export const planCreateTool: AnyToolDef = {
  name: 'plan.create',
  description: 'Create a new execution plan (sequence of request steps).',
  inputSchema: z.object({
    name: z.string().default('New plan'),
    steps: z.array(PLAN_STEP).default([]),
    envPriorityOrder: z.array(z.string()).default([]),
  }),
  async handler(input, ctx) {
    const id = generateId();
    const now = new Date().toISOString();
    const plan: ExecutionPlan = {
      id,
      name: input.name,
      steps: input.steps,
      envPriorityOrder: input.envPriorityOrder,
      createdAt: now,
      updatedAt: now,
    };
    const out = await ctx.workspace.apply({ kind: 'plan.upsert', plan });
    return { id, changedIds: out.changedIds };
  },
};

export const planReadTool: AnyToolDef = {
  name: 'plan.read',
  description: 'Read a plan by id, or list all plans when no id is provided.',
  inputSchema: z.object({ id: z.string().optional() }),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    if (input.id) {
      const plan = state.local.executionPlans[input.id];
      return plan ? { found: true, plan } : { found: false };
    }
    return {
      count: Object.keys(state.local.executionPlans).length,
      plans: Object.values(state.local.executionPlans),
    };
  },
};

export const planUpdateTool: AnyToolDef = {
  name: 'plan.update',
  description: 'Patch fields on an existing plan.',
  inputSchema: z.object({
    id: z.string(),
    patch: z
      .object({
        name: z.string().optional(),
        steps: z.array(PLAN_STEP).optional(),
        envPriorityOrder: z.array(z.string()).optional(),
      })
      .strict(),
  }),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    const existing = state.local.executionPlans[input.id];
    if (!existing) return { changedIds: [] };
    const merged: ExecutionPlan = {
      ...existing,
      ...input.patch,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    const out = await ctx.workspace.apply({ kind: 'plan.upsert', plan: merged });
    return { changedIds: out.changedIds };
  },
};

export const planDeleteTool: AnyToolDef = {
  name: 'plan.delete',
  description: 'Delete a plan by id. Drops history rows referencing this plan.',
  inputSchema: z.object({ id: z.string() }),
  async handler(input, ctx) {
    const out = await ctx.workspace.apply({ kind: 'plan.delete', id: input.id });
    return { changedIds: out.changedIds };
  },
};

// Granular plan-step operations. Each fetches the plan, mutates the steps
// array, and writes the whole plan back via `plan.upsert` — keeping
// applyMutation patches as the single source of truth.

export const planAddStepTool: AnyToolDef = {
  name: 'plan.add_step',
  description:
    'Append a step to an execution plan. Optional `position` (0-based) inserts at that index instead.',
  inputSchema: z.object({
    planId: z.string(),
    requestId: z.string(),
    linkedWorkspaceId: z.string().optional(),
    position: z.number().int().nonnegative().optional(),
  }),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    const plan = state.local.executionPlans[input.planId];
    if (!plan) return { ok: false as const, error: 'plan not found' as const };
    const step = {
      requestId: input.requestId,
      ...(input.linkedWorkspaceId ? { linkedWorkspaceId: input.linkedWorkspaceId } : {}),
    };
    const steps = [...plan.steps];
    if (input.position !== undefined && input.position <= steps.length) {
      steps.splice(input.position, 0, step);
    } else {
      steps.push(step);
    }
    const out = await ctx.workspace.apply({
      kind: 'plan.upsert',
      plan: { ...plan, steps, updatedAt: new Date().toISOString() },
    });
    return { ok: true as const, changedIds: out.changedIds };
  },
};

export const planRemoveStepTool: AnyToolDef = {
  name: 'plan.remove_step',
  description: 'Remove a step from a plan by 0-based index.',
  inputSchema: z.object({
    planId: z.string(),
    index: z.number().int().nonnegative(),
  }),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    const plan = state.local.executionPlans[input.planId];
    if (!plan) return { ok: false as const, error: 'plan not found' as const };
    if (input.index >= plan.steps.length) {
      return { ok: false as const, error: 'index out of range' as const };
    }
    const steps = plan.steps.filter((_, i) => i !== input.index);
    const out = await ctx.workspace.apply({
      kind: 'plan.upsert',
      plan: { ...plan, steps, updatedAt: new Date().toISOString() },
    });
    return { ok: true as const, changedIds: out.changedIds };
  },
};

export const planReorderStepsTool: AnyToolDef = {
  name: 'plan.reorder_steps',
  description:
    'Replace the plan steps with a new permutation. The supplied indices must reference valid current step indices.',
  inputSchema: z.object({
    planId: z.string(),
    order: z.array(z.number().int().nonnegative()),
  }),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    const plan = state.local.executionPlans[input.planId];
    if (!plan) return { ok: false as const, error: 'plan not found' as const };
    if (input.order.length !== plan.steps.length) {
      return { ok: false as const, error: 'order length must equal step count' as const };
    }
    const order: number[] = input.order;
    const seen = new Set(order);
    if (seen.size !== order.length || order.some((i: number) => i >= plan.steps.length)) {
      return { ok: false as const, error: 'order must be a permutation of step indices' as const };
    }
    const steps = order.map((i: number) => plan.steps[i]);
    const out = await ctx.workspace.apply({
      kind: 'plan.upsert',
      plan: { ...plan, steps, updatedAt: new Date().toISOString() },
    });
    return { ok: true as const, changedIds: out.changedIds };
  },
};

const PLAN_VARIABLE = z.object({ key: z.string(), value: z.string() });

export const planSetVariablesTool: AnyToolDef = {
  name: 'plan.set_variables',
  description:
    'Replace the plan-scoped variables. These live highest-priority during plan runs (above environment vars, below context vars).',
  inputSchema: z.object({
    planId: z.string(),
    variables: z.array(PLAN_VARIABLE),
  }),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    const plan = state.local.executionPlans[input.planId];
    if (!plan) return { ok: false as const, error: 'plan not found' as const };
    const out = await ctx.workspace.apply({
      kind: 'plan.upsert',
      plan: { ...plan, variables: input.variables, updatedAt: new Date().toISOString() },
    });
    return { ok: true as const, changedIds: out.changedIds };
  },
};

export const planRunTool: AnyToolDef = {
  name: 'plan.run',
  description:
    'Run a plan headlessly (server-side). Currently returns a not-implemented marker — full execution requires the Desktop or browser runtime which the MCP host does not own. The Desktop integration overrides this tool with a real runner.',
  inputSchema: z.object({
    id: z.string(),
    withAssertions: z.boolean().default(true),
  }),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    const plan = state.local.executionPlans[input.id];
    if (!plan) return { ok: false, error: 'plan not found' };
    return {
      ok: false,
      error:
        'Plan execution is only available in the Desktop app (or once a hosted runtime is wired). The plan exists and is ready to run from the UI.',
      planId: plan.id,
      stepCount: plan.steps.length,
    };
  },
};

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

const ASSERTION = z.object({
  id: z.string().optional(),
  kind: z.enum(['status', 'header', 'json-path', 'duration']),
  op: z.enum(['equals', 'not-equals', 'contains', 'lt', 'gt', 'matches']),
  target: z.string().optional(),
  expected: z.union([z.string(), z.number()]),
});

export const assertionCreateTool: AnyToolDef = {
  name: 'assertion.create',
  description: 'Add an assertion to a request.',
  inputSchema: z.object({
    requestId: z.string(),
    assertion: ASSERTION,
  }),
  async handler(input, ctx) {
    const assertion: Assertion = {
      ...input.assertion,
      id: input.assertion.id ?? generateId(),
    } as Assertion;
    const out = await ctx.workspace.apply({
      kind: 'assertion.upsert',
      requestId: input.requestId,
      assertion,
    });
    return { id: assertion.id, changedIds: out.changedIds };
  },
};

export const assertionReadTool: AnyToolDef = {
  name: 'assertion.read',
  description: 'List assertions for a request, or fetch a single assertion by id.',
  inputSchema: z.object({
    requestId: z.string(),
    assertionId: z.string().optional(),
  }),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    const req = state.synced.collections.requests[input.requestId];
    if (!req) return { found: false };
    if (input.assertionId) {
      const a = req.assertions.find((x) => x.id === input.assertionId);
      return a ? { found: true, assertion: a } : { found: false };
    }
    return { count: req.assertions.length, assertions: req.assertions };
  },
};

export const assertionUpdateTool: AnyToolDef = {
  name: 'assertion.update',
  description: 'Replace an existing assertion (matched by `assertion.id`).',
  inputSchema: z.object({
    requestId: z.string(),
    assertion: ASSERTION.required({ id: true }),
  }),
  async handler(input, ctx) {
    const out = await ctx.workspace.apply({
      kind: 'assertion.upsert',
      requestId: input.requestId,
      assertion: input.assertion as Assertion,
    });
    return { changedIds: out.changedIds };
  },
};

export const assertionDeleteTool: AnyToolDef = {
  name: 'assertion.delete',
  description: 'Remove an assertion from a request.',
  inputSchema: z.object({
    requestId: z.string(),
    assertionId: z.string(),
  }),
  async handler(input, ctx) {
    const out = await ctx.workspace.apply({
      kind: 'assertion.delete',
      requestId: input.requestId,
      assertionId: input.assertionId,
    });
    return { changedIds: out.changedIds };
  },
};

// ---------------------------------------------------------------------------
// Workspace bulk read / write
// ---------------------------------------------------------------------------

export const workspaceReadTool: AnyToolDef = {
  name: 'workspace.read',
  description:
    'Return the full `{ synced, local }` workspace pair. Use sparingly — entity-specific tools are more efficient for small reads.',
  inputSchema: z.object({}),
  async handler(_input, ctx) {
    return await ctx.workspace.read();
  },
};

export const workspaceWriteTool: AnyToolDef = {
  name: 'workspace.write',
  description:
    'Bulk-replace the workspace. Pass `synced` and/or `local` to overwrite either side. Mutating tools are preferred — this is for full-doc imports/exports.',
  inputSchema: z.object({
    synced: z.unknown().optional(),
    local: z.unknown().optional(),
  }),
  async handler(input, ctx) {
    const next = await ctx.workspace.write({
      synced: input.synced as Parameters<typeof ctx.workspace.write>[0]['synced'],
      local: input.local as Parameters<typeof ctx.workspace.write>[0]['local'],
    });
    return { workspaceId: next.synced.workspaceId, ok: true };
  },
};
