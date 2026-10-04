import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import findings from './findings.mjs';
const checkout=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..').replaceAll('\\','/');
const root=(process.env.AUDIT_LINK_ROOT||checkout).replaceAll('\\','/').replace(/\/$/,'');
const dir=checkout+'/audit/';
const read=n=>fs.readFileSync(dir+n,'utf8');
const linkEvidence=s=>s.replace(/\b(src\/[A-Za-z0-9_./-]+\.[A-Za-z]+):(\d+)(?:-\d+)?/g,(_,p,l)=>`[${p}:${l}](${root}/${p}:${l})`).replace(/\b([a-z][a-z0-9-]+\.(?:json|jpg|log))\b/g,(m)=>fs.existsSync(dir+m)?`[${m}](${root}/audit/${m})`:m);
let records='';
for(const severity of ['Blocker','Major','Minor','Nit']){
 records+=`### ${severity}\n\n`;
 const rows=findings.filter(f=>f[1]===severity);
 if(!rows.length)records+='None established by this audit.\n\n';
 for(const [id,sev,title,where,trigger,observed,expected,fix,effort] of rows)records+=`**[${id}] [${sev}] ${title}**\n\n- **Where:** ${where}\n- **Trigger/State:** ${trigger}\n- **Observed:** ${linkEvidence(observed)}\n- **Expected:** ${expected}\n- **Fix:** ${fix}\n- **Effort:** ${effort}\n\n`;
}
let report=read('report-body.md').replace('{{COVERAGE}}',read('coverage-table.md')).replace('{{INVENTORY}}',read('surface-inventory.md')).replace('{{FINDINGS}}',records).replaceAll('{{ROOT}}',root);
// Spacing correction for authored prose; retain compact physics/geometry values where meaningful.
report=report.replace(/\b(section|version|commit|approximately|at|with|after|before|within|under|all|only|roughly|of|above)(\d)/gi,'$1 $2');
fs.writeFileSync(dir+'report.md',report);
fs.writeFileSync(dir+'findings.json',JSON.stringify(findings.map(([id,severity,title,where,trigger,observed,expected,fix,effort])=>({id,severity,title,where,trigger,observed,expected,fix,effort})),null,2));
const headings=report.match(/^## \d\./gm)||[];
if(headings.length!==8||report.includes('{{'))throw Error('Report structure incomplete');
console.log(JSON.stringify({sections:headings.length,findings:findings.length,words:report.split(/\s+/).length,bytes:Buffer.byteLength(report),severity:Object.fromEntries(['Blocker','Major','Minor','Nit'].map(s=>[s,findings.filter(f=>f[1]===s).length]))}));
