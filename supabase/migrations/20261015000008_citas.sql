-- =====================================================================
-- BARBERÍAS · 0008 · CITAS Y LA RESTRICCIÓN ANTI-DOBLE-RESERVA (tarea 1.4 · SPEC F4)
--
--   * UNA CITA es "este cliente viene con este barbero a esta hora para este servicio". Guarda su PROPIO precio y
--     duración, copiados del catálogo al crearse (trigger): cambiar el catálogo no reescribe el pasado.
--   * La HORA FINAL es una columna generada (inicio + duración): mover una cita es cambiar solo `inicio`.
--   * NUNCA dos citas vigentes se traslapan para el mismo barbero. Lo garantiza la BASE con una restricción de
--     exclusión (gist), no la pantalla: dos personas que reservan a la vez, una gana y la otra recibe error.
--     Ocupan la hora las citas confirmadas, en atención y atendidas; las canceladas y las "no asistió" la liberan.
--   * Estados: confirmada -> en_atencion -> atendida, o cancelada (con motivo) / no_asistio. No se borra nada.
--   * También llega `clientes` (la cita lo necesita para su llave foránea). Sus pantallas y la alta automática
--     por celular son de la tarea 1.8.
--   * Lee: "agenda" y "caja" ven todas las citas; "mi_agenda" (el barbero) solo las suyas.
--   * Escribe: las funciones de crear / mover / cancelar son de la tarea 1.6 (y la reserva pública, Fase 2).
--
-- Además: `crear_bloqueo` ahora AVISA qué citas caen sobre el bloqueo (sin cancelarlas) y pide confirmar.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Suma de minutos a un instante, inmutable (para la columna generada `fin`)
--    `timestamptz + interval` es "stable" porque un intervalo con días o meses depende de la zona horaria; con
--    SOLO minutos el resultado no depende de nada, así que es seguro declararla inmutable.
-- ---------------------------------------------------------------------
create or replace function public.fn_sumar_minutos(p timestamptz, p_minutos integer)
returns timestamptz
language sql
immutable
parallel safe
set search_path = ''
as $$ select p + p_minutos * interval '1 minute' $$;

-- ---------------------------------------------------------------------
-- 2. Clientes
-- ---------------------------------------------------------------------
create table if not exists public.clientes (
  id             uuid primary key default gen_random_uuid(),
  barberia_id    uuid not null references public.barberias(id),
  nombre         text not null check (length(btrim(nombre)) between 1 and 60),
  -- WhatsApp en E.164 (+573001234567): sirve para el recordatorio de un toque con wa.me y para reconocerlo.
  telefono       text check (telefono is null or telefono ~ '^\+[1-9][0-9]{7,14}$'),
  nota           text check (nota is null or length(nota) <= 300),   -- "degradé 2 a los lados"
  activo         boolean not null default true,
  created_at     timestamptz not null default now(),
  registrado_por uuid default auth.uid() references auth.users(id) on delete set null,
  unique (barberia_id, id)
);
-- Un celular es un cliente dentro de la barbería (un cliente puede no tener celular: llegó sin cita).
create unique index if not exists ux_clientes_telefono on public.clientes (barberia_id, telefono) where telefono is not null;
create index if not exists idx_clientes_nombre on public.clientes (barberia_id, lower(nombre));
comment on table public.clientes is 'Clientes de la barbería. Se identifican por celular dentro de cada barbería.';

alter table public.clientes enable row level security;

drop policy if exists clientes_select on public.clientes;
create policy clientes_select on public.clientes
  for select to authenticated
  using (barberia_id = (select public.mi_barberia()) and (select public.tiene_area('agenda', 'mi_agenda', 'caja')));

grant select on public.clientes to authenticated;

drop trigger if exists trg_bloquear_borrado on public.clientes;
create trigger trg_bloquear_borrado before delete on public.clientes
  for each row execute function public.fn_bloquear_borrado();

