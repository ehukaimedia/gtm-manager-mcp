import { createMockTagManager, installGoogleMocks, setTestEnv, expect } from './helpers/mockGoogle.mjs';
import { GTMManager } from '../dist/index.js';

export default async function run() {
  setTestEnv();
  const mock = createMockTagManager();
  installGoogleMocks(mock);
  const mgr = new GTMManager();
  await mgr.findContainer('GTM-TEST');

  // Create sample resources
  await mgr.createTag('GA4 Config - Example', '<script>/* noop */</script>', 'pageview');
  await mgr.createTrigger('Login Custom Event', 'pageview');

  const tagMatches = await mgr.findTagsByName('GA4 Config');
  await expect(tagMatches.length >= 1, 'findTagsByName returns at least one match');

  const trigMatches = await mgr.findTriggersByName('Login');
  await expect(trigMatches.length >= 1, 'findTriggersByName returns at least one match');
}

