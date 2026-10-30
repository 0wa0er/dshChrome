import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { nativeOptions } from '../native/options.js';
test('fixed launcher state directory survives Chrome environment differences',()=>{
  const stateDirectory=path.resolve('custom-dsh-state');
  assert.deepEqual(nativeOptions(['--state-directory',stateDirectory],{defaultDirectory:path.resolve('wrong'),extensionId:'test'}),{stateDirectory});
});
test('native launch rejects unrelated origin and unknown arguments',()=>{
  const defaults={defaultDirectory:path.resolve('state'),extensionId:'test'};
  assert.throws(()=>nativeOptions(['chrome-extension://other/'],defaults),/origin/i);
  assert.throws(()=>nativeOptions(['--anything'],defaults),/argument/i);
  assert.deepEqual(nativeOptions(['chrome-extension://test/'],defaults),{stateDirectory:defaults.defaultDirectory});
});
