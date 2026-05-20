import { z } from 'zod';
import type { AnyToolDef } from './types';

// =============================================================================
// codebase.extract_collection — heuristic detector that walks a chunk of
// source code (passed in by the AI client) and returns candidate request
// shapes. The MCP host doesn't have filesystem access by itself; this tool
// lets the AI orchestrate a `read files → extract → confirm with user →
// import` pipeline.
//
// Currently detects:
//   • Express  — `app.METHOD(`, `router.METHOD(`
//   • FastAPI  — `@app.METHOD(`, `@router.METHOD(`
//   • Spring   — `@GetMapping`, `@PostMapping`, `@PutMapping`, `@DeleteMapping`,
//                `@PatchMapping`, `@RequestMapping(method=...)`
//   • NestJS   — `@Get(`, `@Post(`, `@Put(`, `@Patch(`, `@Delete(`
//
// All matches are surfaced as `{ method, path, framework, line }`. The AI
// then asks the user to confirm and follows up with `request.create` calls.
// =============================================================================

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];

interface Candidate {
  method: string;
  path: string;
  framework: 'express' | 'fastapi' | 'nest' | 'spring';
  line: number;
}

export const codebaseExtractCollectionTool: AnyToolDef = {
  name: 'codebase.extract_collection',
  description:
    'Scan source code for HTTP route definitions (Express, FastAPI, NestJS, Spring) and return candidate requests for the user to confirm before import.',
  inputSchema: z.object({
    source: z.string().min(1),
    /** Hint to limit which framework patterns to apply. Empty = try all. */
    frameworks: z.array(z.enum(['express', 'fastapi', 'nest', 'spring'])).default([]),
  }),
  async handler(input) {
    const enabled = new Set(
      input.frameworks.length ? input.frameworks : ['express', 'fastapi', 'nest', 'spring'],
    );
    const candidates: Candidate[] = [];
    const lines = input.source.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (enabled.has('express')) {
        const m =
          /(?:^|[\s\b])(?:app|router)\.(get|post|put|patch|delete|options|head)\s*\(\s*['"`]([^'"`]+)['"`]/i.exec(
            line,
          );
        if (m) {
          candidates.push({
            method: m[1].toUpperCase(),
            path: m[2],
            framework: 'express',
            line: i + 1,
          });
          continue;
        }
      }
      if (enabled.has('fastapi')) {
        const m =
          /@(?:app|router)\.(get|post|put|patch|delete|options|head)\s*\(\s*['"`]([^'"`]+)['"`]/i.exec(
            line,
          );
        if (m) {
          candidates.push({
            method: m[1].toUpperCase(),
            path: m[2],
            framework: 'fastapi',
            line: i + 1,
          });
          continue;
        }
      }
      if (enabled.has('nest')) {
        const m = /@(Get|Post|Put|Patch|Delete|Options|Head)\s*\(\s*['"`]([^'"`]*)['"`]\s*\)/i.exec(
          line,
        );
        if (m) {
          candidates.push({
            method: m[1].toUpperCase(),
            path: m[2] || '/',
            framework: 'nest',
            line: i + 1,
          });
          continue;
        }
      }
      if (enabled.has('spring')) {
        const verb = /@(Get|Post|Put|Patch|Delete)Mapping\s*\(?\s*['"`]?([^'"`)\s]*)/i.exec(line);
        if (verb && HTTP_METHODS.includes(verb[1].toLowerCase())) {
          candidates.push({
            method: verb[1].toUpperCase(),
            path: verb[2] || '/',
            framework: 'spring',
            line: i + 1,
          });
          continue;
        }
        const generic =
          /@RequestMapping\s*\(\s*[^)]*method\s*=\s*RequestMethod\.(GET|POST|PUT|PATCH|DELETE)[^)]*?(?:value|path)?\s*=?\s*['"`]?([^'"`)\s,]*)/i.exec(
            line,
          );
        if (generic) {
          candidates.push({
            method: generic[1].toUpperCase(),
            path: generic[2] || '/',
            framework: 'spring',
            line: i + 1,
          });
        }
      }
    }
    return { count: candidates.length, candidates };
  },
};
