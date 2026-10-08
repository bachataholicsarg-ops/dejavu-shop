import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { shippingZone } from "./shipping.js";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Cache-Control":"no-store"};
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:cors});
const clean=(v:unknown)=>String(v||"").trim().slice(0,1000);
async function hash(token:string){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token)))).map(v=>v.toString(16).padStart(2,"0")).join("");}
Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return reply({error:"Método no permitido"},405);
  try{
    const body=await req.json();
    const sb=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const jwt=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
    let user:any=null;
    if(jwt){const result=await sb.auth.getUser(jwt);if(result.error||!result.data.user)return reply({error:"La sesión venció. Volvé a ingresar."},401);user=result.data.user;}
    if(body.action==="cuenta"){
      if(!user)return reply({error:"Ingresá para ver tus pedidos."},401);
      const {data,error}=await sb.from("pedidos").select("id,numero,subtotal,total,costo_envio,estado,estado_pago,creado_en,localidad,zona_envio,direccion,piso_depto,franja_horaria").eq("cliente_auth_id",user.id).order("creado_en",{ascending:false}).limit(100);
      if(error)throw error;
      const ids=(data||[]).map((o:any)=>o.id);
      const {data:items,error:itemsError}=ids.length?await sb.from("pedido_items").select("pedido_id,producto_nombre,cantidad,precio_unitario,subtotal").in("pedido_id",ids):{data:[],error:null};
      if(itemsError)throw itemsError;
      return reply({pedidos:(data||[]).map((o:any)=>({...o,items:(items||[]).filter((i:any)=>i.pedido_id===o.id)}))});
    }
    if(body.action==="crear-enlace"){
      if(!user||String(user.email||"").toLowerCase()!=="dejavu.shop.ar@gmail.com"||!user.email_confirmed_at)return reply({error:"Solo el administrador puede generar este enlace."},403);
      const {data:order,error}=await sb.from("pedidos").select("id,numero,estado").eq("id",clean(body.pedido_id)).maybeSingle();
      if(error||!order)return reply({error:"Pedido no encontrado."},404);
      if(["Cancelado","Enviado","Entregado"].includes(order.estado))return reply({error:"Este pedido ya no permite modificar la entrega."},409);
      const token=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(v=>v.toString(16).padStart(2,"0")).join("");
      const {error:writeError}=await sb.from("pedido_enlaces_cliente").upsert({pedido_id:order.id,token_hash:await hash(token),vence_en:new Date(Date.now()+7*86400000).toISOString(),usado_en:null});
      if(writeError)throw writeError;
      return reply({url:"https://dejavu-shop.vercel.app/cliente.html#pedido="+token,pedido:order.numero});
    }
    const token=clean(body.token);
    if(!/^[a-f0-9]{64}$/.test(token))return reply({error:"El enlace no es válido. Pedí uno nuevo por WhatsApp."},400);
    const tokenHash=await hash(token);
    const {data:link,error:linkError}=await sb.from("pedido_enlaces_cliente").select("pedido_id,vence_en,usado_en").eq("token_hash",tokenHash).maybeSingle();
    if(linkError)throw linkError;
    if(!link||link.usado_en||Date.parse(link.vence_en)<=Date.now())return reply({error:"El enlace venció o ya fue utilizado. Pedí uno nuevo por WhatsApp."},410);
    if(body.action==="ver-pedido"){
      const {data,error}=await sb.from("pedidos").select("cliente_id,numero,cliente_nombre,cliente_whatsapp,localidad,direccion,piso_depto,codigo_postal,referencias,subtotal,zona_envio,estado").eq("id",link.pedido_id).maybeSingle();
      if(error)throw error;if(!data)return reply({error:"Pedido no encontrado."},404);
      if(["Cancelado","Enviado","Entregado"].includes(data.estado))return reply({error:"Este pedido ya no permite modificar los datos de entrega."},409);
      const {data:profile,error:profileError}=await sb.from("clientes_tienda").select("telefono,email,empresa,provincia,dias_atencion,horario_atencion,horario_entrega,contacto_preferido").eq("id",data.cliente_id).maybeSingle();
      if(profileError)throw profileError;
      delete data.cliente_id;
      return reply({pedido:{...data,...profile}});
    }
    if(body.action==="guardar-pedido"){
      const datos=Object.fromEntries(["nombre","whatsapp","telefono","email","empresa","localidad","provincia","direccion","piso_depto","codigo_postal","dias_atencion","horario_atencion","horario_entrega","contacto_preferido","referencias"].map(k=>[k,clean(body.datos?.[k])]));
      datos.zona_envio=shippingZone(datos.localidad)||"Resto del país";
      const {data,error}=await sb.rpc("completar_datos_pedido",{p_token_hash:tokenHash,p_datos:datos,p_user_id:user?.id||null});
      if(error)return reply({error:error.message},400);return reply(data);
    }
    return reply({error:"Acción no válida."},400);
  }catch(error){console.error(error);return reply({error:"No se pudo completar la solicitud. Intentá nuevamente."},500);}
});
