// Fixed JSON tree for json-path assertion testing. Every shape the
// existing readJsonPath helper supports (dotted, bracket, nested) has a
// path that exercises it.

import { Hono } from 'hono';

export const FIXED_TREE = {
  id: 42,
  name: 'alice',
  active: true,
  rating: 4.5,
  tags: ['alpha', 'beta', 'gamma'],
  scores: [10, 20, 30],
  user: {
    id: 7,
    email: 'alice@example.test',
    address: {
      city: 'Portland',
      zip: '97201',
    },
  },
  items: [
    { id: 'a', value: 1 },
    { id: 'b', value: 2 },
    { id: 'c', value: 3 },
  ],
  nullable: null,
  empty: '',
};

export function buildJsonPathRoutes(): Hono {
  const app = new Hono();
  app.all('/json', (c) => c.json(FIXED_TREE));
  app.all('/json/:variant', (c) => {
    const variant = c.req.param('variant');
    if (variant === 'array') return c.json([{ a: 1 }, { a: 2 }, { a: 3 }]);
    if (variant === 'string') return c.json('a plain JSON string');
    if (variant === 'number') return c.json(123.456);
    if (variant === 'bool') return c.json(true);
    if (variant === 'null') return c.json(null);
    return c.json(FIXED_TREE);
  });
  return app;
}
