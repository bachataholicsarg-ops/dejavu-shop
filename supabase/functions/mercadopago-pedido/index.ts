import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "https://esm.sh/@supabase/supabase-js@2.57.4";
const cors={"Access-Control-Allow-Origin":"https://dejavu-shop.vercel.app","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS"};
const reply=(body,status=200)=>Response.json(body,{status,headers:{...cors,"Cache-Control":"no-store"}});
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return reply({error:"Método no permitido"},405);
 try{
 const sb=createClient(Deno.env.get("SUPABASE_URL"),Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
 const body=await req.json();
 const customerPayment=body.action==="pagar";
 if(customerPayment){
  if(!/^[a-f0-9]{64}$/.test(body.pago_token||""))return reply({error:"El enlace de pago no es válido."},401);
  const token_hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(body.pago_token)))).map(v=>v.toString(16).padStart(2,"0")).join("");
  const {data:link,error}=await sb.from("pedido_enlaces_pago").select("pedido_id,vence_en").eq("token_hash",token_hash).maybeSingle();
  if(error||!link||Date.parse(link.vence_en)<=Date.now())return reply({error:"El enlace venció. Pedí uno nuevo por WhatsApp."},410);
  body.pedido_id=link.pedido_id;body.action="generar";body.envio=null;
 }else{
  const jwt=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(!jwt)return reply({error:"Ingresá como administrador"},401);
  const {data:{user},error:authError}=await sb.auth.getUser(jwt);
  if(authError||!user)return reply({error:"Sesión vencida"},401);
  if(user.email!=="dejavu.shop.ar@gmail.com"||!user.email_confirmed_at)return reply({error:"Solo disponible para el administrador"},403);
 }
 if(!/^[0-9a-f-]{36}$/i.test(body.pedido_id||"")||!["generar","verificar","consultar"].includes(body.action))return reply({error:"Solicitud inválida"},400);
 if(body.action==="consultar"){
  const {data:o,error:oe}=await sb.from("pedidos").select("eliminado_en,estado_pago,estado").eq("id",body.pedido_id).maybeSingle();
  if(oe||!o||o.eliminado_en)return reply({error:"Pedido inexistente"},404);
  if(o.estado_pago==="pagado"||String(o.estado).toLowerCase()==="cancelado")return reply({url:null});
  const {data:c,error}=await sb.from("mercadopago_cobros").select("enlace,total,creado_en").eq("pedido_id",body.pedido_id).maybeSingle();
  if(error)throw Error("No se pudo recuperar el enlace");
  if(!c||Date.now()>Date.parse(c.creado_en)+7*86400000)return reply({url:null});
  return reply({url:c.enlace,total:Number(c.total)});
 }
 const token=Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
 if(!token)return reply({error:customerPayment?"El pago online no está disponible en este momento. Te enviaremos el enlace por WhatsApp.":"Falta guardar MERCADOPAGO_ACCESS_TOKEN en Supabase"},503);
 async function mp(path,options={}){
  const response=await fetch("https://api.mercadopago.com"+path,{...options,headers:{Authorization:"Bearer "+token,"Content-Type":"application/json",...(options.headers||{})},signal:AbortSignal.timeout(12000)});
  const json=await response.json();
  if(!response.ok)throw Error(response.status===401||response.status===403?"Mercado Pago rechazó la credencial. Revisá el Access Token productivo.":"Mercado Pago no pudo completar la operación. Intentá nuevamente.");
  return json;
 }
 const {data:order,error:orderError}=await sb.from("pedidos").select("id,numero,cliente_nombre,estado,estado_pago,subtotal,total,zona_envio,eliminado_en").eq("id",body.pedido_id).maybeSingle();
 if(orderError)throw Error("No se pudo leer el pedido");
 if(!order||order.eliminado_en)return reply({error:"Pedido inexistente o eliminado"},404);
 if(customerPayment){
  if(order.estado_pago==="pagado")return reply({error:"Este pedido ya está pagado."},409);
  const free=(order.zona_envio==="CABA"&&Number(order.subtotal)>=30000)||(order.zona_envio==="Campana"&&Number(order.subtotal)>=40000);
  const {data:existing,error:existingError}=await sb.from("mercadopago_cobros").select("enlace").eq("pedido_id",order.id).maybeSingle();
  if(existingError)throw Error("No se pudo consultar el pago");
  if(!free&&!existing)return reply({error:"Tu pedido está guardado. Primero confirmamos el costo de envío por WhatsApp y te compartimos el enlace con el total."},409);
 }
 if(body.action==="generar"){
  if(body.envio!==null&&body.envio!==undefined&&(!Number.isFinite(body.envio)||body.envio<0))return reply({error:"Costo de envío inválido"},400);
  const {data:reserved,error}=await sb.rpc("reservar_cobro_mp",{p_pedido:order.id,p_envio:body.envio??null});
  if(error)return reply({error:error.message},409);
  const c=Array.isArray(reserved)?reserved[0]:reserved;
  if(!c)throw Error("No se pudo reservar el cobro");
  if(Date.now()>new Date(c.creado_en).getTime()+7*86400000)return reply({error:"El enlace venció. Revisá el cobro en Mercado Pago antes de emitir otro."},409);
  if(c.enlace)return reply({url:c.enlace,total:Number(c.total)});
  const back="https://dejavu-shop.vercel.app/pago.html";
  const preference=await mp("/checkout/preferences",{method:"POST",headers:{"X-Idempotency-Key":c.referencia},body:JSON.stringify({
   items:[{id:order.id,title:"Déjà Vu · Pedido "+order.numero,quantity:1,currency_id:"ARS",unit_price:Number(c.total)}],
   external_reference:c.referencia,back_urls:{success:back,pending:back,failure:back},auto_return:"approved",
   expires:true,expiration_date_to:new Date(new Date(c.creado_en).getTime()+7*86400000).toISOString()
  })});
  if(!preference.id||!/^https:\/\/www\.mercadopago\.com\.ar\//.test(preference.init_point||""))throw Error("Mercado Pago no devolvió un enlace válido");
  const {error:saveError}=await sb.from("mercadopago_cobros").update({preferencia_id:String(preference.id),enlace:preference.init_point}).eq("pedido_id",order.id).is("preferencia_id",null);
  if(saveError)throw Error("No se pudo guardar el enlace. Intentá nuevamente.");
  const {data:saved,error:savedError}=await sb.from("mercadopago_cobros").select("enlace,total").eq("pedido_id",order.id).single();
  if(savedError||!saved.enlace)throw Error("No se pudo recuperar el enlace");
  return reply({url:saved.enlace,total:Number(saved.total)});
 }
 const {data:c,error}=await sb.from("mercadopago_cobros").select("*").eq("pedido_id",order.id).maybeSingle();
 if(error)throw Error("No se pudo leer el cobro");
 if(!c)return reply({error:"Primero generá el enlace de pago"},409);
 const result=await mp("/v1/payments/search?external_reference="+encodeURIComponent(c.referencia)+"&sort=date_created&criteria=desc&limit=100");
 const approved=(result.results||[]).filter(p=>p.external_reference===c.referencia&&p.status==="approved"&&p.currency_id==="ARS"&&p.live_mode===true&&Math.round(Number(p.transaction_amount)*100)===Math.round(Number(c.total)*100)&&Number(p.transaction_amount_refunded||0)===0);
 if(approved.length>1)return reply({error:"Hay más de un pago aprobado. Revisá Mercado Pago antes de continuar."},409);
 if(!approved.length)return reply({pagado:false,message:"Todavía no hay un pago aprobado por el importe de este pedido."});
 const {error:paidError}=await sb.rpc("confirmar_cobro_mp",{p_pedido:order.id,p_pago:String(approved[0].id)});
 if(paidError)return reply({error:paidError.message},409);
 return reply({pagado:true,message:"Pago aprobado en Mercado Pago. Pedido marcado como pagado."});
 }catch(e){return reply({error:e instanceof Error?e.message:"No se pudo completar la operación"},502);}
});