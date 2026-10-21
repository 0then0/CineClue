CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE movie (
 id text PRIMARY KEY, title text NOT NULL, original_title text NOT NULL, titles jsonb NOT NULL,
 release_year integer NOT NULL CHECK(release_year BETWEEN 1880 AND 2100), runtime integer NOT NULL CHECK(runtime > 0),
 external_ids jsonb NOT NULL, popularity_score real NOT NULL CHECK(popularity_score BETWEEN 0 AND 100), provenance jsonb NOT NULL
);
CREATE TABLE alias (movie_id text REFERENCES movie ON DELETE CASCADE, name text NOT NULL, PRIMARY KEY(movie_id,name));
CREATE TABLE person (id text PRIMARY KEY, name text NOT NULL, names jsonb NOT NULL);
CREATE TABLE genre (id text PRIMARY KEY, name text NOT NULL, names jsonb NOT NULL);
CREATE TABLE country (id text PRIMARY KEY, name text NOT NULL, names jsonb NOT NULL);
CREATE TABLE studio (id text PRIMARY KEY, name text NOT NULL, names jsonb NOT NULL);
CREATE TABLE movie_person (movie_id text REFERENCES movie ON DELETE CASCADE, person_id text REFERENCES person, role text NOT NULL CHECK(role IN ('director','actor')), position integer NOT NULL, PRIMARY KEY(movie_id,person_id,role));
CREATE INDEX movie_person_person_idx ON movie_person(person_id);
CREATE TABLE movie_genre (movie_id text REFERENCES movie ON DELETE CASCADE, entity_id text REFERENCES genre, PRIMARY KEY(movie_id,entity_id));
CREATE TABLE movie_country (movie_id text REFERENCES movie ON DELETE CASCADE, entity_id text REFERENCES country, PRIMARY KEY(movie_id,entity_id));
CREATE TABLE movie_studio (movie_id text REFERENCES movie ON DELETE CASCADE, entity_id text REFERENCES studio, PRIMARY KEY(movie_id,entity_id));
CREATE TABLE content_pack (id text PRIMARY KEY, name jsonb NOT NULL, description jsonb NOT NULL, rules jsonb NOT NULL);
CREATE TABLE movie_pack (movie_id text REFERENCES movie ON DELETE CASCADE, pack_id text REFERENCES content_pack ON DELETE CASCADE, PRIMARY KEY(movie_id,pack_id));
CREATE TABLE daily_puzzle (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), puzzle_date date NOT NULL UNIQUE, target_id text NOT NULL REFERENCES movie);
CREATE TABLE challenge (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), target_id text NOT NULL REFERENCES movie, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE game_session (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), visitor_id uuid NOT NULL, mode text NOT NULL CHECK(mode IN ('daily','unlimited','challenge')),
 puzzle_id uuid REFERENCES daily_puzzle, challenge_id uuid REFERENCES challenge, target_id text NOT NULL REFERENCES movie,
 difficulty text NOT NULL DEFAULT 'normal' CHECK(difficulty IN ('easy','normal','hard')),
 status text NOT NULL DEFAULT 'playing' CHECK(status IN ('playing','won','lost')), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(visitor_id,puzzle_id), UNIQUE(visitor_id,challenge_id)
);
CREATE INDEX game_session_visitor_idx ON game_session(visitor_id,created_at DESC);
CREATE TABLE guess (
 game_id uuid REFERENCES game_session ON DELETE CASCADE, ordinal smallint NOT NULL CHECK(ordinal BETWEEN 1 AND 8), movie_id text NOT NULL REFERENCES movie,
 comparison jsonb NOT NULL, PRIMARY KEY(game_id,ordinal), UNIQUE(game_id,movie_id)
);
CREATE TABLE rate_limit (key text PRIMARY KEY, hits integer NOT NULL DEFAULT 1, expires_at timestamptz NOT NULL);
