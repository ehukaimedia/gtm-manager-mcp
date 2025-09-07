import { createMockTagManager, installGoogleMocks, setTestEnv, expect } from './helpers/mockGoogle.mjs';
import { GTMManager } from '../dist/index.js';

export default async function run() {
  setTestEnv();
  const mock = createMockTagManager();
  installGoogleMocks(mock);
  const mgr = new GTMManager();
  await mgr.findContainer('GTM-TEST');
  const tag = await mgr.createGa4ConfigurationTag('GA4 Config', 'G-TEST123', { sendPageView: true });
  await expect(tag.type === 'gaawc', 'createGa4ConfigurationTag uses gaawc type');
  await expect(tag.name === 'GA4 Config', 'createGa4ConfigurationTag returns created tag');
}

