export interface PacketSource {
  label: string;
  load(): Promise<unknown>;
}
