import { describe, expect, it } from 'vitest';
import { parseGraphqlSchema } from './graphqlSchemaParser';

describe('parseGraphqlSchema (SDL)', () => {
  it('extracts type names + fields', () => {
    const sdl = `
      type Query {
        user(id: ID!): User
        users: [User!]!
      }
      type User {
        id: ID!
        name: String
      }
    `;
    const info = parseGraphqlSchema(sdl, 'sdl');
    expect(info.rootTypes.query).toBe('Query');
    expect(info.types.get('Query')?.fields.map((f) => f.name)).toEqual(['user', 'users']);
    expect(info.types.get('User')?.fields.map((f) => f.name)).toEqual(['id', 'name']);
  });

  it('honors a schema { query: Foo } override', () => {
    const sdl = `
      schema { query: Root }
      type Root { hello: String }
    `;
    const info = parseGraphqlSchema(sdl, 'sdl');
    expect(info.rootTypes.query).toBe('Root');
  });

  it('captures scalars and enums', () => {
    const sdl = `
      scalar DateTime
      enum Role { ADMIN USER }
      type Query { now: DateTime }
    `;
    const info = parseGraphqlSchema(sdl, 'sdl');
    expect(info.scalars).toContain('DateTime');
    expect(info.enums).toContain('Role');
  });

  it('returns an empty info for blank input', () => {
    const info = parseGraphqlSchema('', 'sdl');
    expect(info.types.size).toBe(0);
    expect(info.rootTypes).toEqual({});
  });
});

describe('parseGraphqlSchema (introspection)', () => {
  it('walks __schema.types', () => {
    const introspection = JSON.stringify({
      __schema: {
        queryType: { name: 'Query' },
        mutationType: null,
        subscriptionType: null,
        types: [
          {
            kind: 'OBJECT',
            name: 'Query',
            fields: [
              { name: 'hello', type: { name: 'String' } },
              { name: 'user', type: { name: 'User', ofType: null } },
            ],
          },
          {
            kind: 'OBJECT',
            name: 'User',
            fields: [{ name: 'id', type: { name: 'ID' } }],
          },
          { kind: 'SCALAR', name: 'String' },
          { kind: 'ENUM', name: 'Role' },
        ],
      },
    });
    const info = parseGraphqlSchema(introspection, 'introspection');
    expect(info.rootTypes.query).toBe('Query');
    expect(info.types.get('Query')?.fields.map((f) => f.name)).toEqual(['hello', 'user']);
    expect(info.scalars).toEqual(['String']);
    expect(info.enums).toEqual(['Role']);
  });

  it('also accepts the `data: { __schema }` envelope', () => {
    const wrapped = JSON.stringify({
      data: { __schema: { queryType: { name: 'Query' }, types: [] } },
    });
    const info = parseGraphqlSchema(wrapped, 'introspection');
    expect(info.rootTypes.query).toBe('Query');
  });

  it('returns an empty info on invalid JSON', () => {
    const info = parseGraphqlSchema('{not json', 'introspection');
    expect(info.types.size).toBe(0);
  });
});
