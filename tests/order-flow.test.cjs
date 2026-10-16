const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {parseHTML}=require(process.env.DEJAVU_TEST_DOM||'linkedom');
const read=p=>fs.readFileSync(require('node:path').join(__dirname,'..',p),'utf8');
function context(html){const {document}=parseHTML(html);const c={document,console,URL,URLSearchParams,Intl,Map,Date,FormData:class{constructor(form){this.entries=()=>[...form.querySelectorAll('[name]')].map(x=>[x.name,x.value]);this[Symbol.iterator]=()=>this.entries()[Symbol.iterator]()}},setTimeout,alert:()=>{},location:{search:'',hash:'',pathname:'/',origin:'https://test.local',assign(url){c.destination=url}},navigator:{},localStorage:{getItem:()=>null,setItem(){}},supabase:{createClient:()=>({auth:{getSession:async()=>({data:{session:null}})}})},fetch:async()=>{throw Error('Unexpected network')}};c.window=c;for(const x of document.querySelectorAll('[id]'))c[x.id]=x;for(const form of document.querySelectorAll('form'))Object.defineProperty(form,'elements',{value:Object.fromEntries([...form.querySelectorAll('[name]')].map(x=>[x.name,x]))});return vm.createContext(c);}
test('checkout saves one order before opening payment; payment failure retains retry without duplicate order',async()=>{
 const c=context(read('index.html'));vm.runInContext(read('assets/order-flow.js'),c);
 const inline=[...read('index.html').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].at(-1)[1].replace(/import\("\/assets\/shipping.js"\)[\s\S]*$/,'');
 vm.runInContext(inline,c);
 c.dvShipping={shippingZone:()=> 'CABA',shippingText:()=> 'Envío gratis'};
 let saves=0,pays=0;
 c.fetch=async(url,options)=>{if(url.includes('crear-pedido')){saves++;return{ok:true,json:async()=>({pedido:'DV-TEST',subtotal:40000,total:40000,pago_token:'a'.repeat(64),zona_envio:'CABA'})}}if(url.includes('mercadopago-pedido')){pays++;return{ok:false,json:async()=>({error:'Pago temporalmente no disponible'})}}return{ok:true,json:async()=>({productos:[{id:'test',nombre:'Producto',precio:40000}]})}};
 vm.runInContext("P=[{id:'test',name:'Producto',price:40000}];C={test:1};",c);
 c.orderForm.elements.nombre.value='Ana';c.orderForm.elements.whatsapp.value='1155555555';c.orderForm.elements.localidad.value='CABA';
 let submit;const original=c.orderForm.addEventListener;c.orderForm.addEventListener=(name,fn)=>{if(name==='submit')submit=fn;else original.call(c.orderForm,name,fn)};
 // Re-evaluate only the registered submit handler to call and await it deterministically.
 const handler=inline.slice(inline.indexOf('orderForm.addEventListener("submit"'),inline.indexOf('\nasync function loadCustomer'));
 vm.runInContext(handler,c);
 await submit({preventDefault(){},submitter:{value:'pagar'}});
 assert.equal(saves,1);assert.equal(pays,1);assert.match(c.orderResult.textContent,/Pedido recibido/);assert.match(c.orderResult.textContent,/No vuelvas a crear el pedido/);
 assert.equal(vm.runInContext('Object.keys(C).length',c),0);
 await c.orderResult.querySelector('[data-pay-order]').onclick();assert.equal(saves,1);assert.equal(pays,2);
});
test('WhatsApp contains the order, confirmed total and payment link',()=>{const c=context('<html></html>');c.money=n=>'$'+n;c.waLink=n=>'https://wa.me/'+n;vm.runInContext(read('assets/order-flow.js'),c);const text=c.orderReplyText({cliente_nombre:'Ana',numero:'DV-TEST'},{url:'https://www.mercadopago.com.ar/test',total:40000});assert.match(text,/DV-TEST/);assert.match(text,/40000/);assert.match(text,/mercadopago/)});
test('deletion requires confirmation and detects denied database updates',async()=>{const c=context('<html></html>');c.ordersCache=[{id:'test',numero:'DV-TEST'}];let writes=0,loads=0;c.sb={from:()=>{writes++;const q={update:()=>q,eq:()=>q,is:()=>q,select:()=>q,single:async()=>({error:{message:'denied'}})};return q}};c.loadAll=async()=>loads++;c.confirm=()=>false;let error='';c.alert=s=>error=s;vm.runInContext(read('assets/order-flow.js'),c);await c.deleteOrder('test');assert.equal(writes,0);c.confirm=()=>true;await c.deleteOrder('test');assert.equal(writes,1);assert.equal(loads,0);assert.match(error,/denied/)});
