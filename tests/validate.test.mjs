import { createMockTagManager, installGoogleMocks, setTestEnv, expect } from './helpers/mockGoogle.mjs';
import { GTMManager } from '../dist/index.js';

export default async function run() {
  setTestEnv();
  const mock = createMockTagManager();
  installGoogleMocks(mock);
  const mgr = new GTMManager();
  await mgr.findContainer('GTM-TEST');

  // Inject a tag that references a missing variable via eventParameters
  mock.state.tags.push({
    tagId: '999',
    name: 'Injected GA4 Event with Missing Var',
    type: 'gaawe',
    parameter: [
      { type: 'template', key: 'eventName', value: 'test_event' },
      { type: 'list', key: 'eventParameters', list: [ { type: 'map', map: [ { type: 'template', key: 'name', value: 'foo' }, { type: 'template', key: 'value', value: '{{Missing Var}}' } ] } ] }
    ],
    firingTriggerId: [],
  });

  const res = await mgr.validateWorkspace();
  await expect(!res.ok, 'Validation should find issues');
}

