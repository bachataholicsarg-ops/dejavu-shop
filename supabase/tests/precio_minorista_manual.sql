begin;
do $$
declare result jsonb; prod uuid; item_price numeric;
begin
 select id into prod from public.productos where nombre='Abrazo' and precio=2 and precio_minorista_manual=true;
 if prod is null then raise exception 'Missing manual-price fixture'; end if;
 result := public.crear_pedido_atomic(jsonb_build_object('nombre','Prueba técnica','whatsapp','5491100000000','localidad','Capital Federal','zona_envio','CABA','items',jsonb_build_array(jsonb_build_object('producto_id',prod,'cantidad',1))));
 if (result->>'subtotal')::numeric<>2 or (result->>'total')::numeric<>2 then raise exception 'Manual price was overridden'; end if;
 select precio_unitario into item_price from public.pedido_items where pedido_id=(result->>'pedido_id')::uuid;
 if item_price<>2 then raise exception 'Wrong item price'; end if;
end $$;
rollback;