create or replace function public.completar_datos_pedido(p_token_hash text, p_datos jsonb, p_user_id uuid default null)
returns jsonb language plpgsql security invoker set search_path=public as $fn$
declare
  v_link public.pedido_enlaces_cliente%rowtype;
  v_order public.pedidos%rowtype;
  v_cost numeric:=0;
  v_zone text:=coalesce(nullif(p_datos->>'zona_envio',''),'Resto del país');
begin
  select * into v_link from public.pedido_enlaces_cliente where token_hash=p_token_hash for update;
  if not found or v_link.vence_en<=now() or v_link.usado_en is not null then raise exception 'El enlace venció o ya fue utilizado. Pedí uno nuevo por WhatsApp.'; end if;
  select * into v_order from public.pedidos where id=v_link.pedido_id for update;
  if not found or v_order.estado in ('Cancelado','Enviado','Entregado') then raise exception 'Este pedido ya no permite modificar los datos de entrega.'; end if;
  if p_user_id is not null and v_order.cliente_auth_id is not null and v_order.cliente_auth_id<>p_user_id then raise exception 'El pedido pertenece a otra cuenta.'; end if;
  if coalesce(trim(p_datos->>'nombre'),'')='' or length(regexp_replace(coalesce(p_datos->>'whatsapp',''),'[^0-9]','','g'))<8 or coalesce(trim(p_datos->>'localidad'),'')='' or coalesce(trim(p_datos->>'direccion'),'')='' then raise exception 'Completá nombre, WhatsApp, localidad y dirección.'; end if;
  select costo_envio into v_cost from public.configuracion_envios where zona=v_zone and activo=true;
  v_cost:=coalesce(v_cost,0);
  if (v_zone='CABA' and v_order.subtotal>=30000) or (v_zone='Campana' and v_order.subtotal>=40000) then v_cost:=0; end if;
  update public.pedidos set cliente_nombre=trim(p_datos->>'nombre'),cliente_whatsapp=trim(p_datos->>'whatsapp'),
    cliente_email=nullif(trim(p_datos->>'email'),''),franja_horaria=nullif(trim(p_datos->>'horario_entrega'),''),contacto_preferido=coalesce(nullif(trim(p_datos->>'contacto_preferido'),''),'WhatsApp'),
    direccion=trim(p_datos->>'direccion'),localidad=trim(p_datos->>'localidad'),zona_envio=v_zone,
    piso_depto=trim(coalesce(p_datos->>'piso_depto','')),codigo_postal=trim(coalesce(p_datos->>'codigo_postal','')),
    referencias=trim(coalesce(p_datos->>'referencias','')),cliente_auth_id=coalesce(cliente_auth_id,p_user_id),
    costo_envio=v_cost,total=subtotal+v_cost,actualizado_en=now() where id=v_order.id;
  if p_user_id is not null then
    insert into public.clientes_tienda(auth_user_id,nombre,whatsapp,localidad,direccion,piso_depto,codigo_postal,referencias)
    values(p_user_id,trim(p_datos->>'nombre'),trim(p_datos->>'whatsapp'),trim(p_datos->>'localidad'),trim(p_datos->>'direccion'),trim(coalesce(p_datos->>'piso_depto','')),trim(coalesce(p_datos->>'codigo_postal','')),trim(coalesce(p_datos->>'referencias','')))
    on conflict(auth_user_id) do update set nombre=excluded.nombre,whatsapp=excluded.whatsapp,localidad=excluded.localidad,direccion=excluded.direccion,piso_depto=excluded.piso_depto,codigo_postal=excluded.codigo_postal,referencias=excluded.referencias,actualizado_en=now();
  end if;
  update public.clientes_tienda set
    email=trim(coalesce(p_datos->>'email','')),telefono=trim(coalesce(p_datos->>'telefono','')),empresa=trim(coalesce(p_datos->>'empresa','')),
    provincia=trim(coalesce(p_datos->>'provincia','')),dias_atencion=trim(coalesce(p_datos->>'dias_atencion','')),
    horario_atencion=trim(coalesce(p_datos->>'horario_atencion','')),horario_entrega=trim(coalesce(p_datos->>'horario_entrega','')),
    contacto_preferido=coalesce(nullif(trim(p_datos->>'contacto_preferido'),''),'WhatsApp'),actualizado_en=now()
  where id=(select cliente_id from public.pedidos where id=v_order.id);
  update public.pedido_enlaces_cliente set usado_en=now() where pedido_id=v_order.id;
  return jsonb_build_object('ok',true,'pedido',v_order.numero);
end;
$fn$;
revoke execute on function public.completar_datos_pedido(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.completar_datos_pedido(text,jsonb,uuid) to service_role;
