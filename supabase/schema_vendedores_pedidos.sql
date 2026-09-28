-- DÉJÀ VU v2 - vendedores, pedidos y comisiones
create table if not exists vendedores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  email text,
  telefono text,
  codigo text unique not null,
  porcentaje_comision numeric(5,2) not null default 10.00,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

create table if not exists pedidos (
  id uuid primary key default gen_random_uuid(),
  numero text unique not null,
  cliente_nombre text not null,
  cliente_whatsapp text not null,
  cliente_email text,
  direccion text not null,
  piso_depto text,
  localidad text not null,
  codigo_postal text,
  referencias text,
  zona_envio text not null,
  subtotal numeric(12,2) not null default 0,
  costo_envio numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  estado text not null default 'nuevo',
  vendedor_id uuid references vendedores(id),
  porcentaje_comision numeric(5,2) not null default 0,
  comision_total numeric(12,2) not null default 0,
  comision_pagada boolean not null default false,
  creado_en timestamptz not null default now()
);

create table if not exists pedido_items (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references pedidos(id) on delete cascade,
  producto_id text not null,
  producto_nombre text not null,
  cantidad integer not null check (cantidad > 0),
  precio_unitario numeric(12,2) not null,
  subtotal numeric(12,2) not null
);

create table if not exists configuracion_envios (
  zona text primary key,
  costo_envio numeric(12,2) not null default 0,
  minimo_envio_gratis numeric(12,2),
  activo boolean not null default true
);

insert into configuracion_envios(zona,costo_envio,minimo_envio_gratis)
values
('CABA',0,30000),
('Campana',0,40000)
on conflict (zona) do update
set minimo_envio_gratis=excluded.minimo_envio_gratis;

-- La comisión se congela en el pedido al momento de crearlo.
-- Así, si luego cambia el porcentaje del vendedor, no cambia el histórico.
