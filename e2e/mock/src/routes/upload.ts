// Echoes a multipart/form-data upload back as JSON. Each part lists name,
// filename (if any), content-type, and either text content (small text
// parts) or byte length (binary uploads).

import { Hono } from 'hono';
import type { CapturedBody, CapturedMultipartPart } from '../introspection';

export function buildUploadRoutes(): Hono {
  const app = new Hono();

  app.post('/upload', (c) => {
    const body: CapturedBody = c.get('capturedBody') ?? { kind: 'empty' };
    if (body.kind !== 'multipart') {
      return c.json({ error: 'expected_multipart', got: body.kind }, { status: 400 });
    }
    const parts: CapturedMultipartPart[] = body.parts;
    return c.json({ parts });
  });

  return app;
}
