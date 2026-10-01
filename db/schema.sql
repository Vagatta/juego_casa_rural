-- LA CASA RURAL · Modelo relacional (PostgreSQL 15+)
-- El MVP persiste snapshots en game_snapshots. El resto de tablas es el modelo
-- de producción (histórico, panel de administración, analítica).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Snapshot usado por el MVP (src/server/store.ts)
CREATE TABLE IF NOT EXISTS game_snapshots (
  code        text PRIMARY KEY,
  state       jsonb NOT NULL,
  finished    boolean NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS game_snapshots_active_idx ON game_snapshots (updated_at) WHERE NOT finished;

-- ===================== Contenido (editable desde un futuro panel) =====================

CREATE TABLE IF NOT EXISTS roles (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  faction       text NOT NULL CHECK (faction IN ('huesped','cuco','turista')),
  emoji         text NOT NULL,
  summary       text NOT NULL,
  objective     text NOT NULL,
  ability_id    text,
  ability_name  text,
  ability_text  text,
  uses_per_round smallint,
  uses_per_game  smallint,
  enabled       boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS missions (
  id           text PRIMARY KEY,
  text         text NOT NULL,
  category     text NOT NULL,
  difficulty   text NOT NULL CHECK (difficulty IN ('facil','media','dificil','epica')),
  faction      text NOT NULL DEFAULT 'any' CHECK (faction IN ('any','huesped','cuco','turista')),
  targets      smallint NOT NULL DEFAULT 0 CHECK (targets BETWEEN 0 AND 2),
  tags         text[] NOT NULL DEFAULT '{}',
  reward       integer,
  enabled      boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS missions_pick_idx ON missions (faction, difficulty) WHERE enabled;

CREATE TABLE IF NOT EXISTS challenges (
  id            text PRIMARY KEY,
  kind          text NOT NULL CHECK (kind IN ('physical','quiz','code_hunt','word_impostor','truth_lie','social_vote')),
  category      text NOT NULL CHECK (category IN ('mental','social','fisica','movil','mentira')),
  title         text NOT NULL,
  instructions  text NOT NULL,
  participants  text NOT NULL CHECK (participants IN ('all','team','duel','one')),
  scoring       text NOT NULL DEFAULT 'passfail' CHECK (scoring IN ('passfail','winner')),
  duration_sec  integer NOT NULL,
  reward        integer NOT NULL,
  params        jsonb NOT NULL DEFAULT '{}',
  enabled       boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS events (
  id        text PRIMARY KEY,
  emoji     text NOT NULL,
  title     text NOT NULL,
  text      text NOT NULL,
  effect    jsonb NOT NULL,
  min_round smallint NOT NULL DEFAULT 2,
  modes     text[] NOT NULL DEFAULT '{clasico,caos,sofa}',
  enabled   boolean NOT NULL DEFAULT true
);

-- ===================== Partida =====================

CREATE TABLE IF NOT EXISTS games (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           char(5) NOT NULL,
  host_token_hash text NOT NULL,
  settings       jsonb NOT NULL,
  phase          text NOT NULL DEFAULT 'LOBBY',
  round_index    smallint NOT NULL DEFAULT -1,
  velas          smallint NOT NULL DEFAULT 0,
  grietas        smallint NOT NULL DEFAULT 0,
  version        integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  started_at     timestamptz,
  finished_at    timestamptz
);
-- Un código solo puede estar activo en una partida a la vez
CREATE UNIQUE INDEX IF NOT EXISTS games_active_code_uq ON games (code) WHERE finished_at IS NULL;

CREATE TABLE IF NOT EXISTS players (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id      uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  token_hash   text NOT NULL,
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 16),
  avatar       text NOT NULL,
  color        text NOT NULL,
  role_id      text REFERENCES roles(id),
  coins        integer NOT NULL DEFAULT 50,
  cerillas     smallint NOT NULL DEFAULT 0,
  is_host      boolean NOT NULL DEFAULT false,
  left_at      timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  joined_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, name)
);
CREATE INDEX IF NOT EXISTS players_game_idx ON players (game_id);

CREATE TABLE IF NOT EXISTS inventory (
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item      text NOT NULL,
  quantity  smallint NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  PRIMARY KEY (player_id, item)
);

CREATE TABLE IF NOT EXISTS rounds (
  game_id       uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  index         smallint NOT NULL,
  challenge_id  text REFERENCES challenges(id),
  event_id      text REFERENCES events(id),
  has_judgment  boolean NOT NULL DEFAULT false,
  participants  uuid[] NOT NULL DEFAULT '{}',
  result        text CHECK (result IN ('vela','grieta','none')),
  apagones      smallint NOT NULL DEFAULT 0,
  started_at    timestamptz,
  ended_at      timestamptz,
  PRIMARY KEY (game_id, index)
);

CREATE TABLE IF NOT EXISTS player_missions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id      uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id    uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  mission_id   text NOT NULL REFERENCES missions(id),
  resolved_text text NOT NULL,
  target_ids   uuid[] NOT NULL DEFAULT '{}',
  status       text NOT NULL CHECK (status IN ('active','completed','burned','discarded','expired')),
  reward       integer NOT NULL,
  assigned_round smallint NOT NULL,
  resolved_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS player_missions_player_idx ON player_missions (player_id, status);
CREATE INDEX IF NOT EXISTS player_missions_target_idx ON player_missions USING gin (target_ids);

CREATE TABLE IF NOT EXISTS clues (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id      uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  source       text NOT NULL,
  text         text NOT NULL,
  truth        text NOT NULL CHECK (truth IN ('true','ambiguous','false')),
  forged_by    uuid REFERENCES players(id),
  round_index  smallint NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clues_recipient_idx ON clues (recipient_id);

CREATE TABLE IF NOT EXISTS votes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id     uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  round_index smallint NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('juicio','final','challenge')),
  voter_id    uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  target_id   uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  weight      smallint NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS votes_round_idx ON votes (game_id, round_index, kind);

CREATE TABLE IF NOT EXISTS score_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  delta       integer NOT NULL,
  reason      text NOT NULL,
  round_index smallint,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS score_entries_player_idx ON score_entries (player_id);

-- Log append-only: fuente de verdad para estadísticas divertidas
CREATE TABLE IF NOT EXISTS game_events (
  id          bigserial PRIMARY KEY,
  game_id     uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  round_index smallint,
  type        text NOT NULL,
  actor_id    uuid REFERENCES players(id),
  target_id   uuid REFERENCES players(id),
  payload     jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS game_events_game_idx ON game_events (game_id, id);
