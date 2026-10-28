-- =====================================================================
-- BARBERÍAS · 0024 · GASTOS CON FOTO PRIVADA (tarea 3.6 · SPEC F8)
--
--   registrar_gasto(...)    registra un gasto: monto, categoría, cómo se pagó, nota y foto opcional.
--   anular_gasto(id, motivo) lo anula con motivo (no se borra ni se edita).
--   obtener_gastos(fecha)   los gastos de un día con sus totales (por medio y por categoría).
--   obtener_gasto(id)       un gasto con su foto y quién lo registró.
--
-- REGLAS
--   * Pesos enteros. Categorías fijas: arriendo, insumos, servicios públicos, comisiones y otros. El medio (efectivo o
--     transferencia) importa para el cierre: el efectivo esperado resta los gastos pagados en efectivo.
--   * Un gasto no se edita ni se borra: se anula con motivo. Quién lo registró y cuándo quedan guardados.
--   * Idempotente: la pantalla crea una clave al abrirse; repetirla devuelve el mismo gasto (un doble toque no duplica).
--   * La foto (el recibo) es PRIVADA: vive en el bucket `gastos-fotos` bajo la carpeta de la barbería
--     (<barberia_id>/<clave>.jpg). Nadie la ve con un enlace público: la app la sirve solo a quien tiene permiso.
--   * `fecha` es el día al que pertenece (lo pone fn_jornada, como en los cobros).
--   * Permiso: área "gastos" para registrar y anular; "gastos" y "cierre" ven los gastos.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Categorías
-- ---------------------------------------------------------------------
create or replace function public.fn_categorias_gasto()
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$ select array['arriendo', 'insumos', 'servicios_publicos', 'comisiones', 'otros'] $$;

