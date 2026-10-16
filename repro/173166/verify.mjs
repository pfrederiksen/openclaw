import fs from 'node:fs';
import crypto from 'node:crypto';
const manifest = JSON.parse(fs.readFileSync(new URL('./SOURCE-PIN.json', import.meta.url)));
for (const entry of manifest.sourceFiles) {
  const bytes = fs.readFileSync(new URL(`./source/${entry.path}`, import.meta.url));
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw Error(`Source mismatch: ${entry.path}`);
}
for (const entry of manifest.priorEvidence) {
  const bytes = fs.readFileSync(new URL(`./${entry.path}`, import.meta.url));
  if (bytes.length !== entry.bytes || crypto.createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw Error(`Prior evidence mismatch: ${entry.path}`);
}
console.log(JSON.stringify({verifiedSourcePin:manifest.pin, sourceFiles:manifest.sourceFiles.length, priorEvidenceFiles:manifest.priorEvidence.length}));
