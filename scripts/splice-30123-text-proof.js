'use strict';
const fs=require('fs'),assert=require('assert'),path=require('path');const target=path.join(__dirname,'..','background.js');let s=fs.readFileSync(target,'latin1');
const seam='          const frameIdentity = {};';assert(s.indexOf(seam)===s.lastIndexOf(seam));
const add=`          const textHasPairStrict = (txt) => String(txt || '').split(/\\r?\\n/).some((line) => {
            const match = /^\\s*(?:patient\\s*[:#-]?\\s*)?(.{2,100}?)\\s+(?:DOB\\s*[:#-]?\\s*)?(\\d{1,4}[/.\\-]\\d{1,2}[/.\\-]\\d{1,4})(?:\\s|$)/i.exec(line);
            return !!(match && mlsExactIdentityPair({name:want,dob:wantDob},{name:match[1],dob:match[2]}).ok);
          });
`;
s=s.replace(seam,()=>add+seam);
const old='if (!strictNameMatch(f.t, want)) return false;';assert(s.split(old).length===3);s=s.split(old).join('if (!textHasPairStrict(f.t)) return false;');
fs.writeFileSync(target,Buffer.from(s,'latin1'));
