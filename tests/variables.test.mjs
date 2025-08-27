import { createMockTagManager, installGoogleMocks, setTestEnv, expect } from './helpers/mockGoogle.mjs';
import { GTMManager } from '../dist/index.js';

export default async function run() {
  setTestEnv();
  const mock = createMockTagManager();
  installGoogleMocks(mock);
  const mgr = new GTMManager();
  await mgr.findContainer('GTM-TEST');
  const v = await mgr.createVariable('Unit Var', 'function() { return 1; }', 'jsm');
  await expect(!!v.variableId, 'createVariable returns id');
  const up = await mgr.updateVariable(v.variableId, 'Unit Var 2', 'function() { return 2; }');
  await expect(up.name === 'Unit Var 2', 'updateVariable sets new name');
  const del = await mgr.deleteVariable(v.variableId);
  await expect(del.deleted === true, 'deleteVariable confirms deletion');
}

