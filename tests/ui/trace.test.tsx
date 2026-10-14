// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { SimulatedDocumentSource } from '../../src/adapters/SimulatedDocumentSource';
import { buildIndex } from '../../src/core/graph/index';
import { useWorkpaper } from '../../src/ui/store';
import { TraceDrawer } from '../../src/ui/trace/TraceDrawer';
import { miniPacket } from '../fixtures/miniPacket';

beforeEach(() => {
  const index = buildIndex(miniPacket());
  useWorkpaper.setState({ status: 'ready', index, docs: new SimulatedDocumentSource(index) });
});

describe('TraceDrawer', () => {
  it('shows how a line was built down to its source documents', () => {
    render(<TraceDrawer refId="line:v1/F1040.11" />);
    expect(screen.getAllByText('Adjusted gross income').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/R-SUM/).length).toBeGreaterThan(0);
    expect(screen.getByText('Wages')).toBeTruthy();
    expect(screen.getByText(/D01 · W-2 Acme/)).toBeTruthy();
  });

  it('shows an extracted value with its highlighted page and where it landed', () => {
    render(<TraceDrawer refId="ev-0003" />);
    expect(screen.getByTitle('ev-0003 · Interest')).toBeTruthy();
    expect(screen.getByText(/line:v1\/SchB\.1\.1/)).toBeTruthy();
  });

  it('says where a value did not land', () => {
    render(<TraceDrawer refId="ev-0004" />);
    expect(screen.getByText(/Not used by any line/)).toBeTruthy();
  });

  it('handles an unknown ref', () => {
    render(<TraceDrawer refId="ev-9999" />);
    expect(screen.getByText(/Unknown reference/)).toBeTruthy();
  });

  it('does not crash when a value points at a missing document', () => {
    const packet = miniPacket();
    packet.extracted_values[0]!.document_id = 'D77';
    const index = buildIndex(packet);
    useWorkpaper.setState({ status: 'ready', index, docs: new SimulatedDocumentSource(index) });
    render(<TraceDrawer refId="ev-0001" />);
    expect(screen.getByText(/document D77 is not in this packet/)).toBeTruthy();
  });
});
