import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SchemaView, describeType } from './SchemaView';

describe('describeType', () => {
  it('reads a plain type', () => {
    expect(describeType({ type: 'string' })).toEqual({ type: 'string', nullable: false });
  });

  it('spells out the nullable widening the contract tooling emits', () => {
    // `['string','null']` is how a nullable field is encoded; a reader should see
    // "string" + nullable, not "string or null" buried in a type union.
    expect(describeType({ type: ['string', 'null'] })).toEqual({ type: 'string', nullable: true });
  });

  it('infers a shape when `type` is absent', () => {
    expect(describeType({ properties: {} }).type).toBe('object');
    expect(describeType({ items: {} }).type).toBe('array');
    expect(describeType({ enum: ['a'] }).type).toBe('enum');
  });

  it('calls the unresolved empty schema "any" rather than pretending it is an object', () => {
    // `{}` validates nothing. Saying "object" here would be a false reassurance.
    expect(describeType({})).toEqual({ type: 'any', nullable: false });
  });

  it('keeps a genuine union readable', () => {
    expect(describeType({ type: ['string', 'number'] })).toEqual({
      type: 'string or number',
      nullable: false,
    });
  });
});

describe('SchemaView', () => {
  const orderSchema = {
    type: 'object',
    properties: {
      id: { type: 'integer' },
      contact: { type: 'string', format: 'email' },
      note: { type: ['string', 'null'] },
      status: { enum: ['open', 'closed'] },
      lines: {
        type: 'array',
        items: {
          type: 'object',
          properties: { sku: { type: 'string' } },
          required: ['sku'],
        },
      },
    },
    required: ['id', 'contact'],
    additionalProperties: false,
  };

  it('lists each field with its type, and marks required vs optional', () => {
    // Collapsed, so the count below is the top level's own required fields and
    // not a nested item's (the default depth would expand `lines` too).
    render(<SchemaView schema={orderSchema} openDepth={0} />);
    expect(screen.getByText('id')).toBeInTheDocument();
    expect(screen.getByText('contact')).toBeInTheDocument();
    expect(screen.getAllByText('required')).toHaveLength(2);
    // Optional is stated, not merely implied by the absence of "required".
    expect(screen.getAllByText('optional').length).toBeGreaterThan(0);
    expect(screen.getByText('integer')).toBeInTheDocument();
  });

  it('surfaces constraints a reader would otherwise have to find in the JSON', () => {
    render(<SchemaView schema={orderSchema} />);
    // The `email` format is surfaced as a chip — it is a constraint a reader
    // would otherwise have to dig out of the raw JSON.
    expect(screen.getByText('email')).toBeInTheDocument();
    expect(screen.getByText('open | closed')).toBeInTheDocument();
    expect(screen.getByText('nullable')).toBeInTheDocument();
    expect(screen.getByText('Extra fields are not allowed.')).toBeInTheDocument();
  });

  it('expands a nested array-of-objects on demand', async () => {
    render(<SchemaView schema={orderSchema} openDepth={0} />);
    // `lines` is nested, so its item fields start collapsed.
    expect(screen.queryByText('sku')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Expand lines' }));
    expect(screen.getByText('each item')).toBeInTheDocument();
    expect(screen.getByText('sku')).toBeInTheDocument();
    // And it collapses again.
    await userEvent.click(screen.getByRole('button', { name: 'Collapse lines' }));
    expect(screen.queryByText('sku')).toBeNull();
  });

  it('renders an array of primitives without inventing a field name', () => {
    render(<SchemaView schema={{ type: 'array', items: { type: 'string' } }} />);
    const group = screen.getByRole('group', { name: 'Schema' });
    expect(within(group).getByText('each item')).toBeInTheDocument();
    expect(within(group).getByText('string')).toBeInTheDocument();
  });

  it('says plainly when the shape is unresolved', () => {
    render(<SchemaView schema={{}} />);
    expect(screen.getByText(/Any shape — this validates nothing yet/)).toBeInTheDocument();
  });

  it('renders a bare primitive as a single line', () => {
    render(<SchemaView schema={{ type: 'boolean' }} />);
    expect(screen.getByText('Value')).toBeInTheDocument();
    expect(screen.getByText('boolean')).toBeInTheDocument();
  });

  it('degrades instead of throwing when the value is not a schema object', () => {
    render(<SchemaView schema={'nope'} />);
    expect(screen.getByText(/not an object, so there are no fields to show/)).toBeInTheDocument();
  });

  it('states when an object describes no fields at all', () => {
    render(<SchemaView schema={{ type: 'object', properties: {} }} />);
    expect(screen.getByText('No fields described.')).toBeInTheDocument();
  });

  it('takes an accessible name so two schemas on one screen are distinguishable', () => {
    render(<SchemaView schema={orderSchema} label="Response body" />);
    expect(screen.getByRole('group', { name: 'Response body' })).toBeInTheDocument();
  });
});
