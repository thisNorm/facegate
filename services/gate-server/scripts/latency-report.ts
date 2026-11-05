import { openDatabase } from '../src/infrastructure/database/database.ts';
import { createAccessRepository } from '../src/modules/access/access.repository.ts';
import { summarizeLatency } from '../src/modules/access/access.latency.ts';

const accessLogs = createAccessRepository(
  openDatabase(process.env.DB_PATH || 'storage/facegate.db'),
);
const limit = Number(process.argv[2] || 1000);
console.log(JSON.stringify(summarizeLatency(accessLogs.listAccessLogs(limit)), null, 2));
