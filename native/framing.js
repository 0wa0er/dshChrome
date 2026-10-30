export const MAX_FRAME_BYTES = 1024 * 1024;
export function encodeFrame(value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  if (!body.length || body.length > MAX_FRAME_BYTES) throw new Error('Frame size limit exceeded');
  const header = Buffer.allocUnsafe(4); header.writeUInt32LE(body.length);
  return Buffer.concat([header,body]);
}
export class FrameDecoder {
  constructor(onMessage) { this.onMessage = onMessage; this.buffer = Buffer.alloc(0); this.expected = null; }
  push(chunk) {
    this.buffer = Buffer.concat([this.buffer,chunk]);
    while (true) {
      if (this.expected === null) {
        if (this.buffer.length < 4) return;
        this.expected = this.buffer.readUInt32LE(); this.buffer = this.buffer.subarray(4);
        if (!this.expected || this.expected > MAX_FRAME_BYTES) throw new Error('Frame size limit exceeded');
      }
      if (this.buffer.length < this.expected) return;
      const body = this.buffer.subarray(0,this.expected); this.buffer = this.buffer.subarray(this.expected); this.expected = null;
      const value = JSON.parse(body.toString('utf8')); this.onMessage(value);
    }
  }
}
