import { createMockTagManager, installGoogleMocks, setTestEnv, expect } from './helpers/mockGoogle.mjs';
import { GTMManager } from '../dist/index.js';

export default async function run() {
  setTestEnv();
  const mock = createMockTagManager();
  installGoogleMocks(mock);
  const mgr = new GTMManager();
  await mgr.findContainer('GTM-TEST');
  const tag = await mgr.createGa4EventTag('GA4 Event Login', 'G-TEST123', 'login', { eventParameters: { method: 'email' } });
  await expect(tag.type === 'gaawe', 'createGa4EventTag uses gaawe type');
  await expect(tag.name === 'GA4 Event Login', 'createGa4EventTag returns created tag');
  const keys = (tag.parameter || []).map(p => p.key);
  await expect(keys.includes('measurementIdOverride'), 'includes measurementIdOverride');
  const override = (tag.parameter || []).find(p => p.key === 'measurementIdOverride');
  await expect(override && override.type === 'list', 'measurementIdOverride is a list');
}
