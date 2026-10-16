// The browser prepares WhatsApp drafts; the administrator reviews and sends them.
const orderPaymentLinks=new Map();
function orderReplyText(order,payment){
 const lines=['Hola '+order.cliente_nombre+' 💛 Gracias por tu pedido '+order.numero+' en Déjà Vu.'];
 if(payment)lines.push('Total a pagar: '+money(payment.total)+'.','Podés pagar por Mercado Pago acá: '+payment.url,'Si preferís coordinar primero, respondé este mensaje y te ayudamos.');
 else lines.push('Recibimos tu pedido. Vamos a confirmar la entrega y el total con vos por este chat.');
 return lines.join('\n\n');
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
