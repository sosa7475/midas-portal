/** Validate the subset used in the exported MCP catalog without coercing exact quantities. */
export function validateSchema(schema:any,value:any,path="arguments",depth=0):void {
 if(depth>30)throw Error("Arguments nested too deeply");
 const fail=(why:string):never=>{throw Error(`${path}: ${why}`);};
 if(schema.enum&&!schema.enum.includes(value))fail("unsupported value");
 if(schema.type==="object"){
  if(!value||typeof value!=="object"||Array.isArray(value))fail("object required");
  for(const k of schema.required??[])if(value[k]===undefined)fail(`${k} required`);
  for(const [k,v] of Object.entries(value)){
   if(["__proto__","constructor","prototype"].includes(k))fail("reserved property");
   if(schema.properties?.[k])validateSchema(schema.properties[k],v,`${path}.${k}`,depth+1);
   else if(schema.additionalProperties===false)fail(`unknown property ${k}`);
  }
 }else if(schema.type==="array"){
  if(!Array.isArray(value))fail("array required");
  if(value.length>(schema.maxItems??1000)||value.length<(schema.minItems??0))fail("array size outside limits");
  for(const v of value)validateSchema(schema.items??{},v,path+"[]",depth+1);
 }else if(schema.type==="string"){
  if(typeof value!=="string")fail("string required");
  if(value.length>(schema.maxLength??20000)||value.length<(schema.minLength??0))fail("string length outside limits");
  if(schema.pattern&&!new RegExp(schema.pattern).test(value))fail("invalid format");
 }else if(schema.type==="number"||schema.type==="integer"){
  if(typeof value!=="number"||!Number.isFinite(value)||(schema.type==="integer"&&!Number.isInteger(value)))fail("finite number required");
  if(value<(schema.minimum??-Infinity)||value>(schema.maximum??Infinity)||value<=(schema.exclusiveMinimum??-Infinity))fail("number outside limits");
 }else if(schema.type==="boolean"&&typeof value!=="boolean")fail("boolean required");
}
