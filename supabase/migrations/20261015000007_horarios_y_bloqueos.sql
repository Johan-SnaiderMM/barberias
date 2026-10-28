-- =====================================================================
-- BARBERÍAS · 0007 · HORARIOS, BLOQUEOS Y AJUSTES DE LA AGENDA (tarea 1.3 · SPEC F3)
--
--   * Horario semanal por barbero en FRANJAS (lunes 9:00–13:00 y 14:30–19:00). Las horas se guardan como minutos
--     desde la medianoche, hora de Bogotá (0 a 1440): sin zonas horarias de por medio. Dos franjas del mismo
--     barbero y día no se traslapan (restricción de exclusión); pegadas (13:00 y 13:00) sí se aceptan.
--   * Bloqueos puntuales (día libre, cita médica, almuerzo largo) con motivo: son instantes (timestamptz).
--     Se quitan marcándolos inactivos; nunca se borran.
--   * Ajustes de la barbería que usa la disponibilidad (1.5): paso de la reserva, días hacia adelante,
--     anticipación mínima y colchón entre citas.
--
-- Quedan para la Fase 2: el interruptor "reservas en línea" y el límite para cancelar sin llamar.
-- El aviso de "este bloqueo cae sobre citas ya agendadas" llega con las citas (1.4).
-- =====================================================================

-- La restricción de exclusión necesita btree_gist (igualdad de uuid dentro de un índice gist). Verificado en
-- el spike 0.4 (src/test/spike-btree-gist.test.ts).
create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------
-- 1. Ajustes de la agenda (en la barbería)
-- ---------------------------------------------------------------------
alter table public.barberias
  add column if not exists paso_min         integer not null default 30
    constraint chk_barberias_paso check (paso_min in (15, 30)),
  add column if not exists dias_adelante    integer not null default 30
    constraint chk_barberias_dias_adelante check (dias_adelante between 1 and 90),
  add column if not exists anticipacion_min integer not null default 60
    constraint chk_barberias_anticipacion check (anticipacion_min between 0 and 1440),
  add column if not exists colchon_min      integer not null default 0
    constraint chk_barberias_colchon check (colchon_min between 0 and 60);

comment on column public.barberias.paso_min is 'Cada cuántos minutos arranca un hueco de reserva (15 o 30).';
comment on column public.barberias.dias_adelante is 'Hasta cuántos días adelante se puede reservar en línea.';
comment on column public.barberias.anticipacion_min is 'Con cuánta anticipación mínima se reserva en línea (minutos).';
comment on column public.barberias.colchon_min is 'Minutos de descanso que se dejan entre una cita y la siguiente.';

