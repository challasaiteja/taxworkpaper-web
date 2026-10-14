// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PacketSource } from '../../src/ports/PacketSource';
import { App } from '../../src/ui/App';
import { miniPacket } from '../fixtures/miniPacket';

const sourceOf = (data: unknown): PacketSource => ({ label: 'test', load: async () => data });

describe('App', () => {
  it('loads a packet and shows the frame', async () => {
    render(<App source={sourceOf(miniPacket())} />);
    expect(await screen.findByText(/Mini · C-MINI/)).toBeTruthy();
  });

  it('shows a readable error for a non-packet file', async () => {
    render(<App source={sourceOf({ hello: 'world' })} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/could not be loaded/);
    expect(alert.textContent).toMatch(/documents/);
  });
});
