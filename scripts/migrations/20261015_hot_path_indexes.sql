-- Indexes for hot lookup columns. Mirrors the index() definitions in lib/db/src/schema.

CREATE INDEX IF NOT EXISTS idx_players_league_id ON players (league_id);
CREATE INDEX IF NOT EXISTS idx_players_clerk_user_id ON players (clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_matches_league_id_week_of ON matches (league_id, week_of);
CREATE INDEX IF NOT EXISTS idx_matches_player1_id ON matches (player1_id);
CREATE INDEX IF NOT EXISTS idx_matches_player2_id ON matches (player2_id);
CREATE INDEX IF NOT EXISTS idx_matches_player3_id ON matches (player3_id);
CREATE INDEX IF NOT EXISTS idx_matches_player4_id ON matches (player4_id);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches (status);
CREATE INDEX IF NOT EXISTS idx_matches_round_id ON matches (round_id);
CREATE INDEX IF NOT EXISTS idx_matches_playoff_bracket_id ON matches (playoff_bracket_id);
CREATE INDEX IF NOT EXISTS idx_league_rounds_league_id_status ON league_rounds (league_id, status);
CREATE INDEX IF NOT EXISTS idx_player_availability_league_id_week_of ON player_availability (league_id, week_of);
CREATE INDEX IF NOT EXISTS idx_player_availability_player_id ON player_availability (player_id);
CREATE INDEX IF NOT EXISTS idx_schedule_generation_logs_league_id_week_of ON schedule_generation_logs (league_id, week_of);
CREATE INDEX IF NOT EXISTS idx_seasons_league_id ON seasons (league_id);
CREATE INDEX IF NOT EXISTS idx_playoff_brackets_league_id ON playoff_brackets (league_id);
CREATE INDEX IF NOT EXISTS idx_league_invites_league_id ON league_invites (league_id);
CREATE INDEX IF NOT EXISTS idx_comments_match_id ON comments (match_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_expo_push_tokens_user_id ON expo_push_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_ball_boi_sessions_match_id ON ball_boi_sessions (match_id);
CREATE INDEX IF NOT EXISTS idx_match_shots_session_id ON match_shots (session_id);
CREATE INDEX IF NOT EXISTS idx_match_shots_match_id ON match_shots (match_id);
CREATE INDEX IF NOT EXISTS idx_match_statistics_session_id ON match_statistics (session_id);
CREATE INDEX IF NOT EXISTS idx_match_statistics_match_id ON match_statistics (match_id);