-- ---------------------------------------------------------------------
-- 3. Citas
-- ---------------------------------------------------------------------
create table if not exists public.citas (
  id                      uuid primary key default gen_random_uuid(),
  barberia_id             uuid not null references public.barberias(id),
  barbero_id              uuid not null,
  cliente_id              uuid not null,
  servicio_id             uuid not null,
  -- Instante exacto (la app lo muestra siempre en hora de Bogotá), a minuto cerrado.
  inicio                  timestamptz not null check (date_trunc('minute', inicio) = inicio),
  -- COPIADOS del catálogo por el trigger al crear: lo que se pida en el insert se ignora.
  duracion_min            integer not null check (duracion_min between 5 and 480 and duracion_min % 5 = 0),
  precio                  integer not null check (precio >= 0 and precio <= 10000000),
  fin                     timestamptz generated always as (public.fn_sumar_minutos(inicio, duracion_min)) stored,
  estado                  text not null default 'confirmada'
                          check (estado in ('confirmada', 'en_atencion', 'atendida', 'cancelada', 'no_asistio')),
  -- personal = la creó alguien del equipo; cliente = la reservó el cliente en línea (Fase 2).
  origen                  text not null default 'personal' check (origen in ('personal', 'cliente')),
  -- Código secreto con el que el cliente consulta SU cita (/cita/<token>, Fase 2). No adivinable.
  token                   uuid not null default gen_random_uuid(),
  notas                   text check (notas is null or length(btrim(notas)) between 1 and 300),
  -- Se llena al tocar el botón de WhatsApp: el equipo sabe a quién ya se le recordó.
  recordatorio_enviado_at timestamptz,
  cancelada_motivo        text check (cancelada_motivo is null or length(btrim(cancelada_motivo)) between 1 and 200),
  cancelada_por           uuid references auth.users(id) on delete set null,
  cancelada_at            timestamptz,
  created_at              timestamptz not null default now(),
  registrado_por          uuid default auth.uid() references auth.users(id) on delete set null,
  unique (barberia_id, id),
  unique (token),
  foreign key (barberia_id, barbero_id)  references public.barberos (barberia_id, id),
  foreign key (barberia_id, cliente_id)  references public.clientes (barberia_id, id),
  foreign key (barberia_id, servicio_id) references public.servicios (barberia_id, id),
  -- Anular con motivo: una cita cancelada siempre dice por qué y cuándo.
  constraint chk_cita_cancelacion check (
    estado <> 'cancelada' or (cancelada_motivo is not null and cancelada_at is not null)
  ),
  -- LA REGLA CENTRAL: un barbero no tiene dos citas vigentes que se traslapen ([inicio, fin): pegadas sí).
  constraint citas_sin_traslape exclude using gist (
    barbero_id extensions.gist_uuid_ops with =,
    tstzrange(inicio, fin, '[)') with &&
  ) where (estado in ('confirmada', 'en_atencion', 'atendida'))
);
create index if not exists idx_citas_barbero on public.citas (barberia_id, barbero_id, inicio);
create index if not exists idx_citas_dia on public.citas (barberia_id, inicio);
create index if not exists idx_citas_cliente on public.citas (barberia_id, cliente_id, inicio desc);
comment on table public.citas is 'Citas: barbero, cliente, servicio y hora. Precio y duración copiados del catálogo al crearse.';
comment on constraint citas_sin_traslape on public.citas is
  'Un barbero no puede tener dos citas vigentes (confirmada, en_atencion, atendida) que se traslapen.';

alter table public.citas enable row level security;

-- "agenda" y "caja" ven todas las citas; "mi_agenda" (el barbero) solo las suyas.
drop policy if exists citas_select on public.citas;
create policy citas_select on public.citas
  for select to authenticated
  using (
    barberia_id = (select public.mi_barberia())
    and (
      (select public.tiene_area('agenda', 'caja'))
      or ((select public.tiene_area('mi_agenda')) and barbero_id = (select public.mi_barbero()))
    )
  );

grant select on public.citas to authenticated;

drop trigger if exists trg_bloquear_borrado on public.citas;
create trigger trg_bloquear_borrado before delete on public.citas
  for each row execute function public.fn_bloquear_borrado();

-- ---------------------------------------------------------------------
-- 4. Al CREAR una cita: validar que el barbero hace ese servicio y copiar su precio y duración
-- ---------------------------------------------------------------------
create or replace function public.fn_cita_preparar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barbero  record;
  v_servicio record;
  v_asignado record;
begin
  select nombre, activo into v_barbero
    from public.barberos where barberia_id = new.barberia_id and id = new.barbero_id;
  if not found then
    raise exception 'No existe ese barbero.' using errcode = 'P0002';
  end if;
  if not v_barbero.activo then
    raise exception '% ya no está activo.', v_barbero.nombre;
  end if;

  select nombre, activo, precio, duracion_min into v_servicio
    from public.servicios where barberia_id = new.barberia_id and id = new.servicio_id;
  if not found then
    raise exception 'No existe ese servicio.' using errcode = 'P0002';
  end if;
  if not v_servicio.activo then
    raise exception 'El servicio % está archivado.', v_servicio.nombre;
  end if;

  select precio_propio, duracion_propia into v_asignado
    from public.barbero_servicios where barbero_id = new.barbero_id and servicio_id = new.servicio_id;
  if not found then
    raise exception '% no hace el servicio %.', v_barbero.nombre, v_servicio.nombre;
  end if;

  -- Copia: lo que traiga el insert se descarta. La hora final sale sola (columna generada).
  new.precio := coalesce(v_asignado.precio_propio, v_servicio.precio);
  new.duracion_min := coalesce(v_asignado.duracion_propia, v_servicio.duracion_min);
  return new;
