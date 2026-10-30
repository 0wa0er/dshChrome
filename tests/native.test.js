import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrameDecoder, encodeFrame } from '../native/framing.js';

test('native frames survive split headers, split bodies and combined messages', () => {
  const values = [], decoder = new FrameDecoder(v => values.push(v));
  const bytes = Buffer.concat([encodeFrame({text:'中文'}),encodeFrame({text:'next'})]);
  for (let i=0;i<bytes.length;i+=3) decoder.push(bytes.subarray(i,i+3));
  assert.deepEqual(values,[{text:'中文'},{text:'next'}]);
});
test('native framing rejects oversized frames before allocation and invalid JSON', () => {
  const header = Buffer.alloc(4); header.writeUInt32LE(1024*1024+1);
  assert.throws(() => new FrameDecoder(()=>{}).push(header), /size|large|limit/i);
  assert.throws(() => new FrameDecoder(()=>{}).push(Buffer.from([1,0,0,0,123])), /JSON/i);
});
