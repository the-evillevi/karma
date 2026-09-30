import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const manifestPath = new URL('../docs/execution/manifest.json', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const byId = new Map(manifest.issues.map(issue => [issue.id, issue]));
if (byId.size !== manifest.issues.length) throw new Error('Duplicate issue identifiers');
const visited = new Set();
const visiting = new Set();
function visit(id) {
  if (!byId.has(id)) throw new Error(`Unknown dependency: ${id}`);
  if (visiting.has(id)) throw new Error(`Dependency cycle at ${id}`);
  if (visited.has(id)) return;
  visiting.add(id);
  for (const dependency of byId.get(id).requires) visit(dependency);
  visiting.delete(id);
  visited.add(id);
}
for (const id of byId.keys()) visit(id);
const ready = manifest.issues.filter(issue => issue.stage === 'queued' && issue.requires.every(id => byId.get(id).artifactsReady === true));
const active = manifest.issues.filter(issue => ['preparing', 'researching', 'implementing', 'verifying', 'reviewing', 'fixing'].includes(issue.stage));
const blocked = manifest.issues.filter(issue => (issue.blockers || []).length > 0);
console.log(JSON.stringify({manifest: fileURLToPath(manifestPath), issueCount: byId.size, active: active.map(i => ({id:i.id, branch:i.branch, agent:i.agent})), ready: ready.map(i => i.id), blocked: blocked.map(i => ({id:i.id, blockers:i.blockers}))}, null, 2));
