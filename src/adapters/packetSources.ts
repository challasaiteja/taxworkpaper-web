import type { PacketSource } from '../ports/PacketSource';

export class BundledPacketSource implements PacketSource {
  label = 'Bundled packet';
  constructor(private url = '/packet.json') {}
  async load(): Promise<unknown> {
    const res = await fetch(this.url);
    if (!res.ok) throw new Error(`Could not fetch ${this.url} (HTTP ${res.status})`);
    return res.json();
  }
}

export class FilePacketSource implements PacketSource {
  label: string;
  constructor(private file: File) {
    this.label = file.name;
  }
  async load(): Promise<unknown> {
    try {
      return JSON.parse(await this.file.text());
    } catch {
      throw new Error(`${this.file.name} is not valid JSON`);
    }
  }
}
