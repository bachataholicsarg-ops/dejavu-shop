begin;
alter table public.pedidos add column if not exists eliminado_en timestamptz;
create table if not exists public.pedido_enlaces_pago (
 pedido_id uuid primary key references public.pedidos(id) on delete cascade,
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 vence_en timestamptz not null
);
alter table public.pedido_enlaces_pago enable row level security;
revoke all on public.pedido_enlaces_pago from public,anon,authenticated;
grant all on public.pedido_enlaces_pago to service_role;
create or replace function public.reservar_cobro_mp(p_pedido uuid,p_envio numeric)
returns public.mercadopago_cobros language plpgsql security invoker set search_path=public as $$
declare o public.pedidos; c public.mercadopago_cobros; gratis boolean;
begin
 select * into o from public.pedidos where id=p_pedido for update;
 if not found then raise exception 'Pedido inexistente'; end if;
 if o.eliminado_en is not null or lower(o.estado)='cancelado' or o.estado_pago in ('pagado','cancelado') then raise exception 'Este pedido no admite un cobro'; end if;
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
commit;
