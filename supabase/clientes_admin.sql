begin;
alter table public.clientes_tienda add column id uuid not null default gen_random_uuid();
alter table public.clientes_tienda drop constraint clientes_tienda_pkey;
alter table public.clientes_tienda alter column auth_user_id drop not null;
alter table public.clientes_tienda add primary key(id);
alter table public.clientes_tienda add constraint clientes_auth_user_unique unique(auth_user_id);
alter table public.clientes_tienda
  add column email text not null default '',
  add column telefono text not null default '',
  add column provincia text not null default '',
  add column empresa text not null default '',
  add column dias_atencion text not null default '',
  add column horario_atencion text not null default '',
  add column horario_entrega text not null default '',
  add column contacto_preferido text not null default 'WhatsApp',
  add column creado_en timestamptz not null default now(),
  add column whatsapp_normalizado text generated always as (regexp_replace(whatsapp,'[^0-9]','','g')) stored;
create unique index clientes_invitados_identidad_idx on public.clientes_tienda(whatsapp_normalizado,lower(btrim(nombre))) where auth_user_id is null and whatsapp_normalizado<>'';
create policy clientes_admin_all on public.clientes_tienda for all to authenticated using ((select public.is_dejavu_admin())) with check ((select public.is_dejavu_admin()));
alter table public.pedidos add column cliente_id uuid references public.clientes_tienda(id) on delete restrict;
create index pedidos_cliente_id_idx on public.pedidos(cliente_id,creado_en desc);
create table public.cliente_notas_admin (
  cliente_id uuid primary key references public.clientes_tienda(id) on delete cascade,
  notas text not null default '', actualizado_en timestamptz not null default now()
);
alter table public.cliente_notas_admin enable row level security;
grant select,insert,update on public.cliente_notas_admin to authenticated;
revoke all on public.cliente_notas_admin from anon;
grant all on public.cliente_notas_admin to service_role;
create policy cliente_notas_admin_only on public.cliente_notas_admin for all to authenticated using ((select public.is_dejavu_admin())) with check ((select public.is_dejavu_admin()));
create or replace function public.vincular_cliente_pedido() returns trigger language plpgsql security invoker set search_path=public as $fn$
declare v_cliente uuid;
begin
  if new.cliente_auth_id is not null then
    select id into v_cliente from public.clientes_tienda where auth_user_id=new.cliente_auth_id;
    if v_cliente is null then
      insert into public.clientes_tienda(auth_user_id,nombre,whatsapp,localidad,direccion,piso_depto,codigo_postal,email,referencias)
      values(new.cliente_auth_id,new.cliente_nombre,new.cliente_whatsapp,new.localidad,new.direccion,coalesce(new.piso_depto,''),coalesce(new.codigo_postal,''),coalesce(new.cliente_email,''),coalesce(new.referencias,'')) returning id into v_cliente;
    end if;
    update public.clientes_tienda set email=new.cliente_email where id=v_cliente and email='' and coalesce(new.cliente_email,'')<>'';
  else
    insert into public.clientes_tienda(nombre,whatsapp,localidad,direccion,piso_depto,codigo_postal,email,referencias)
    values(new.cliente_nombre,new.cliente_whatsapp,new.localidad,new.direccion,coalesce(new.piso_depto,''),coalesce(new.codigo_postal,''),coalesce(new.cliente_email,''),coalesce(new.referencias,''))
    on conflict(whatsapp_normalizado,lower(btrim(nombre))) where auth_user_id is null and whatsapp_normalizado<>''
    do update set localidad=excluded.localidad,direccion=coalesce(nullif(excluded.direccion,''),clientes_tienda.direccion),
      piso_depto=coalesce(nullif(excluded.piso_depto,''),clientes_tienda.piso_depto),codigo_postal=coalesce(nullif(excluded.codigo_postal,''),clientes_tienda.codigo_postal),
      email=coalesce(nullif(excluded.email,''),clientes_tienda.email),referencias=coalesce(nullif(excluded.referencias,''),clientes_tienda.referencias),actualizado_en=now()
    returning id into v_cliente;
  end if;
  new.cliente_id:=v_cliente;
  return new;
end;
$fn$;
revoke execute on function public.vincular_cliente_pedido() from public,anon,authenticated;
grant execute on function public.vincular_cliente_pedido() to service_role;
create trigger pedidos_vincular_cliente before insert or update of cliente_auth_id,cliente_nombre,cliente_whatsapp,localidad,direccion,piso_depto,codigo_postal,cliente_email,referencias on public.pedidos for each row execute function public.vincular_cliente_pedido();
do $backfill$
declare v_id uuid;
begin
  for v_id in select id from public.pedidos order by creado_en asc loop
    update public.pedidos set cliente_auth_id=cliente_auth_id where id=v_id;
  end loop;
end;
$backfill$;
update public.clientes_tienda c set email=u.email from auth.users u where c.auth_user_id=u.id and c.email='';
commit;
