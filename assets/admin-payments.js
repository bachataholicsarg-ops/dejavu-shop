// Payment links are created only by the authenticated administrator.
function renderMercadoPago(order){
 const box=document.createElement("div");box.className="card";box.id="mpPaymentPanel";
 const free=(order.zona_envio==="CABA"&&Number(order.subtotal)>=30000)||(order.zona_envio==="Campana"&&Number(order.subtotal)>=40000);
 box.innerHTML="<h3>Cobrar con Mercado Pago</h3><p>Productos: "+money(order.subtotal)+"</p>"+
 (free?"<p>Envío gratis.</p>":"<label>Costo de envío acordado por WhatsApp (pesos)<input id='mpShipping' type='number' min='0' step='0.01' placeholder='Ingresá el costo; 0 si corresponde' style='display:block;padding:10px;margin:8px 0'></label>")+
 "<p class='muted'>El importe queda fijado al generar el enlace. El enlace vence a los 7 días. Usá Verificar pago para consultar el estado en Mercado Pago.</p><div class='actions'><button id='mpGenerate' type='button' class='btn primary'>Generar enlace de pago</button><button id='mpVerify' type='button' class='btn secondary'>Verificar pago</button></div><div id='mpResult' class='order-msg' role='status'></div>";
 document.getElementById("orderDetail").append(box);
 box.querySelector("#mpGenerate").onclick=()=>runMercadoPago(order,"generar",free);
 box.querySelector("#mpVerify").onclick=()=>runMercadoPago(order,"verificar",free);
}
async function runMercadoPago(order,action,free){
 const panel=document.getElementById("mpPaymentPanel"),out=panel.querySelector("#mpResult");
 const buttons=panel.querySelectorAll("button");buttons.forEach(b=>b.disabled=true);
 out.className="order-msg";out.textContent=action==="generar"?"Generando enlace...":"Consultando Mercado Pago...";
 try{
  const {data:{session}}=await sb.auth.getSession();if(!session)throw Error("Volvé a ingresar como administrador.");
  const raw=panel.querySelector("#mpShipping")?.value;
  const envio=free?0:raw!==""&&raw!==undefined?Number(raw):null;
  const r=await fetch(U+"/functions/v1/mercadopago-pedido",{method:"POST",headers:{"Content-Type":"application/json",apikey:K,Authorization:"Bearer "+session.access_token},body:JSON.stringify({action,pedido_id:order.id,envio})});
  const data=await r.json();if(!r.ok)throw Error(data.error||"No se pudo completar la operación.");
  if(document.getElementById("mpPaymentPanel")!==panel)return;
  if(action==="generar"){
   if(!/^https:\/\/www\.mercadopago\.com\.ar\//.test(data.url||""))throw Error("Enlace inválido.");
   const text="Hola "+order.cliente_nombre+" 💛 Te compartimos el enlace para pagar tu pedido "+order.numero+" de Déjà Vu. Total: "+money(data.total)+". "+data.url;
   out.className="order-msg ok";out.innerHTML="<p><b>Total a pagar: "+money(data.total)+"</b></p><input readonly aria-label='Enlace de Mercado Pago' style='width:100%;padding:10px' value='"+esc(data.url)+"'><div class='actions' style='margin-top:10px'><button id='mpCopy' class='btn secondary' type='button'>Copiar enlace</button><a class='btn whatsapp' target='_blank' rel='noopener' href='"+esc(waLink(order.cliente_whatsapp)+"?text="+encodeURIComponent(text))+"'>Compartir por WhatsApp</a></div>";
   panel.querySelector("#mpCopy").onclick=async()=>{try{await navigator.clipboard.writeText(data.url);panel.querySelector("#mpCopy").textContent="Copiado";}catch{out.querySelector("input").select();}};
   await loadAll();
  }else{
   out.className="order-msg "+(data.pagado?"ok":"");out.textContent=data.message;
   if(data.pagado){document.getElementById("detailPaymentStatus").value="pagado";await loadAll();}
  }
 }catch(e){if(document.getElementById("mpPaymentPanel")===panel){out.className="order-msg error";out.textContent=e.message;}}
 finally{buttons.forEach(b=>b.disabled=false);}
}
const openOrderBeforePayments=openOrder;
openOrder=async function(id){await openOrderBeforePayments(id);if(currentOrderId===id&&document.getElementById("detailPaymentStatus")){const order=ordersCache.find(o=>o.id===id);if(order)renderMercadoPago(order);}};
