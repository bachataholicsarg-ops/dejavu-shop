function renderPaymentDraft(panel,order,payment){
 if(payment){orderPaymentLinks.set(order.id,payment);renderOrders();}
 const draft=panel.querySelector('#mpDraft');draft.value=orderReplyText(order,payment);
 const wa=panel.querySelector('#mpWhatsApp');
 const update=()=>{wa.href=waLink(order.cliente_whatsapp)+'?text='+encodeURIComponent(draft.value);};draft.oninput=update;update();
}
function renderMercadoPago(order){
 const box=document.createElement('div');box.className='card';box.id='mpPaymentPanel';
 const free=(order.zona_envio==='CABA'&&Number(order.subtotal)>=30000)||(order.zona_envio==='Campana'&&Number(order.subtotal)>=40000);
 box.innerHTML="<h3>Responder el pedido y enviar el pago</h3><p>Productos: "+money(order.subtotal)+"</p>"+
 (free?'<p>Envío gratis.</p>':"<label>Costo de envío acordado por WhatsApp (pesos)<input id='mpShipping' type='number' min='0' step='0.01' placeholder='Ingresá el costo; 0 si corresponde' style='display:block;padding:10px;margin:8px 0'></label>")+
 "<p class='muted'>Generá el enlace para incluir el total confirmado en el mensaje. Si ya existe, lo recuperamos. El enlace vence a los 7 días.</p><div class='actions'><button id='mpGenerate' type='button' class='btn primary'>Generar enlace y preparar respuesta</button><button id='mpVerify' type='button' class='btn secondary'>Verificar pago</button></div><div id='mpResult' class='order-msg' role='status'></div><label>Mensaje para el cliente<textarea id='mpDraft' rows='7' style='width:100%;padding:12px'></textarea></label><a id='mpWhatsApp' class='btn whatsapp' target='_blank' rel='noopener'>Revisar y enviar por WhatsApp</a><p class='muted'>WhatsApp abre el mensaje preparado para que lo revises antes de enviarlo.</p>";
 document.getElementById('orderDetail').append(box);
 renderPaymentDraft(box,order,orderPaymentLinks.get(order.id));
 box.querySelector('#mpGenerate').onclick=()=>runMercadoPago(order,'generar',free);
 box.querySelector('#mpVerify').onclick=()=>runMercadoPago(order,'verificar',free);
 runMercadoPago(order,'consultar',free);
}
async function runMercadoPago(order,action,free){
 const panel=document.getElementById('mpPaymentPanel'),out=panel.querySelector('#mpResult');
 const buttons=panel.querySelectorAll('button');buttons.forEach(b=>b.disabled=true);
 out.className='order-msg';out.textContent=action==='generar'?'Generando enlace...':action==='consultar'?'Buscando enlace guardado...':'Consultando Mercado Pago...';
 try{
  const {data:{session}}=await sb.auth.getSession();if(!session)throw Error('Volvé a ingresar como administrador.');
  const raw=panel.querySelector('#mpShipping')?.value;
  const envio=free?0:raw!==''&&raw!==undefined?Number(raw):null;
  const r=await fetch(U+'/functions/v1/mercadopago-pedido',{method:'POST',headers:{'Content-Type':'application/json',apikey:K,Authorization:'Bearer '+session.access_token},body:JSON.stringify({action,pedido_id:order.id,envio})});
  const data=await r.json();if(!r.ok)throw Error(data.error||'No se pudo completar la operación.');
  if(document.getElementById('mpPaymentPanel')!==panel||currentOrderId!==order.id)return;
  if(action==='generar'||action==='consultar'){
   if(!data.url){out.textContent='Todavía no hay un enlace de pago. Generá uno cuando confirmes el envío.';return;}
   const url=new URL(data.url);if(url.protocol!=='https:'||url.hostname!=='www.mercadopago.com.ar')throw Error('Enlace inválido.');
   out.className='order-msg ok';out.innerHTML="<p><b>Total a pagar: "+money(data.total)+"</b></p><input readonly aria-label='Enlace de Mercado Pago' style='width:100%;padding:10px' value='"+esc(data.url)+"'><button id='mpCopy' class='btn secondary' type='button'>Copiar enlace</button>";
   panel.querySelector('#mpCopy').onclick=async()=>{try{await navigator.clipboard.writeText(data.url);panel.querySelector('#mpCopy').textContent='Copiado';}catch{out.querySelector('input').select();}};
   renderPaymentDraft(panel,order,data);
   if(action==='generar')await loadAll();
  }else{
   out.className='order-msg '+(data.pagado?'ok':'');out.textContent=data.message;
   if(data.pagado){document.getElementById('detailPaymentStatus').value='pagado';await loadAll();}
  }
 }catch(e){if(document.getElementById('mpPaymentPanel')===panel){out.className='order-msg error';out.textContent=e.message;}}
 finally{buttons.forEach(b=>b.disabled=false);}
}
const openOrderBeforePayments=openOrder;
openOrder=async function(id){await openOrderBeforePayments(id);if(currentOrderId===id&&document.getElementById('detailPaymentStatus')){const order=ordersCache.find(o=>o.id===id);if(order)renderMercadoPago(order);}};
