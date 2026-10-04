const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const {MCP_TOOLS}=require('../lib/server/mcp-tools.ts');
const catalog=JSON.stringify({version:'2.0.0',catalogHash:crypto.createHash('sha256').update(JSON.stringify(MCP_TOOLS)).digest('hex'),tools:MCP_TOOLS},null,2)+'\n';
const output=path.join(__dirname,'../../../mcp-catalog.json');
if(process.argv.includes('--check')){if(!fs.existsSync(output)||fs.readFileSync(output,'utf8')!==catalog)throw Error('MCP catalog is stale: run export:mcp');}
else fs.writeFileSync(output,catalog);
console.log(`${MCP_TOOLS.length} MCP tool schemas ${process.argv.includes('--check')?'verified':'exported'}`);
