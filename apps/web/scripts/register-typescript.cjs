// Worker/test runtime uses the same checked TypeScript sources as Next.js.
const ts = require('typescript');
const fs = require('node:fs');
require.extensions['.ts'] = (mod, filename) => {
 const {outputText} = ts.transpileModule(fs.readFileSync(filename,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}});
 mod._compile(outputText,filename);
};