end $$;

drop trigger if exists trg_cita_preparar on public.citas;
create trigger trg_cita_preparar before insert on public.citas
  for each row execute function public.fn_cita_preparar();

-- ---------------------------------------------------------------------
-- 5. Al CAMBIAR una cita: solo se mueven la hora, el estado, las notas y el recordatorio
-- ---------------------------------------------------------------------
create or replace function public.fn_cita_inmutables()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.barberia_id is distinct from old.barberia_id
     or new.barbero_id is distinct from old.barbero_id
     or new.cliente_id is distinct from old.cliente_id
     or new.servicio_id is distinct from old.servicio_id
     or new.duracion_min is distinct from old.duracion_min
     or new.precio is distinct from old.precio
     or new.origen is distinct from old.origen
     or new.token is distinct from old.token
     or new.created_at is distinct from old.created_at then
    raise exception 'El barbero, el cliente, el servicio y el precio de una cita no se cambian. Cancela la cita y crea otra.';
  end if;
  return new;
end $$;

drop trigger if exists trg_cita_inmutables on public.citas;
create trigger trg_cita_inmutables before update on public.citas
  for each row execute function public.fn_cita_inmutables();

-- ---------------------------------------------------------------------
-- 6. Bloqueos: ahora avisan qué citas caen encima (y no las cancelan)
-- ---------------------------------------------------------------------

-- Citas por venir de un barbero que se cruzan con un rango (confirmadas o ya en atención).
create or replace function public.fn_citas_en_rango(p_barberia uuid, p_barbero uuid, p_inicio timestamptz, p_fin timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('id', c.id, 'inicio', c.inicio, 'fin', c.fin, 'estado', c.estado,
                         'cliente', cl.nombre, 'servicio', s.nombre)
      order by c.inicio, c.id),
    '[]'::jsonb)
    from public.citas c
    join public.clientes cl on cl.barberia_id = c.barberia_id and cl.id = c.cliente_id
    join public.servicios s on s.barberia_id = c.barberia_id and s.id = c.servicio_id
   where c.barberia_id = p_barberia and c.barbero_id = p_barbero
     and c.estado in ('confirmada', 'en_atencion')
     and c.inicio < p_fin and c.fin > p_inicio
$$;

-- La firma cambia (se agrega p_confirmar): se reemplaza la de 0007, no se deja una sobrecarga.
drop function if exists public.crear_bloqueo(uuid, timestamptz, timestamptz, text);

-- Si el bloqueo cae sobre citas y no se confirma, NO se guarda y se devuelven las citas:
--   {"ok": false, "motivo": "hay_citas", "citas": [...]}
-- Con p_confirmar = true se guarda y las citas quedan como están (alguien las mueve o las cancela):
--   {"ok": true, "id": "...", "citas": [...]}
create or replace function public.crear_bloqueo(p_barbero uuid, p_inicio timestamptz, p_fin timestamptz,
                                                p_motivo text default null, p_confirmar boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.fn_requerir_agenda_de(p_barbero);
  v_motivo   text := nullif(public.fn_limpiar_texto(p_motivo), '');
  v_citas    jsonb;
  v_id       uuid;
begin
  if not exists (select 1 from public.barberos where barberia_id = v_barberia and id = p_barbero and activo) then
    raise exception 'No existe ese barbero.' using errcode = 'P0002';
  end if;
  if p_inicio is null or p_fin is null or p_fin <= p_inicio then
    raise exception 'El bloqueo debe terminar después de empezar.';
  end if;
  if p_fin <= now() then
    raise exception 'Ese bloqueo ya terminó.';
  end if;
  if p_fin - p_inicio > interval '90 days' then
    raise exception 'Un bloqueo no puede durar más de 90 días.';
  end if;
  if v_motivo is not null and length(v_motivo) > 100 then
    raise exception 'El motivo es muy largo (máximo 100 letras).';
  end if;

  v_citas := public.fn_citas_en_rango(v_barberia, p_barbero, p_inicio, p_fin);
  if jsonb_array_length(v_citas) > 0 and not coalesce(p_confirmar, false) then
    return jsonb_build_object('ok', false, 'motivo', 'hay_citas', 'citas', v_citas);
  end if;

  insert into public.bloqueos (barberia_id, barbero_id, inicio, fin, motivo)
  values (v_barberia, p_barbero, p_inicio, p_fin, v_motivo)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'citas', v_citas);
end $$;

select public.fn_aplicar_permisos();
