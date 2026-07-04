import path from 'node:path';
import { FixtureLoader } from './FixtureLoader';

export const SERVICE_ROOT = path.resolve(__dirname, '..', '..');
export const FIXTURE_ROOT = path.join(SERVICE_ROOT, 'fixtures');
export const fixtureLoader = new FixtureLoader(FIXTURE_ROOT);
