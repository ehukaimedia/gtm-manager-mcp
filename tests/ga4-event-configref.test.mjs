import { createMockTagManager, installGoogleMocks, setTestEnv, expect } from './helpers/mockGoogle.mjs';
import { GTMManager } from '../dist/index.js';

export default async function run() {
  setTestEnv();
  const mock = createMockTagManager();
  installGoogleMocks(mock);
  const mgr = new GTMManager();
  await mgr.findContainer('GTM-TEST');
  // Simulate referencing an existing GA4 Configuration tag (ID 44)
  const tag = await mgr.createGa4EventTag('GA4 Event Login', undefined, 'login', { configTagId: '44' });
  await expect(tag.type === 'gaawe', 'uses gaawe type');
  const keys = (tag.parameter || []).map(p => p.key);
  await expect(keys.includes('sendToTag'), 'includes sendToTag to GA4 Configuration tag');
  await expect(!keys.includes('measurementIdOverride'), 'no measurementIdOverride when configTagId provided');
}
