create table public.mercadopago_cobros (
 pedido_id uuid primary key references public.pedidos(id) on delete restrict,
 referencia uuid not null unique default gen_random_uuid(),
 subtotal numeric(14,2) not null check(subtotal>0),
 envio numeric(14,2) not null check(envio>=0),
 total numeric(14,2) not null check(total=subtotal+envio),
 preferencia_id text unique, enlace text, pago_id text unique,
 creado_en timestamptz not null default now()
);
alter table public.mercadopago_cobros enable row level security;
revoke all on public.mercadopago_cobros from anon,authenticated;
grant all on public.mercadopago_cobros to service_role;
create function public.reservar_cobro_mp(p_pedido uuid,p_envio numeric)
returns public.mercadopago_cobros language plpgsql security invoker set search_path=public as $$
declare o public.pedidos; c public.mercadopago_cobros; gratis boolean;
begin
 select * into o from public.pedidos where id=p_pedido for update;
 if not found then raise exception 'Pedido inexistente'; end if;
 if lower(o.estado)='cancelado' or o.estado_pago in ('pagado','cancelado') then raise exception 'Este pedido no admite un cobro'; end if;
 select * into c from public.mercadopago_cobros where pedido_id=p_pedido;
 if found then
  if o.subtotal<>c.subtotal or o.total<>c.total then raise exception 'El importe del pedido cambió. Revisá el cobro existente'; end if;
  return c;
 end if;
 gratis := (o.zona_envio='CABA' and o.subtotal>=30000) or (o.zona_envio='Campana' and o.subtotal>=40000);
 if not gratis and (p_envio is null or p_envio<0 or p_envio<>round(p_envio,2)) then raise exception 'Confirmá el costo de envío antes de generar el enlace'; end if;
 insert into public.mercadopago_cobros(pedido_id,subtotal,envio,total)
 values(p_pedido,o.subtotal,case when gratis then 0 else p_envio end,o.subtotal+case when gratis then 0 else p_envio end) returning * into c;
 update public.pedidos set costo_envio=c.envio,total=c.total,actualizado_en=now() where id=p_pedido;
 return c;
end $$;
revoke all on function public.reservar_cobro_mp(uuid,numeric) from public,anon,authenticated;
grant execute on function public.reservar_cobro_mp(uuid,numeric) to service_role;
create function public.confirmar_cobro_mp(p_pedido uuid,p_pago text)
returns void language plpgsql security invoker set search_path=public as $$
declare o public.pedidos; c public.mercadopago_cobros;
begin
 select * into o from public.pedidos where id=p_pedido for update;
 select * into c from public.mercadopago_cobros where pedido_id=p_pedido for update;
 if c.pedido_id is null or o.total<>c.total or o.subtotal<>c.subtotal or lower(o.estado)='cancelado' then raise exception 'El pedido requiere revisión antes de registrar el pago'; end if;
 if c.pago_id is not null and c.pago_id<>p_pago then raise exception 'Ya hay otro pago registrado. Revisá Mercado Pago'; end if;
 update public.mercadopago_cobros set pago_id=p_pago where pedido_id=p_pedido;
 update public.pedidos set estado_pago='pagado',metodo_pago='Mercado Pago',actualizado_en=now() where id=p_pedido;
end $$;
revoke all on function public.confirmar_cobro_mp(uuid,text) from public,anon,authenticated;
grant execute on function public.confirmar_cobro_mp(uuid,text) to service_role;