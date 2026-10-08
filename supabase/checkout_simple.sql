CREATE OR REPLACE FUNCTION public.crear_pedido_atomic(p_body jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_items jsonb := coalesce(p_body->'items','[]'::jsonb);
  v_item jsonb;
  v_prod record;
  v_qty int;
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_costo_envio numeric := 0;
  v_minimo_gratis numeric := null;
  v_envio_gratis boolean := false;
  v_envio_a_cotizar boolean := true;
  v_numero text;
  v_pedido_id uuid;
  v_vendedor_id uuid;
  v_vendedor_email text;
  v_vendedor_nombre text;
  v_pct numeric := 0;
  v_comision numeric := 0;
  v_codigo text := lower(trim(coalesce(p_body->>'vendedor','')));
  v_zona text := coalesce(nullif(trim(p_body->>'zona_envio'),''), 'Resto del país');
  v_detalles jsonb := '[]'::jsonb;
  v_items_html text := '';
  v_canal text := lower(trim(coalesce(p_body->>'canal_venta','minorista')));
  v_recargo numeric := 0;
  v_compra_minima numeric := 0;
  v_precio_unitario numeric;
  v_cliente_mayorista_id uuid;
  v_acceso_mayorista uuid;
begin
  if v_canal not in ('minorista','mayorista') then
    raise exception 'Canal de venta inválido';
  end if;

  select porcentaje_recargo, compra_minima
    into v_recargo, v_compra_minima
  from public.configuracion_precios
  where canal=v_canal;

  if not found then
    raise exception 'Configuración de precios no disponible';
  end if;

  if v_canal='mayorista' then
    begin
      v_acceso_mayorista := nullif(trim(p_body->>'acceso_mayorista'),'')::uuid;
    exception when others then
      raise exception 'Acceso mayorista inválido';
    end;

    select cm.id, cm.vendedor_id
      into v_cliente_mayorista_id, v_vendedor_id
    from public.clientes_mayoristas cm
    join public.vendedores v on v.id=cm.vendedor_id
    where cm.acceso_token=v_acceso_mayorista
      and cm.activo=true
      and v.activo=true
    limit 1;

    if v_cliente_mayorista_id is null then
      raise exception 'Acceso mayorista inválido o vencido';
    end if;

    select porcentaje_comision,email,nombre
      into v_pct,v_vendedor_email,v_vendedor_nombre
    from public.vendedores
    where id=v_vendedor_id;

    v_pct := coalesce(v_pct,0);
  elsif v_codigo <> '' then
    select id, porcentaje_comision, email, nombre
      into v_vendedor_id, v_pct, v_vendedor_email, v_vendedor_nombre
    from public.vendedores
    where codigo=v_codigo and activo=true
    limit 1;
    v_pct := coalesce(v_pct,0);
  end if;

  if coalesce(trim(p_body->>'nombre'),'')='' or
     coalesce(trim(p_body->>'whatsapp'),'')='' or
     coalesce(trim(p_body->>'localidad'),'')='' or
     jsonb_array_length(v_items)=0 then
    raise exception 'Faltan datos obligatorios';
  end if;

  for v_item in select value from jsonb_array_elements(v_items)
  loop
    begin
      v_qty := greatest(1, least(200, coalesce((v_item->>'cantidad')::int,1)));
    exception when others then
      raise exception 'Cantidad inválida';
    end;

    select id,nombre,costo,precio,stock,activo
    into v_prod
    from public.productos
    where id=(v_item->>'producto_id')::uuid
    for update;

    if not found or not v_prod.activo then
      raise exception 'Uno de los productos ya no está disponible';
    end if;

    if v_prod.costo is not null then
      v_precio_unitario := round((v_prod.costo * (1 + v_recargo/100))::numeric,2);
    elsif v_prod.precio is not null and v_canal='minorista' then
      v_precio_unitario := v_prod.precio;
    else
      raise exception 'Hay productos sin costo/precio disponible';
    end if;

    if v_prod.stock is not null and v_qty > v_prod.stock then
      raise exception 'Stock insuficiente para %', v_prod.nombre;
    end if;

    v_subtotal := v_subtotal + (v_precio_unitario * v_qty);
    v_detalles := v_detalles || jsonb_build_array(jsonb_build_object(
      'producto_id',v_prod.id,
      'producto_nombre',v_prod.nombre,
      'cantidad',v_qty,
      'precio_unitario',v_precio_unitario,
      'subtotal',v_precio_unitario*v_qty,
      'controla_stock',(v_prod.stock is not null)
    ));
  end loop;

  if v_canal='mayorista' and v_subtotal < v_compra_minima then
    raise exception 'La compra mayorista mínima es de $%', trim(to_char(v_compra_minima,'FM999G999G999G990'));
  end if;

  select costo_envio, minimo_envio_gratis
    into v_costo_envio, v_minimo_gratis
  from public.configuracion_envios
  where zona=v_zona and activo=true
  limit 1;

  v_costo_envio := coalesce(v_costo_envio,0);

  if v_zona in ('CABA','Campana')
     and v_minimo_gratis is not null
     and v_subtotal >= v_minimo_gratis then
    v_envio_gratis := true;
    v_envio_a_cotizar := false;
    v_costo_envio := 0;
  elsif v_zona in ('CABA','Campana') then
    v_envio_gratis := false;
    v_envio_a_cotizar := (v_costo_envio = 0);
  else
    v_envio_gratis := false;
    v_envio_a_cotizar := true;
    v_costo_envio := 0;
  end if;

  v_comision := round((v_subtotal * v_pct / 100)::numeric,2);
  v_total := v_subtotal + v_costo_envio;
  v_numero := case when v_canal='mayorista' then 'MAY-' else 'DV-' end
              || to_char(clock_timestamp(),'YYMMDDHH24MISSMS');

  if nullif(p_body->>'cliente_auth_id','') is not null then
    insert into public.clientes_tienda(auth_user_id,nombre,whatsapp,localidad)
    values((p_body->>'cliente_auth_id')::uuid,trim(p_body->>'nombre'),trim(p_body->>'whatsapp'),trim(p_body->>'localidad'))
    on conflict(auth_user_id) do update set nombre=excluded.nombre,whatsapp=excluded.whatsapp,localidad=excluded.localidad,actualizado_en=now();
  end if;

  insert into public.pedidos(
    cliente_auth_id,numero,cliente_nombre,cliente_whatsapp,cliente_email,direccion,piso_depto,localidad,
    codigo_postal,referencias,zona_envio,fecha_entrega_preferida,franja_horaria,metodo_pago,
    contacto_preferido,subtotal,costo_envio,total,vendedor_id,porcentaje_comision,comision_total,
    estado,estado_pago,canal_venta,cliente_mayorista_id,porcentaje_recargo_aplicado
  ) values (
    nullif(p_body->>'cliente_auth_id','')::uuid,v_numero,trim(p_body->>'nombre'),trim(p_body->>'whatsapp'),nullif(trim(p_body->>'email'),''),
    coalesce(trim(p_body->>'direccion'),''),nullif(trim(p_body->>'piso_depto'),''),trim(p_body->>'localidad'),
    nullif(trim(p_body->>'codigo_postal'),''),nullif(trim(p_body->>'referencias'),''),v_zona,
    nullif(p_body->>'fecha_entrega_preferida','')::date,nullif(trim(p_body->>'franja_horaria'),''),
    coalesce(nullif(trim(p_body->>'metodo_pago'),''),'coordinar'),
    coalesce(nullif(trim(p_body->>'contacto_preferido'),''),'WhatsApp'),
    v_subtotal,v_costo_envio,v_total,v_vendedor_id,v_pct,v_comision,'Nuevo','pendiente',
    v_canal,v_cliente_mayorista_id,v_recargo
  ) returning id into v_pedido_id;

  insert into public.pedido_items(pedido_id,producto_id,producto_nombre,cantidad,precio_unitario,subtotal)
  select v_pedido_id,(x->>'producto_id')::uuid,x->>'producto_nombre',(x->>'cantidad')::int,
         (x->>'precio_unitario')::numeric,(x->>'subtotal')::numeric
  from jsonb_array_elements(v_detalles) x;

  update public.productos p
  set stock = p.stock - (x->>'cantidad')::int
  from jsonb_array_elements(v_detalles) x
  where p.id=(x->>'producto_id')::uuid
    and (x->>'controla_stock')::boolean = true;

  if v_vendedor_id is not null and coalesce(v_vendedor_email,'') <> '' then
    select string_agg(
      '<li>' || (x->>'cantidad') || ' × ' || (x->>'producto_nombre') ||
      ' — $' || trim(to_char((x->>'subtotal')::numeric,'FM999G999G999G990')),
      '</li>'
    ) into v_items_html
    from jsonb_array_elements(v_detalles) x;

    insert into public.notificaciones_email(
      pedido_id,vendedor_id,destinatario,asunto,cuerpo_html
    ) values (
      v_pedido_id,
      v_vendedor_id,
      case when v_vendedor_email<>'' then v_vendedor_email else 'sin-email' end,
      case when v_canal='mayorista' then 'Nuevo pedido mayorista ' else 'Nuevo pedido ' end || v_numero || ' · DÉJÀ VU',
      '<h2>' || case when v_canal='mayorista' then 'Nuevo pedido mayorista' else 'Nuevo pedido asignado' end || '</h2>' ||
      '<p><b>Pedido:</b> ' || v_numero || '</p>' ||
      '<p><b>Cliente:</b> ' || trim(p_body->>'nombre') || '</p>' ||
      '<p><b>WhatsApp:</b> ' || trim(p_body->>'whatsapp') || '</p>' ||
      '<p><b>Productos:</b></p><ul>' || coalesce(v_items_html,'') || '</ul>' ||
      '<p><b>Total productos:</b> $' || trim(to_char(v_subtotal,'FM999G999G999G990')) || '</p>' ||
      '<p><b>Comisión:</b> $' || trim(to_char(v_comision,'FM999G999G999G990')) || ' (' || v_pct || '%)</p>' ||
      '<p><b>Estado:</b> Nuevo</p>' ||
      '<p><a href="https://dejavu-shop.vercel.app/vendedor.html">Abrir panel de vendedor</a></p>'
    );
  end if;

  return jsonb_build_object(
    'ok',true,
    'pedido',v_numero,
    'pedido_id',v_pedido_id,
    'subtotal',v_subtotal,
    'costo_envio',v_costo_envio,
    'total',v_total,
    'zona_envio',v_zona,
    'minimo_envio_gratis',v_minimo_gratis,
    'envio_gratis',v_envio_gratis,
    'envio_a_cotizar',v_envio_a_cotizar,
    'canal_venta',v_canal,
    'porcentaje_recargo',v_recargo,
    'compra_minima',v_compra_minima,
    'vendedor_id',v_vendedor_id
  );
exception
  when invalid_text_representation then
    raise exception 'El carrito contiene productos o accesos inválidos';
end;
$function$

