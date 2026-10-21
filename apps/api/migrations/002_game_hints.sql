CREATE TABLE game_hint (
  game_id uuid NOT NULL REFERENCES game_session ON DELETE CASCADE,
  ordinal smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 2),
  kind text NOT NULL CHECK (kind IN ('genres', 'actor', 'decade', 'filmography')),
  content jsonb NOT NULL,
  PRIMARY KEY (game_id, kind),
  UNIQUE (game_id, ordinal)
);
