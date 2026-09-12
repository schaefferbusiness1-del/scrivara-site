'use strict';
const fs=require('fs'),assert=require('assert'),path=require('path');const target=path.join(__dirname,'..','background.js');const source=fs.readFileSync(target,'latin1');const seam='\n}\n\r\n  try {\r\n    var T0 = Date.now();';assert(source.split(seam).length===2);fs.writeFileSync(target,Buffer.from(source.replace(seam,'\n}\n  try {\r\n    var T0 = Date.now();'),'latin1'));
