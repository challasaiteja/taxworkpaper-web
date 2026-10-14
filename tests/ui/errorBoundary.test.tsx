// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../../src/ui/ErrorBoundary';

function Boom(): never {
  throw new Error('bad packet shape');
}

describe('ErrorBoundary', () => {
  it('shows the error instead of a blank screen', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByRole('alert').textContent).toMatch(/bad packet shape/);
    expect(screen.getByRole('button', { name: /Reload/ })).toBeTruthy();
  });
});
