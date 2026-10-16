const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{stripTypeScriptTypes}=require('node:module');
const path=require('node:path');
async function run(body,{admin=false,link,order,cobro=null,reserved=null}={}){
 let handler,rpcCalls=0,mpCalls=0;
 const sb={auth:{getUser:async()=>({data:{user:admin?{email:'dejavu.shop.ar@gmail.com',email_confirmed_at:'yes'}:null},error:null})},from(table){let q={select(){return q},eq(){return q},maybeSingle:async()=>({data:table==='pedido_enlaces_pago'?link:table==='pedidos'?order:cobro,error:null})};return q},rpc:async()=>{rpcCalls++;return{data:reserved,error:null}}};
 const raw=fs.readFileSync(path.join(__dirname,'../supabase/functions/mercadopago-pedido/index.ts'),'utf8').replace(/^import .*;\n/gm,'');
 const ctx={createClient:()=>sb,Deno:{env:{get:()=> 'server-only-value'},serve:f=>handler=f},crypto:globalThis.crypto,Response,AbortSignal,Date,Uint8Array,TextEncoder,console,fetch:async()=>{mpCalls++;throw Error('Unexpected real payment request')}};
 vm.runInNewContext(stripTypeScriptTypes(raw),ctx);
 const r=await handler(new Request('https://test.local',{method:'POST',headers:admin?{Authorization:'Bearer admin'}:{},body:JSON.stringify(body)}));
 return{status:r.status,json:await r.json(),rpcCalls,mpCalls};
}
const id='11111111-1111-4111-8111-111111111111',token='a'.repeat(64),future=new Date(Date.now()+86400000).toISOString();
const order={id,estado:'Nuevo',estado_pago:'pendiente',subtotal:40000,total:40000,zona_envio:'CABA',eliminado_en:null};
test('public cannot call administrator actions',async()=>{const r=await run({action:'generar',pedido_id:id});assert.equal(r.status,401);assert.equal(r.rpcCalls,0)});
test('random token never grants order access',async()=>{const r=await run({action:'pagar',pago_token:token});assert.equal(r.status,410);assert.equal(r.rpcCalls,0)});
test('expired payment token rejected',async()=>{const r=await run({action:'pagar',pago_token:token},{link:{pedido_id:id,vence_en:'2000-01-01'}});assert.equal(r.status,410)});
test('shipping cannot be set by guest, unknown shipping stops payment',async()=>{const r=await run({action:'pagar',pago_token:token,envio:0,pedido_id:'other'},{link:{pedido_id:id,vence_en:future},order:{...order,zona_envio:'Resto del país'}});assert.equal(r.status,409);assert.equal(r.rpcCalls,0);assert.match(r.json.error,/costo de envío/)});
test('guest can reuse free-shipping payment link without another preference',async()=>{const r=await run({action:'pagar',pago_token:token},{link:{pedido_id:id,vence_en:future},order,reserved:{creado_en:new Date().toISOString(),enlace:'https://www.mercadopago.com.ar/checkout/test',total:40000}});assert.equal(r.status,200);assert.equal(r.mpCalls,0);assert.equal(r.json.total,40000)});
test('paid or removed orders cannot be charged',async()=>{for(const changed of [{estado_pago:'pagado'},{eliminado_en:new Date().toISOString()}]){const r=await run({action:'pagar',pago_token:token},{link:{pedido_id:id,vence_en:future},order:{...order,...changed}});assert.ok(r.status>=400);assert.equal(r.rpcCalls,0)}});
test('admin can retrieve previous link without creating another charge',async()=>{const r=await run({action:'consultar',pedido_id:id},{admin:true,order,cobro:{enlace:'https://www.mercadopago.com.ar/checkout/test',total:40000,creado_en:new Date().toISOString()}});assert.equal(r.status,200);assert.equal(r.rpcCalls,0);assert.equal(r.mpCalls,0);assert.equal(r.json.total,40000)});
