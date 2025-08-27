import { createMockTagManager, installGoogleMocks, setTestEnv, expect } from './helpers/mockGoogle';
import { GTMManager } from '../index';

export default async function run() {
  setTestEnv();
  const mock = createMockTagManager();
  installGoogleMocks(mock);

  const mgr = new GTMManager();
  await mgr.findContainer('GTM-TEST');

  const variable = await mgr.createVariable('Unit Var', 'function() { return 1; }', 'jsm');
  await expect(variable.name === 'Unit Var', 'createVariable returns created variable');

  const updated = await mgr.updateVariable(variable.variableId, 'Unit Var 2', 'function() { return 2; }');
  await expect(updated.name === 'Unit Var 2', 'updateVariable updates name');

  const del = await mgr.deleteVariable(variable.variableId);
  await expect(del.deleted === true, 'deleteVariable confirms deletion');
}
