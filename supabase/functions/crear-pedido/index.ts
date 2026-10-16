import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { shippingZone } from "./shipping.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

async function trySendSellerEmail(sb:any,pedidoId:string){
  const {data:notif,error}=await sb.from("notificaciones_email")
    .select("id,destinatario,asunto,cuerpo_html,estado")
    .eq("pedido_id",pedidoId)
    .eq("estado","pendiente")
    .maybeSingle();
  if(error||!notif) return {sent:false,reason:error?.message||"sin_notificacion"};

  const apiKey=Deno.env.get("RESEND_API_KEY");
  const from=Deno.env.get("RESEND_FROM_EMAIL");
  if(!apiKey||!from) return {sent:false,reason:"email_provider_not_configured"};

  try{
    const r=await fetch("https://api.resend.com/emails",{
      method:"POST",
      headers:{"Authorization":"Bearer "+apiKey,"Content-Type":"application/json"},
      body:JSON.stringify({from,to:[notif.destinatario],subject:notif.asunto,html:notif.cuerpo_html})
    });
    const j=await r.json().catch(()=>({}));
    if(!r.ok){
      await sb.from("notificaciones_email").update({estado:"error",error:String(j?.message||"Error proveedor")}).eq("id",notif.id);
      return {sent:false,reason:String(j?.message||"provider_error")};
    }
    await sb.from("notificaciones_email").update({
      estado:"enviado",proveedor_id:String(j?.id||""),enviado_en:new Date().toISOString(),error:null
    }).eq("id",notif.id);
    return {sent:true};
  }catch(e:any){
    await sb.from("notificaciones_email").update({estado:"error",error:e?.message||"Error de envío"}).eq("id",notif.id);
    return {sent:false,reason:e?.message||"send_error"};
  }
}


async function trySendOrderTelegram(sb:any,pedidoId:string){
  const token=Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId=Deno.env.get("TELEGRAM_CHAT_ID");
  if(!token||!chatId) return;
  try{
    const {data:pedido,error}=await sb.from("pedidos")
      .select("numero,total").eq("id",pedidoId).single();
    if(error||!pedido){console.error("telegram_order_lookup_failed");return;}
    const amount=new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS"}).format(Number(pedido.total||0));
    const message=["🛒 Nuevo pedido en Déjà Vu","Pedido: "+pedido.numero,"Total: "+amount,"Revisalo en https://dejavu-shop.vercel.app/admin.html"].join("\n");
    const response=await fetch("https://api.telegram.org/bot"+token+"/sendMessage",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({chat_id:chatId,text:message,link_preview_options:{is_disabled:true}}),
      signal:AbortSignal.timeout(5000)
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok||!result.ok)console.error("telegram_order_send_failed",response.status);
  }catch{
    // Never log request URLs: they contain the bot credential.
    console.error("telegram_order_notification_failed");
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return Response.json({ error: "Método no permitido" }, { status: 405, headers: cors });

  try {
    const body = await req.json();
    const items = Array.isArray(body.items) ? body.items : [];
    if (!body.nombre || !body.whatsapp || !body.localidad || items.length === 0) {
      return Response.json({ error: "Faltan datos obligatorios" }, { status: 400, headers: cors });
    }

    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (items.some((i:any) => !uuidRe.test(String(i.producto_id || "")))) {
      return Response.json({ error: "El carrito contiene productos antiguos o inválidos. Actualizá la página y volvé a agregarlos." }, { status: 400, headers: cors });
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    delete body.cliente_auth_id;
    const jwt=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
    if(jwt){
      const {data:{user},error:authError}=await sb.auth.getUser(jwt);
      if(authError||!user)return Response.json({error:"La sesión venció. Volvé a ingresar o hacé el pedido sin registrarte."},{status:401,headers:cors});
      body.cliente_auth_id=user.id;body.email=user.email||body.email||"";
      const {data:profile}=await sb.from("clientes_tienda").select("direccion,piso_depto,codigo_postal,referencias").eq("auth_user_id",user.id).maybeSingle();
      if(profile)for(const key of ["direccion","piso_depto","codigo_postal","referencias"])if(!body[key])body[key]=profile[key];
    }
    body.zona_envio=shippingZone(body.localidad)||(body.canal_venta==="mayorista"&&["CABA","Campana"].includes(body.zona_envio)?body.zona_envio:"Resto del país");
    const { data, error } = await sb.rpc("crear_pedido_atomic", { p_body: body });
    if (error) {
      console.error("crear_pedido_atomic", error);
      const msg = String(error.message || "");
      if (/stock insuficiente/i.test(msg)) return Response.json({ error: msg.replace(/^.*?Stock/i,"Stock") }, { status: 409, headers: cors });
      if (/no está disponible|sin precio|sin costo|faltan datos|inválid|compra mayorista mínima|configuración de precios/i.test(msg)) return Response.json({ error: msg }, { status: 400, headers: cors });
      return Response.json({ error: "No se pudo crear el pedido. Revisá los datos e intentá nuevamente." }, { status: 500, headers: cors });
    }

    if(data?.pedido_id){
      EdgeRuntime.waitUntil(trySendOrderTelegram(sb,String(data.pedido_id)));
    }

    let sellerEmail:any={sent:false,reason:"sin_vendedor"};
    if(data?.pedido_id && data?.vendedor_id){
      sellerEmail=await trySendSellerEmail(sb,String(data.pedido_id));
    }

    // A random payment capability is returned only to the browser that created this order.
    // Failure here must not turn a successfully saved order into a retry/duplicate.
    let pago_token: string | null = null;
    if(data?.pedido_id){
      try {
        const value=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(v=>v.toString(16).padStart(2,"0")).join("");
        const token_hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))).map(v=>v.toString(16).padStart(2,"0")).join("");
        const {error:linkError}=await sb.from("pedido_enlaces_pago").insert({pedido_id:data.pedido_id,token_hash,vence_en:new Date(Date.now()+7*86400000).toISOString()});
        if(!linkError)pago_token=value;
        else console.error("payment_link_creation_failed");
      }catch{console.error("payment_link_creation_failed");}
    }
    return Response.json({...data,pago_token,notificacion_vendedor:sellerEmail}, { headers: {...cors,"Cache-Control":"no-store"} });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "No se pudo crear el pedido" }, { status: 500, headers: cors });
  }
});
