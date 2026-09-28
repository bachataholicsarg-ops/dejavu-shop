-- DÉJÀ VU v2 — esquema inicial de tienda, pedidos y vendedores
-- Diseñado para Supabase/Postgres con RLS habilitado.

create extension if not exists pgcrypto;

create table if not exists public.vendedores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  nombre text not null,
  codigo text not null unique,
  porcentaje_comision numeric(5,2) not null default 10.00 check (porcentaje_comision >= 0 and porcentaje_comision <= 100),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.productos (
  id uuid primary key default gen_random_uuid(),
  sku text unique,
  nombre text not null,
  descripcion text,
  categoria text,
  costo numeric(12,2) check (costo is null or costo >= 0),
  precio numeric(12,2) check (precio is null or precio >= 0),
  stock integer not null default 0 check (stock >= 0),
  imagen_url text,
  source_url text,
  activo boolean not null default true,
  destacado boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.configuracion_envios (
  id uuid primary key default gen_random_uuid(),
  zona text not null unique,
  costo numeric(12,2) not null default 0 check (costo >= 0),
  minimo_envio_gratis numeric(12,2) check (minimo_envio_gratis is null or minimo_envio_gratis >= 0),
  activo boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.configuracion_envios (zona, costo, minimo_envio_gratis)
values
  ('CABA', 0, 30000),
  ('CAMPANA', 0, 40000)
on conflict (zona) do update set minimo_envio_gratis = excluded.minimo_envio_gratis;

create table if not exists public.pedidos (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated always as identity unique,
  vendedor_id uuid references public.vendedores(id) on delete set null,
  cliente_nombre text not null,
  whatsapp text not null,
  email text,
  direccion text not null,
  piso_depto text,
  localidad text not null,
  provincia text not null,
  codigo_postal text,
  referencias text,
  zona_envio text,
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  costo_envio numeric(12,2) not null default 0 check (costo_envio >= 0),
  total numeric(12,2) not null default 0 check (total >= 0),
  porcentaje_comision numeric(5,2) not null default 0 check (porcentaje_comision >= 0 and porcentaje_comision <= 100),
  comision_vendedor numeric(12,2) not null default 0 check (comision_vendedor >= 0),
  estado text not null default 'nuevo' check (estado in ('nuevo','pagado','preparando','enviado','entregado','cancelado')),
  comision_pagada boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.items_pedido (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  producto_id uuid references public.productos(id) on delete set null,
  nombre_producto text not null,
  cantidad integer not null check (cantidad > 0),
  precio_unitario numeric(12,2) not null check (precio_unitario >= 0),
  subtotal numeric(12,2) not null check (subtotal >= 0)
);

create table if not exists public.pagos_comisiones (
  id uuid primary key default gen_random_uuid(),
  vendedor_id uuid not null references public.vendedores(id) on delete restrict,
  monto numeric(12,2) not null check (monto > 0),
  desde timestamptz,
  hasta timestamptz,
  notas text,
  created_at timestamptz not null default now()
);

create index if not exists idx_pedidos_vendedor on public.pedidos(vendedor_id);
create index if not exists idx_pedidos_estado on public.pedidos(estado);
create index if not exists idx_pedidos_created_at on public.pedidos(created_at desc);
create index if not exists idx_items_pedido_pedido on public.items_pedido(pedido_id);

-- RLS
alter table public.vendedores enable row level security;
alter table public.productos enable row level security;
alter table public.configuracion_envios enable row level security;
alter table public.pedidos enable row level security;
alter table public.items_pedido enable row level security;
alter table public.pagos_comisiones enable row level security;

-- Lectura pública limitada al catálogo y envíos activos.
create policy "catalogo_publico" on public.productos for select to anon, authenticated using (activo = true);
create policy "envios_publicos" on public.configuracion_envios for select to anon, authenticated using (activo = true);

-- Un vendedor autenticado solo ve su propia ficha y sus pedidos.
create policy "vendedor_ve_su_ficha" on public.vendedores for select to authenticated
using ((select auth.uid()) = user_id);

create policy "vendedor_ve_sus_pedidos" on public.pedidos for select to authenticated
using (vendedor_id in (select id from public.vendedores where user_id = (select auth.uid())));

create policy "vendedor_ve_items_de_sus_pedidos" on public.items_pedido for select to authenticated
using (pedido_id in (
  select p.id from public.pedidos p
  join public.vendedores v on v.id = p.vendedor_id
  where v.user_id = (select auth.uid())
));

-- Las altas/cambios administrativos y la creación definitiva de pedidos se harán
-- desde funciones/API server-side con credenciales no expuestas al navegador.

-- Grants explícitos: Supabase 2026 ya no expone automáticamente tablas nuevas al Data API.
grant select on public.productos to anon, authenticated;
grant select on public.configuracion_envios to anon, authenticated;
grant select on public.vendedores to authenticated;
grant select on public.pedidos to authenticated;
grant select on public.items_pedido to authenticated;

comment on column public.pedidos.comision_vendedor is 'Comisión calculada sobre subtotal de productos; excluye envío.';
comment on column public.pedidos.porcentaje_comision is 'Snapshot del porcentaje vigente al momento de la venta.';
