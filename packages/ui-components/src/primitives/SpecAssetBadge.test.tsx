import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SpecAssetMeta } from '@apicircle/shared';
import { SpecAssetBadge } from './SpecAssetBadge';

const meta = (o: Partial<SpecAssetMeta> = {}): SpecAssetMeta => ({
  dialect: 'openapi-3',
  format: 'json',
  title: 'Petstore',
  version: '1.0',
  operationCount: 3,
  parsedAt: 't',
  warnings: [],
  ...o,
});

describe('SpecAssetBadge', () => {
  it('shows the dialect and a pluralised operation count', () => {
    render(<SpecAssetBadge spec={meta()} />);
    expect(screen.getByText('OpenAPI 3 · 3 ops')).toBeInTheDocument();
  });

  it('uses the singular for a single operation', () => {
    render(<SpecAssetBadge spec={meta({ operationCount: 1 })} />);
    expect(screen.getByText('OpenAPI 3 · 1 op')).toBeInTheDocument();
  });

  it('labels Swagger 2 documents', () => {
    render(<SpecAssetBadge spec={meta({ dialect: 'swagger-2' })} />);
    expect(screen.getByText(/Swagger 2/)).toBeInTheDocument();
  });

  it('builds a descriptive aria-label with title and version', () => {
    render(<SpecAssetBadge spec={meta()} />);
    expect(
      screen.getByLabelText('API spec: Petstore · OpenAPI 3 · 3 ops · v1.0'),
    ).toBeInTheDocument();
  });

  it('drops title/version from the aria-label when absent', () => {
    render(<SpecAssetBadge spec={meta({ title: undefined, version: undefined })} />);
    expect(screen.getByLabelText('API spec: OpenAPI 3 · 3 ops')).toBeInTheDocument();
  });

  it('hides the text label in iconOnly mode but keeps the aria-label', () => {
    render(<SpecAssetBadge spec={meta()} iconOnly />);
    expect(screen.queryByText('OpenAPI 3 · 3 ops')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/API spec:/)).toBeInTheDocument();
  });
});
