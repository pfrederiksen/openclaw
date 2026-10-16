import fs from 'node:fs';
import crypto from 'node:crypto';
const manifest=JSON.parse(fs.readFileSync(new URL('./SOURCE-PIN.json',import.meta.url)));
const digest=crypto.createHash('sha256').update(fs.readFileSync(new URL('./reviewer-source.tar.gz',import.meta.url))).digest('hex');
if(digest!==manifest.archiveSha256)throw Error('Pinned source archive digest mismatch');
console.log(JSON.stringify({verifiedArchiveSha256:digest,pin:manifest.pin}));
