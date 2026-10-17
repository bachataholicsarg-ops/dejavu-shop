// The browser prepares WhatsApp drafts; the administrator reviews and sends them.
const orderPaymentLinks=new Map();
function orderReplyText(order,payment){
 const lines=['Hola '+order.cliente_nombre+' 💛 Gracias por tu pedido '+order.numero+' en Déjà Vu.'];
 if(order.items?.length){
  lines.push('Detalle de tu compra:\n'+order.items.map(item=>
   '• '+item.cantidad+' × '+item.producto_nombre+' — '+money(item.precio_unitario)+' c/u · '+money(item.subtotal)
  ).join('\n'));
 }
 if(order.subtotal!=null)lines.push('Total de productos: '+money(order.subtotal));
 if(payment){
  const shipping=Number(payment.total)-Number(order.subtotal);
  if(order.subtotal!=null&&Number.isFinite(shipping)&&shipping>=0)lines.push(shipping===0?'Envío: sin cargo.':'Envío: '+money(shipping));
  lines.push('TOTAL A PAGAR: '+money(payment.total),'Pagá tu pedido de forma segura con Mercado Pago:\n'+payment.url,'Cuando completes el pago, lo verificamos y coordinamos la entrega. Si tenés alguna consulta, respondé este mensaje.');
 }else lines.push('Vamos a confirmar la entrega y te compartimos por este chat el enlace de pago con el total final.');
 return lines.join('\n\n');
}
async function prepareOrderReply(id){
 await openOrder(id);
 document.getElementById('mpPaymentPanel')?.scrollIntoView({behavior:'smooth',block:'start'});
 document.getElementById('mpDraft')?.focus({preventScroll:true});
}
function orderReplyUrl(order){return waLink(order.cliente_whatsapp)+'?text='+encodeURIComponent(orderReplyText(order,orderPaymentLinks.get(order.id)));}
let deletingOrder=false;
async function deleteOrder(id){
 const order=ordersCache.find(x=>x.id===id);if(!order||deletingOrder)return;
 if(!confirm('¿Eliminar el pedido '+order.numero+' de la lista de administración? Se conserva el historial de pagos y productos. Esto no cancela cobros ni devuelve stock.'))return;
 deletingOrder=true;
 try{
  const {data,error}=await sb.from('pedidos').update({eliminado_en:new Date().toISOString(),actualizado_en:new Date().toISOString()}).eq('id',id).is('eliminado_en',null).select('id').single();
  if(error||!data)throw Error(error?.message||'El pedido no se pudo eliminar.');
  if(currentOrderId===id)closeOrderModal();await loadAll();
 }catch(e){alert('No se pudo eliminar el pedido: '+e.message);}
 finally{deletingOrder=false;}
}
async function dvPayOrder(token,target){
 const buttons=target.querySelectorAll('[data-pay-order]');buttons.forEach(b=>b.disabled=true);
 const status=target.querySelector('[data-pay-status]');status.textContent='Preparando tu pago seguro...';
 try{
  const r=await fetch(SUPABASE_URL+'/functions/v1/mercadopago-pedido',{method:'POST',headers:{'Content-Type':'application/json',apikey:SUPABASE_KEY},body:JSON.stringify({action:'pagar',pago_token:token})});
  const j=await r.json();if(!r.ok)throw Error(j.error||'No pudimos abrir el pago. Tu pedido ya está guardado.');
  const u=new URL(j.url);if(u.protocol!=='https:'||u.hostname!=='www.mercadopago.com.ar')throw Error('No pudimos validar el enlace de pago.');
  status.textContent='Abriendo Mercado Pago...';location.assign(u.href);
 }catch(e){status.textContent=e.message+' No vuelvas a crear el pedido; podés reintentar el pago o coordinar por WhatsApp.';}
 finally{buttons.forEach(b=>b.disabled=false);}
}
