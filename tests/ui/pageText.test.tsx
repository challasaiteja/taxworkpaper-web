// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SimulatedDocumentSource } from '../../src/adapters/SimulatedDocumentSource';
import { buildIndex } from '../../src/core/graph/index';
import { PageText } from '../../src/ui/components/PageText';
import { miniPacket } from '../fixtures/miniPacket';

describe('PageText', () => {
  it('renders highlights as clickable marks and lists unprinted values', () => {
    const view = new SimulatedDocumentSource(buildIndex(miniPacket())).getPage('D02', 2)!;
    const onSelect = vi.fn();
    render(<PageText view={view} onSelect={onSelect} />);
    fireEvent.click(screen.getByTitle('ev-0003 · Interest'));
    expect(onSelect).toHaveBeenCalledWith('ev-0003');
    expect(screen.getByText(/Not printed on this page/)).toBeTruthy();
    expect(screen.getByText(/Basis/)).toBeTruthy();
  });

  it('lists values it could not locate separately from unprinted ones', () => {
    const view = new SimulatedDocumentSource(buildIndex(miniPacket())).getPage('D01', 1)!;
    render(<PageText view={view} onSelect={vi.fn()} />);
    expect(screen.getByText(/Could not locate on this page/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retirement plan = Yes' })).toBeTruthy();
    expect(screen.queryByText(/Not printed on this page/)).toBeNull();
  });

  it('never drops a value: shared occurrences render one mark naming every value', () => {
    const view = new SimulatedDocumentSource(buildIndex(miniPacket())).getPage('D03', 1)!;
    const onSelect = vi.fn();
    render(<PageText view={view} selectedEvId="ev-0014" onSelect={onSelect} />);
    const mark = screen.getByTitle(/ev-0013 · Total basis\sev-0014 · Summary total/);
    expect(mark.className).toMatch(/amber-300/);
    fireEvent.click(mark);
    expect(onSelect).toHaveBeenCalledWith('ev-0014');
  });
});
