begin;
create table if not exists public.clientes_tienda (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null default '', whatsapp text not null default '', localidad text not null default '',
  direccion text not null default '', piso_depto text not null default '', codigo_postal text not null default '',
  referencias text not null default '', actualizado_en timestamptz not null default now()
);
alter table public.clientes_tienda enable row level security;
grant select, insert, update on public.clientes_tienda to authenticated;
revoke all on public.clientes_tienda from anon;
create policy clientes_propios_select on public.clientes_tienda for select to authenticated using ((select auth.uid())=auth_user_id);
create policy clientes_propios_insert on public.clientes_tienda for insert to authenticated with check ((select auth.uid())=auth_user_id);
create policy clientes_propios_update on public.clientes_tienda for update to authenticated using ((select auth.uid())=auth_user_id) with check ((select auth.uid())=auth_user_id);
grant all on public.clientes_tienda to service_role;
alter table public.pedidos add column if not exists cliente_auth_id uuid references auth.users(id) on delete set null;
create index if not exists pedidos_cliente_auth_idx on public.pedidos(cliente_auth_id) where cliente_auth_id is not null;
create table if not exists public.pedido_enlaces_cliente (
  pedido_id uuid primary key references public.pedidos(id) on delete cascade,
  token_hash text not null unique,
  vence_en timestamptz not null,
  usado_en timestamptz
);
alter table public.pedido_enlaces_cliente enable row level security;
revoke all on public.pedido_enlaces_cliente from anon,authenticated;
grant all on public.pedido_enlaces_cliente to service_role;
commit;