-- ---------------------------------------------------------------------
-- 2. Tabla
-- ---------------------------------------------------------------------
create table if not exists public.gastos (
  id              uuid primary key default gen_random_uuid(),
  barberia_id     uuid not null references public.barberias(id),
  clave           uuid not null,                          -- idempotencia: la crea la pantalla al abrirse
  monto           integer not null check (monto > 0 and monto <= 50000000),
  categoria       text not null check (categoria = any (public.fn_categorias_gasto())),
  medio           text not null check (medio in ('efectivo', 'transferencia')),
  nota            text check (nota is null or length(btrim(nota)) between 1 and 120),
  foto_ruta       text check (foto_ruta is null or foto_ruta ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'),
  fecha           date not null,                          -- el día al que pertenece (lo pone fn_jornada)
  anulado         boolean not null default false,
  anulado_motivo  text,
  anulado_por     uuid references auth.users(id) on delete set null,
  anulado_at      timestamptz,
  created_at      timestamptz not null default now(),
  registrado_por  uuid default auth.uid() references auth.users(id) on delete set null,
  unique (barberia_id, id),
  constraint ux_gastos_clave unique (barberia_id, clave),
  constraint chk_gasto_foto_de_la_barberia check (foto_ruta is null or foto_ruta like barberia_id::text || '/%'),
  constraint chk_gasto_anulacion check (
    (anulado = false and anulado_motivo is null and anulado_at is null)
    or (anulado = true and length(btrim(coalesce(anulado_motivo, ''))) > 0 and anulado_at is not null)
  )
);
create index if not exists idx_gastos_fecha on public.gastos (barberia_id, fecha) where not anulado;
create index if not exists idx_gastos_creado on public.gastos (barberia_id, created_at desc);
comment on table public.gastos is 'Gastos de la barbería. No se editan ni se borran: se anulan con motivo.';

-- El día del gasto al insertarlo.
create or replace function public.fn_gasto_fecha()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.fecha := public.fn_jornada(new.barberia_id, coalesce(new.created_at, now()));
  return new;
end $$;

drop trigger if exists trg_gasto_fecha on public.gastos;
create trigger trg_gasto_fecha before insert on public.gastos
  for each row execute function public.fn_gasto_fecha();

-- De un gasto solo cambia la anulación (y, en el cierre del día, su `fecha`); un gasto anulado no se reactiva.
create or replace function public.fn_gasto_inmutables()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.id is distinct from old.id
     or new.barberia_id is distinct from old.barberia_id
     or new.clave is distinct from old.clave
     or new.monto is distinct from old.monto
     or new.categoria is distinct from old.categoria
     or new.medio is distinct from old.medio
     or new.nota is distinct from old.nota
     or new.foto_ruta is distinct from old.foto_ruta
     or new.created_at is distinct from old.created_at then
    raise exception 'Lo que ya se registró no se edita: anula el gasto con motivo y regístralo de nuevo.' using errcode = '42501';
  end if;
  if old.anulado and not new.anulado then
    raise exception 'Un gasto anulado no se reactiva: se registra de nuevo.' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_gasto_inmutables on public.gastos;
create trigger trg_gasto_inmutables before update on public.gastos
  for each row execute function public.fn_gasto_inmutables();

drop trigger if exists trg_bloquear_borrado on public.gastos;
create trigger trg_bloquear_borrado before delete on public.gastos
  for each row execute function public.fn_bloquear_borrado();

-- Lectura (RLS): «gastos» y «cierre» ven los gastos de la barbería. Se escribe solo por funciones.
alter table public.gastos enable row level security;

drop policy if exists gastos_select on public.gastos;
create policy gastos_select on public.gastos
  for select to authenticated
  using (barberia_id = (select public.mi_barberia()) and (select public.tiene_area('gastos', 'cierre')));

grant select on public.gastos to authenticated;

-- ---------------------------------------------------------------------
-- 3. Registrar y anular
-- ---------------------------------------------------------------------
create or replace function public.fn_resultado_gasto(p_barberia uuid, p_id uuid, p_ya boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_res     jsonb;
  v_anulado boolean;
begin
  select jsonb_build_object(
           'ok', true, 'ya_existia', p_ya, 'id', g.id, 'monto', g.monto, 'categoria', g.categoria,
           'medio', g.medio, 'fecha', g.fecha, 'con_foto', g.foto_ruta is not null, 'anulado', g.anulado),
         g.anulado
    into v_res, v_anulado
    from public.gastos g
   where g.barberia_id = p_barberia and g.id = p_id;

  -- Repetir la clave de un gasto que ya se anuló no lo da por hecho.
  if p_ya and coalesce(v_anulado, false) then
    raise exception 'Ese gasto ya se anuló. Abre Gastos de nuevo para registrarlo otra vez.';
  end if;
  return v_res;
end $$;

-- Registra un gasto. `p_foto_ruta` es la ruta de la foto ya subida al bucket privado (<barberia_id>/<archivo>).
create or replace function public.registrar_gasto(
  p_clave uuid, p_monto integer, p_categoria text, p_medio text, p_nota text default null, p_foto_ruta text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('gastos');
  v_prev     uuid;
  v_nota     text := nullif(left(public.fn_limpiar_texto(p_nota), 120), '');
  v_ruta     text := nullif(btrim(coalesce(p_foto_ruta, '')), '');
  v_id       uuid := gen_random_uuid();
begin
  if p_clave is null then
    raise exception 'Falta la clave del gasto. Recarga la pantalla e intenta de nuevo.';
  end if;

  -- Repetir la misma clave (doble toque, mala señal, reintento) devuelve el gasto que ya se registró.
  select g.id into v_prev from public.gastos g where g.barberia_id = v_barberia and g.clave = p_clave;
  if found then
    return public.fn_resultado_gasto(v_barberia, v_prev, true);
  end if;

  if p_monto is null or p_monto <= 0 or p_monto > 50000000 then
    raise exception 'El gasto debe ser de $ 1 a %.', public.fn_pesos(50000000);
  end if;
  if p_categoria is null or p_categoria <> all (public.fn_categorias_gasto()) then
    raise exception 'Elige la categoría del gasto.';
  end if;
  if p_medio is null or p_medio not in ('efectivo', 'transferencia') then
    raise exception 'Elige cómo se pagó el gasto: efectivo o transferencia.';
  end if;
  -- La foto tiene que estar en la carpeta de esta barbería (nadie referencia archivos de otra).
  if v_ruta is not null and v_ruta !~ ('^' || v_barberia::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then
    raise exception 'La foto del gasto no es válida.';
  end if;

  begin
    insert into public.gastos (id, barberia_id, clave, monto, categoria, medio, nota, foto_ruta)
    values (v_id, v_barberia, p_clave, p_monto, p_categoria, p_medio, v_nota, v_ruta);
  exception when unique_violation then
    -- Dos toques a la vez con la misma clave.
    select g.id into v_prev from public.gastos g where g.barberia_id = v_barberia and g.clave = p_clave;
    if found then
      return public.fn_resultado_gasto(v_barberia, v_prev, true);
    end if;
    raise;
  end;

  return public.fn_resultado_gasto(v_barberia, v_id, false);
end $$;

-- Anula un gasto con motivo.
create or replace function public.anular_gasto(p_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('gastos');
  v_motivo   text := public.fn_motivo(p_motivo);
  v_anulado  boolean;
begin
  select g.anulado into v_anulado
    from public.gastos g where g.barberia_id = v_barberia and g.id = p_id
     for update;
  if not found then
    raise exception 'No existe ese gasto.' using errcode = 'P0002';
  end if;
  if v_anulado then
    raise exception 'Este gasto ya está anulado.';
  end if;

  update public.gastos
     set anulado = true, anulado_motivo = v_motivo, anulado_por = auth.uid(), anulado_at = now()
   where barberia_id = v_barberia and id = p_id;

  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

-- ---------------------------------------------------------------------
-- 4. Lecturas
-- ---------------------------------------------------------------------

-- Los gastos de un día (sin fecha, el día en que hoy se está registrando) con sus totales, sin contar los anulados.
create or replace function public.obtener_gastos(p_fecha date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('gastos', 'cierre');
  v_fecha    date := coalesce(p_fecha, public.fn_jornada(v_barberia, now()));
begin
  return jsonb_build_object(
    'fecha', v_fecha,
    'totales', (
      select jsonb_build_object(
               'gastos', count(*)::integer,
               'total', coalesce(sum(g.monto), 0)::integer,
               'efectivo', coalesce(sum(g.monto) filter (where g.medio = 'efectivo'), 0)::integer,
               'transferencia', coalesce(sum(g.monto) filter (where g.medio = 'transferencia'), 0)::integer)
        from public.gastos g
       where g.barberia_id = v_barberia and g.fecha = v_fecha and not g.anulado),
    'por_categoria', coalesce((
      select jsonb_agg(jsonb_build_object('categoria', c.categoria, 'total', c.total, 'gastos', c.n)
                       order by c.total desc, c.categoria)
        from (select g.categoria, sum(g.monto)::integer as total, count(*)::integer as n
                from public.gastos g
               where g.barberia_id = v_barberia and g.fecha = v_fecha and not g.anulado
               group by g.categoria) c), '[]'::jsonb),
    'gastos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id, 'created_at', g.created_at, 'monto', g.monto, 'categoria', g.categoria, 'medio', g.medio,
               'nota', g.nota, 'con_foto', g.foto_ruta is not null,
               'anulado', g.anulado, 'anulado_motivo', g.anulado_motivo)
             order by g.created_at desc, g.id)
        from public.gastos g
       where g.barberia_id = v_barberia and g.fecha = v_fecha), '[]'::jsonb));
end $$;

-- Un gasto con la ruta de su foto y quién lo registró (null si no existe o es de otra barbería).
create or replace function public.obtener_gasto(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('gastos', 'cierre');
begin
  return (
    select jsonb_build_object(
             'id', g.id, 'monto', g.monto, 'categoria', g.categoria, 'medio', g.medio, 'nota', g.nota,
             'foto_ruta', g.foto_ruta, 'fecha', g.fecha, 'created_at', g.created_at,
             'registrado_por', p.nombre,
             'anulado', g.anulado, 'anulado_motivo', g.anulado_motivo, 'anulado_at', g.anulado_at)
      from public.gastos g
      left join public.perfiles p on p.barberia_id = g.barberia_id and p.user_id = g.registrado_por
     where g.barberia_id = v_barberia and g.id = p_id);
end $$;

-- ---------------------------------------------------------------------
-- 5. Fotos privadas (Storage)
-- ---------------------------------------------------------------------
-- Un bucket PRIVADO: sin enlaces públicos. Hasta 1 MB por foto (la app las comprime antes de subirlas) y solo
-- imágenes. Cada barbería escribe y lee únicamente en su carpeta (<barberia_id>/…), y solo con el permiso del área.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gastos-fotos', 'gastos-fotos', false, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists gastos_fotos_insert on storage.objects;
create policy gastos_fotos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'gastos-fotos'
    and (storage.foldername(name))[1] = (select public.mi_barberia())::text
    and (select public.tiene_area('gastos'))
  );

drop policy if exists gastos_fotos_select on storage.objects;
create policy gastos_fotos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'gastos-fotos'
    and (storage.foldername(name))[1] = (select public.mi_barberia())::text
    and (select public.tiene_area('gastos', 'cierre'))
  );

select public.fn_aplicar_permisos();
