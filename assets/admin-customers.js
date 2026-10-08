let customersCache=[],currentCustomerId=null,buyerNotesLoaded=true;
const buyerFields=['nombre','whatsapp','telefono','email','empresa','localidad','provincia','direccion','piso_depto','codigo_postal','dias_atencion','horario_atencion','horario_entrega','contacto_preferido','referencias'];
const buyerRegistrationUrl='https://dejavu-shop.vercel.app/cliente.html?registro=1';
function buyerMsg(text,ok=false){const el=document.getElementById('buyerStatus');el.textContent=text;el.className='order-msg '+(ok?'ok':'error');}
function customerOrders(id){return ordersCache.filter(o=>o.cliente_id===id).sort((a,b)=>new Date(b.creado_en)-new Date(a.creado_en));}
async function loadCustomers(){
 const {data,error}=await sb.from('clientes_tienda').select('*').order('nombre');
 const box=document.getElementById('customersStatus');
 if(error){box.textContent='No se pudo cargar la lista de clientes: '+error.message;box.className='order-msg error';return;}
 box.textContent='';customersCache=data||[];renderCustomers();
}
function renderCustomers(){
 const search=document.getElementById('customerSearch').value.toLowerCase().trim(),type=document.getElementById('customerType').value;
 const rows=customersCache.filter(c=>(!type||(type==='cuenta'?!!c.auth_user_id:!c.auth_user_id))&&(!search||[c.nombre,c.empresa,c.whatsapp,c.telefono,c.email,c.localidad,c.direccion].some(v=>String(v||'').toLowerCase().includes(search))));
 document.getElementById('customerCount').textContent=rows.length+' cliente'+(rows.length===1?'':'s');
 document.getElementById('customersBody').innerHTML=rows.length?rows.map(c=>{const orders=customerOrders(c.id),active=orders.filter(o=>!['Entregado','Cancelado'].includes(o.estado)),spent=orders.filter(o=>o.estado!=='Cancelado').reduce((sum,o)=>sum+Number(o.total||0),0);return '<tr><td><b>'+esc(c.nombre||'Sin nombre')+'</b><br><small>'+esc(c.empresa||'')+'</small><br><span class="badge">'+(c.auth_user_id?'Con cuenta':'Sin cuenta')+'</span></td><td>'+esc(c.whatsapp||'Sin WhatsApp')+'<br>'+esc(c.email||'Sin email')+'</td><td>'+esc(c.localidad||'A completar')+'<br><small>'+esc(c.direccion||'Sin dirección')+'</small></td><td>'+orders.length+' pedido(s)<br><small>'+active.length+' en curso</small><br>'+money(spent)+'</td><td><button class="btn primary" onclick="openCustomer(\''+c.id+'\')">Ficha y pedidos</button></td></tr>';}).join(''):'<tr><td colspan="5">'+(customersCache.length?'No hay clientes que coincidan con la búsqueda.':'Todavía no hay clientes. Podés agregar uno o compartir el enlace de registro.')+'</td></tr>';
}
function renderCustomerHistory(id){
 const orders=customerOrders(id),active=orders.filter(o=>!['Entregado','Cancelado'].includes(o.estado)),past=orders.filter(o=>['Entregado','Cancelado'].includes(o.estado));
 const table=list=>list.length?'<div class="customer-table"><table><thead><tr><th>Pedido / fecha</th><th>Total</th><th>Estado / pago</th><th></th></tr></thead><tbody>'+list.map(o=>'<tr><td><b>'+esc(o.numero)+'</b><br>'+new Date(o.creado_en).toLocaleDateString('es-AR')+'</td><td>'+money(o.total)+'</td><td>'+esc(o.estado)+'<br><small>'+esc(o.estado_pago||'pendiente')+'</small></td><td><button class="btn secondary" type="button" onclick="openCustomerOrder(\''+o.id+'\')">Ver productos y pedido</button></td></tr>').join('')+'</tbody></table></div>':'<p class="muted">Sin pedidos en esta sección.</p>';
 document.getElementById('buyerHistory').innerHTML='<h3>Pedidos en curso ('+active.length+')</h3>'+table(active)+'<h3>Pedidos anteriores ('+past.length+')</h3>'+table(past);
}
async function openCustomer(id=null){
 currentCustomerId=id;const c=customersCache.find(c=>c.id===id)||{};const form=document.getElementById('buyerForm');form.reset();
 document.getElementById('buyerTitle').textContent=id?'Ficha de '+(c.nombre||'cliente'):'Nuevo cliente';
 document.getElementById('buyerAccount').textContent=c.auth_user_id?'Comprador con cuenta registrada':'Comprador sin cuenta. Puede registrarse desde el enlace de compradores.';
 for(const key of buyerFields)form.elements[key].value=c[key]||(key==='contacto_preferido'?'WhatsApp':'');
 buyerNotesLoaded=!id;form.elements.notas_admin.disabled=!!id;form.elements.notas_admin.value='';document.getElementById('buyerStatus').textContent='';document.getElementById('buyerHistory').innerHTML='';
 const contact=document.getElementById('buyerContact');contact.innerHTML='<a class="btn secondary" target="_blank" rel="noopener" href="'+buyerRegistrationUrl+'">Abrir registro</a>'+(c.whatsapp?'<a class="btn whatsapp" target="_blank" rel="noopener" href="'+esc(waLink(c.whatsapp))+'">Abrir WhatsApp</a><a class="btn secondary" target="_blank" rel="noopener" href="'+esc(waLink(c.whatsapp)+'?text='+encodeURIComponent('Hola '+c.nombre+'. Podés registrarte como comprador de DÉJÀ VU y completar tus datos acá: '+buyerRegistrationUrl))+'">Preparar invitación a registrarse</a>':'')+(c.email?'<a class="btn secondary" href="mailto:'+esc(encodeURIComponent(c.email))+'">Escribir email</a>':'');
 document.getElementById('buyerModal').classList.add('open');
 if(!id)return;
 renderCustomerHistory(id);
 const {data,error}=await sb.from('cliente_notas_admin').select('notas').eq('cliente_id',id).maybeSingle();
 if(currentCustomerId!==id)return;
 if(error)buyerMsg('No se pudieron cargar las notas internas. La ficha sigue disponible.');
 else{buyerNotesLoaded=true;form.elements.notas_admin.disabled=false;form.elements.notas_admin.value=data?.notas||'';}
}
function closeCustomer(){document.getElementById('buyerModal').classList.remove('open');currentCustomerId=null;}
function openCustomerOrder(id){closeCustomer();show('pedidos');openOrder(id);}
async function saveCustomer(e){
 e.preventDefault();const form=document.getElementById('buyerForm'),data=Object.fromEntries(buyerFields.map(k=>[k,form.elements[k].value.trim()]));
 if(!data.nombre||data.whatsapp.replace(/\D/g,'').length<8){buyerMsg('Completá el nombre y un WhatsApp válido.');return;}
 if(data.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)){buyerMsg('Ingresá un email válido.');return;}
 const btn=document.getElementById('buyerSave');btn.disabled=true;buyerMsg('Guardando ficha...',true);
 try{
  let id=currentCustomerId;const payload={...data,actualizado_en:new Date().toISOString()};
  const result=id?await sb.from('clientes_tienda').update(payload).eq('id',id).select('id').single():await sb.from('clientes_tienda').insert(payload).select('id').single();
  if(result.error)throw result.error;id=result.data.id;currentCustomerId=id;
  const {error:notesError}=buyerNotesLoaded?await sb.from('cliente_notas_admin').upsert({cliente_id:id,notas:form.elements.notas_admin.value.trim(),actualizado_en:new Date().toISOString()}):{error:null};
  await loadCustomers();renderCustomerHistory(id);
  if(notesError){buyerMsg('Los datos del cliente se guardaron, pero las notas internas no: '+notesError.message);return;}
  await openCustomer(id);document.getElementById('buyerTitle').textContent='Ficha de '+data.nombre;buyerMsg('Ficha del cliente guardada. Los datos de pedidos anteriores se conservan.',true);
 }catch(error){buyerMsg(error.code==='23505'?'Ya existe un cliente sin cuenta con ese nombre y WhatsApp. Buscalo para editar su ficha.':'No se pudo guardar: '+error.message);}
 finally{btn.disabled=false;}
}
async function copyBuyerRegistration(){
 try{await navigator.clipboard.writeText(buyerRegistrationUrl);document.getElementById('customersStatus').textContent='Enlace de registro copiado.';}
 catch{document.getElementById('buyerRegistration').select();document.getElementById('customersStatus').textContent='Seleccioná y copiá el enlace de registro.';}
}
document.getElementById('buyerRegistration').value=buyerRegistrationUrl;
document.getElementById('buyerForm').addEventListener('submit',saveCustomer);

sb.auth.onAuthStateChange(()=>setTimeout(boot,0));boot();
