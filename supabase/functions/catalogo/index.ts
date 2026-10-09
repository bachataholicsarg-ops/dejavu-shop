import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"content-type, apikey, x-wholesale-access",
  "Access-Control-Allow-Methods":"GET, OPTIONS"
};

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  if(req.method!=="GET") return Response.json({error:"Método no permitido"},{status:405,headers:cors});
  try{
    const url=new URL(req.url);
    const canal=(url.searchParams.get("canal")||"minorista").toLowerCase();
    if(!["minorista","mayorista"].includes(canal)) return Response.json({error:"Canal inválido"},{status:400,headers:cors});

    const sb=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    let cliente:any=null;
    if(canal==="mayorista"){
      const access=req.headers.get("x-wholesale-access")||url.searchParams.get("acceso")||"";
      const {data,error}=await sb.from("clientes_mayoristas")
        .select("id,nombre,vendedor_id,activo").eq("acceso_token",access).eq("activo",true).maybeSingle();
      if(error) throw error;
      if(!data) return Response.json({error:"Acceso mayorista requerido"},{status:403,headers:cors});
      cliente=data;
    }

    const [{data:cfg,error:ce},{data:productos,error:pe}]=await Promise.all([
      sb.from("configuracion_precios").select("porcentaje_recargo,compra_minima").eq("canal",canal).single(),
      sb.from("productos").select("id,nombre,categoria,descripcion,costo,precio,precio_minorista_manual,stock,proveedor_url,imagen_url,activo").eq("activo",true).order("nombre")
    ]);
    if(ce) throw ce;if(pe) throw pe;
    const pct=Number(cfg?.porcentaje_recargo||0);
    const out=(productos||[]).map((p:any)=>{
      const costo=p.costo==null?null:Number(p.costo);
      const precioBase=p.precio==null?null:Number(p.precio);
      const precio=canal==="minorista"&&p.precio_minorista_manual&&precioBase!=null?precioBase:costo!=null?Math.round((costo*(1+pct/100))*100)/100:(canal==="minorista"?precioBase:null);
      return {id:p.id,nombre:p.nombre,categoria:p.categoria,descripcion:p.descripcion,precio,stock:p.stock,proveedor_url:p.proveedor_url,imagen_url:p.imagen_url,activo:p.activo};
    });
    return Response.json({
      productos:out,
      configuracion:{porcentaje_recargo:pct,compra_minima:Number(cfg?.compra_minima||0)},
      cliente:cliente?{id:cliente.id,nombre:cliente.nombre}:null
    },{headers:cors});
  }catch(e:any){
    console.error(e);
    return Response.json({error:e?.message||"No se pudo cargar el catálogo"},{status:500,headers:cors});
  }
});