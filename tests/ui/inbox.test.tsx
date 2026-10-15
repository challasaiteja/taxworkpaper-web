// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { SimulatedDocumentSource } from '../../src/adapters/SimulatedDocumentSource';
import type { Finding } from '../../src/core/checks/types';
import { buildIndex } from '../../src/core/graph/index';
import { InboxScreen } from '../../src/ui/screens/InboxScreen';
import { useWorkpaper } from '../../src/ui/store';
import { miniPacket } from '../fixtures/miniPacket';

const f = (over: Partial<Finding>): Finding => ({
  checkId: 'T1', key: 'k', title: 'Basis missing', severity: 'error', refs: ['ev-0001'],
  effect: { federal: -6647, california: -649, basis: 'rate' }, explain: 'Why it matters', nextAction: 'Do this', ...over,
});

function setFindings(findings: Finding[]) {
  const index = buildIndex(miniPacket());
  useWorkpaper.setState({ status: 'ready', index, docs: new SimulatedDocumentSource(index), findings });
}

describe('InboxScreen', () => {
  beforeEach(() => { window.location.hash = ''; });

  it('shows ranked findings with estimated effects and totals', () => {
    setFindings([f({}), f({ checkId: 'G7', key: 'x', title: 'Swing', severity: 'info', effect: { federal: 0, california: 0, basis: 'none' } })]);
    render(<InboxScreen />);
    expect(screen.getByText('Basis missing')).toBeTruthy();
    expect(screen.getAllByText(/−6,647/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Also noted \(1\)/)).toBeTruthy();
    expect(screen.getAllByText(/estimate/i).length).toBeGreaterThan(0);
  });

  it('expands a finding and links its evidence into the trace', () => {
    setFindings([f({})]);
    render(<InboxScreen />);
    fireEvent.click(screen.getByText('Basis missing'));
    expect(screen.getByText('Why it matters')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'ev-0001' }));
    expect(window.location.hash).toContain('trace=ev-0001');
  });

  it('says so when nothing needs attention', () => {
    setFindings([]);
    render(<InboxScreen />);
    expect(screen.getByText(/Nothing needs attention/)).toBeTruthy();
  });
});
