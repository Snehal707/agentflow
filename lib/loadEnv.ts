import path from 'node:path';
import dotenv from 'dotenv';

const repoRoot = process.cwd();

dotenv.config();
dotenv.config({ path: path.join(repoRoot, '.env.local'), override: true });
dotenv.config({
  path: path.join(repoRoot, 'agentflow-frontend', '.env.local'),
  override: true,
});
