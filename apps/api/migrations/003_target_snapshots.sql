-- Preserve the target attributes of existing games when catalog facts are corrected.
ALTER TABLE daily_puzzle ADD COLUMN target_snapshot jsonb;
ALTER TABLE game_session ADD COLUMN target_snapshot jsonb;
