export function shippingZone(value) {
  const s=String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[.,()]/g,' ').replace(/\s+/g,' ').trim();
  if (/^(caba|c a b a|capital|capital federal|ciudad autonoma de buenos aires|ciudad de buenos aires|buenos aires ciudad|bs as capital|caba capital federal|capital federal caba)$/.test(s)) return 'CABA';
  if (/^campana(?: buenos aires| bs as)?$/.test(s)) return 'Campana';
  return '';
}
export function shippingText(amount, locality) {
  const zone=shippingZone(locality), subtotal=Number(amount||0);
  if(zone==='CABA') return subtotal>=30000?'Envío gratis en Capital Federal (CABA).':'Envío con cargo en Capital Federal (CABA). Gratis desde $30.000; el costo se confirma por WhatsApp.';
  if(zone==='Campana') return subtotal>=40000?'Envío gratis en Campana.':'Envío con cargo en Campana. Gratis desde $40.000; el costo se confirma por WhatsApp.';
  return 'Capital Federal (CABA): '+(subtotal>=30000?'envío gratis':'envío gratis desde $30.000')+'. Campana: '+(subtotal>=40000?'envío gratis':'envío gratis desde $40.000')+'. Otros destinos: costo a coordinar por WhatsApp.';
}