create or replace function public.actualizar_parametros_agenda(
  p_paso_min integer, p_dias_adelante integer, p_anticipacion_min integer, p_colchon_min integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('servicios');
begin
  if p_paso_min is null or p_paso_min not in (15, 30) then
    raise exception 'Las horas de reserva arrancan cada 15 o cada 30 minutos.';
  end if;
  if p_dias_adelante is null or p_dias_adelante < 1 or p_dias_adelante > 90 then
    raise exception 'Se puede reservar de 1 a 90 días hacia adelante.';
  end if;
  if p_anticipacion_min is null or p_anticipacion_min < 0 or p_anticipacion_min > 1440 then
    raise exception 'La anticipación mínima va de 0 minutos a 24 horas.';
  end if;
  if p_colchon_min is null or p_colchon_min < 0 or p_colchon_min > 60 then
    raise exception 'El descanso entre citas va de 0 a 60 minutos.';
  end if;
  update public.barberias
     set paso_min = p_paso_min, dias_adelante = p_dias_adelante,
         anticipacion_min = p_anticipacion_min, colchon_min = p_colchon_min
   where id = v_barberia;
  return jsonb_build_object('paso_min', p_paso_min, 'dias_adelante', p_dias_adelante,
                            'anticipacion_min', p_anticipacion_min, 'colchon_min', p_colchon_min);
end $$;

-- ---------------------------------------------------------------------
-- 2. Horario semanal por barbero
-- ---------------------------------------------------------------------
create table if not exists public.horarios_barbero (
  id             uuid primary key default gen_random_uuid(),
  barberia_id    uuid not null references public.barberias(id),
  barbero_id     uuid not null,
  -- 0 = domingo … 6 = sábado (igual que extract(dow …) y que getDay() en JavaScript)
  dia_semana     smallint not null check (dia_semana between 0 and 6),
  -- Minutos desde la medianoche, hora de Bogotá: 9:00 = 540, 13:30 = 810, medianoche final = 1440.
  desde_min      smallint not null check (desde_min between 0 and 1439),
  hasta_min      smallint not null check (hasta_min between 1 and 1440),
  created_at     timestamptz not null default now(),
  registrado_por uuid default auth.uid() references auth.users(id) on delete set null,
  check (hasta_min > desde_min),
  unique (barberia_id, id),
  foreign key (barberia_id, barbero_id) references public.barberos (barberia_id, id),
  -- Dos franjas del mismo barbero y día no se traslapan ([desde, hasta): pegadas sí).
  constraint horarios_sin_traslape exclude using gist (
    barbero_id extensions.gist_uuid_ops with =,
    dia_semana extensions.gist_int2_ops with =,
    int4range(desde_min, hasta_min) with &&
  )
);
create index if not exists idx_horarios_barbero on public.horarios_barbero (barberia_id, barbero_id, dia_semana);
comment on table public.horarios_barbero is 'Franjas de trabajo de cada barbero por día de la semana (minutos desde medianoche, Bogotá).';

alter table public.horarios_barbero enable row level security;

drop policy if exists horarios_barbero_select on public.horarios_barbero;
create policy horarios_barbero_select on public.horarios_barbero
  for select to authenticated using (barberia_id = (select public.mi_barberia()));

grant select on public.horarios_barbero to authenticated;

-- Deja el horario del barbero EXACTAMENTE con estas franjas (reemplaza todo).
--   p_franjas = [{"dia": 1, "desde": 540, "hasta": 780}, {"dia": 1, "desde": 870, "hasta": 1140}, …]
create or replace function public.guardar_horario_barbero(p_barbero uuid, p_franjas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('servicios');
  v_dias     constant text[] := array['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  v_item     jsonb;
  v_dia      integer;
  v_desde    integer;
  v_hasta    integer;
  v_norm     jsonb := '[]'::jsonb;
  v_i        integer := 0;
  v_cruce    integer;
  v_exceso   integer;
begin
  if not exists (select 1 from public.barberos where barberia_id = v_barberia and id = p_barbero) then
    raise exception 'No existe ese barbero.' using errcode = 'P0002';
  end if;
  if p_franjas is null or jsonb_typeof(p_franjas) <> 'array' then
    raise exception 'El horario no es válido.';
  end if;
  if jsonb_array_length(p_franjas) > 28 then
    raise exception 'Son demasiadas franjas.';
  end if;

  for v_item in select e from jsonb_array_elements(p_franjas) e loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'El horario no es válido.';
    end if;
    v_dia   := public.fn_json_entero(v_item, 'dia', true);
    v_desde := public.fn_json_entero(v_item, 'desde', true);
    v_hasta := public.fn_json_entero(v_item, 'hasta', true);
    if v_dia < 0 or v_dia > 6 then
      raise exception 'El día de la semana no es válido.';
    end if;
    if v_desde < 0 or v_desde > 1439 or v_hasta < 1 or v_hasta > 1440 then
      raise exception 'Las horas deben estar entre las 12:00 a. m. y las 12:00 a. m. del día siguiente.';
    end if;
    if v_hasta <= v_desde then
      raise exception 'La franja del % termina antes de empezar.', v_dias[v_dia + 1];
    end if;
    v_i := v_i + 1;
    v_norm := v_norm || jsonb_build_array(jsonb_build_object('i', v_i, 'dia', v_dia, 'desde', v_desde, 'hasta', v_hasta));
  end loop;

  -- Demasiadas franjas en un mismo día (más de 4 no es un horario, es un error)
  select max(c) into v_exceso
    from (select count(*) as c from jsonb_to_recordset(v_norm) as f(i int, dia int, desde int, hasta int) group by dia) t;
  if coalesce(v_exceso, 0) > 4 then
    raise exception 'Un día no puede tener más de 4 franjas.';
  end if;

  -- Traslapes (pegadas, no): mensaje claro antes de que lo rechace la restricción de la tabla.
  select a.dia into v_cruce
    from jsonb_to_recordset(v_norm) as a(i int, dia int, desde int, hasta int)
    join jsonb_to_recordset(v_norm) as b(i int, dia int, desde int, hasta int)
      on a.dia = b.dia and a.i < b.i and a.desde < b.hasta and b.desde < a.hasta
   limit 1;
  if v_cruce is not null then
    raise exception 'Las franjas del % se cruzan.', v_dias[v_cruce + 1];
  end if;

  delete from public.horarios_barbero where barberia_id = v_barberia and barbero_id = p_barbero;
  insert into public.horarios_barbero (barberia_id, barbero_id, dia_semana, desde_min, hasta_min)
  select v_barberia, p_barbero, f.dia, f.desde, f.hasta
    from jsonb_to_recordset(v_norm) as f(i int, dia int, desde int, hasta int);

  return jsonb_build_object('id', p_barbero, 'franjas', v_i);
end $$;

-- ---------------------------------------------------------------------
-- 3. Bloqueos puntuales
-- ---------------------------------------------------------------------
create table if not exists public.bloqueos (
  id             uuid primary key default gen_random_uuid(),
  barberia_id    uuid not null references public.barberias(id),
  barbero_id     uuid not null,
  inicio         timestamptz not null,
  fin            timestamptz not null,
  motivo         text check (motivo is null or length(btrim(motivo)) between 1 and 100),
  activo         boolean not null default true,       -- quitar un bloqueo = activo false (no se borra)
  created_at     timestamptz not null default now(),
  registrado_por uuid default auth.uid() references auth.users(id) on delete set null,
  check (fin > inicio),
  unique (barberia_id, id),
  foreign key (barberia_id, barbero_id) references public.barberos (barberia_id, id)
);
create index if not exists idx_bloqueos_barbero on public.bloqueos (barberia_id, barbero_id, inicio) where activo;
comment on table public.bloqueos is 'Ratos en que un barbero NO atiende (día libre, cita médica…). Se quitan, no se borran.';

alter table public.bloqueos enable row level security;

drop policy if exists bloqueos_select on public.bloqueos;
create policy bloqueos_select on public.bloqueos
  for select to authenticated using (barberia_id = (select public.mi_barberia()));

grant select on public.bloqueos to authenticated;

drop trigger if exists trg_bloquear_borrado on public.bloqueos;
create trigger trg_bloquear_borrado before delete on public.bloqueos
  for each row execute function public.fn_bloquear_borrado();

-- Quien tiene "agenda" bloquea a cualquiera; quien solo tiene "mi_agenda" (el barbero), solo su propio tiempo.
create or replace function public.fn_requerir_agenda_de(p_barbero uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_area('agenda', 'mi_agenda');
begin
  if not public.tiene_area('agenda') and p_barbero is distinct from public.mi_barbero() then
    raise exception 'Solo puedes cambiar tu propio horario.' using errcode = '42501';
  end if;
  return v_barberia;
end $$;

create or replace function public.crear_bloqueo(p_barbero uuid, p_inicio timestamptz, p_fin timestamptz,
                                                p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.fn_requerir_agenda_de(p_barbero);
  v_motivo   text := nullif(public.fn_limpiar_texto(p_motivo), '');
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

  insert into public.bloqueos (barberia_id, barbero_id, inicio, fin, motivo)
  values (v_barberia, p_barbero, p_inicio, p_fin, v_motivo)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.quitar_bloqueo(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia uuid := public.requerir_barberia();
  v_barbero  uuid;
begin
  select barbero_id into v_barbero from public.bloqueos where barberia_id = v_barberia and id = p_id;
  if v_barbero is null then
    raise exception 'No existe ese bloqueo.' using errcode = 'P0002';
  end if;
  -- El permiso real: "agenda" para cualquiera, o "mi_agenda" y que el bloqueo sea del propio barbero.
  perform public.fn_requerir_agenda_de(v_barbero);
  update public.bloqueos set activo = false where barberia_id = v_barberia and id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

-- Bloqueos que todavía no terminan (RLS: solo los de la propia barbería), en orden de fecha.
create or replace function public.listar_bloqueos(p_barbero uuid default null, p_desde timestamptz default now())
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('id', b.id, 'barbero_id', b.barbero_id, 'inicio', b.inicio, 'fin', b.fin,
                                 'motivo', b.motivo)
              order by b.inicio, b.id),
    '[]'::jsonb)
    from public.bloqueos b
   where b.activo and b.fin > p_desde and (p_barbero is null or b.barbero_id = p_barbero)
$$;

-- ---------------------------------------------------------------------
-- 4. Lo que ya existía, ahora con horario y ajustes (copia de la ÚLTIMA versión: 0006 y 0003)
-- ---------------------------------------------------------------------
create or replace function public.listar_barberos(p_con_archivados boolean default false)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', b.id,
        'nombre', b.nombre,
        'user_id', b.user_id,
        'acepta_reservas', b.acepta_reservas,
        'activo', b.activo,
        'orden', b.orden,
        'servicios', coalesce((
          select jsonb_agg(
                   jsonb_build_object('servicio_id', bs.servicio_id, 'precio_propio', bs.precio_propio,
                                      'duracion_propia', bs.duracion_propia)
                   order by s.orden, lower(s.nombre))
            from public.barbero_servicios bs
            join public.servicios s on s.barberia_id = bs.barberia_id and s.id = bs.servicio_id
           where bs.barberia_id = b.barberia_id and bs.barbero_id = b.id), '[]'::jsonb),
        'horario', coalesce((
          select jsonb_agg(
                   jsonb_build_object('dia', h.dia_semana, 'desde', h.desde_min, 'hasta', h.hasta_min)
                   order by h.dia_semana, h.desde_min)
            from public.horarios_barbero h
           where h.barberia_id = b.barberia_id and h.barbero_id = b.id), '[]'::jsonb))
      order by b.activo desc, b.orden, lower(b.nombre)),
    '[]'::jsonb)
    from public.barberos b
   where coalesce(p_con_archivados, false) or b.activo
$$;

create or replace function public.obtener_contexto()
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'barberia', (select jsonb_build_object('id', b.id, 'nombre', b.nombre, 'slug', b.slug, 'es_demo', b.es_demo,
                                           'whatsapp', b.whatsapp, 'direccion', b.direccion,
                                           'agenda', jsonb_build_object(
                                             'paso_min', b.paso_min, 'dias_adelante', b.dias_adelante,
                                             'anticipacion_min', b.anticipacion_min, 'colchon_min', b.colchon_min))
                   from public.barberias b limit 1),
    'perfil', (select jsonb_build_object(
                        'nombre', p.nombre, 'rol', p.rol,
                        'areas', to_jsonb(public.mis_areas()),
                        'roles', coalesce((select jsonb_agg(r.nombre order by r.orden, r.nombre)
                                             from public.perfil_roles pr
                                             join public.roles_equipo r on r.id = pr.rol_id and r.activo
                                            where pr.user_id = p.user_id), '[]'::jsonb))
                 from public.perfiles p where p.user_id = auth.uid())
  )
$$;

select public.fn_aplicar_permisos();
