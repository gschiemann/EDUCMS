-- AlterTable
ALTER TABLE "games" ADD COLUMN     "away_team_id" TEXT,
ADD COLUMN     "home_team_id" TEXT;

-- AlterTable
ALTER TABLE "roster_players" ADD COLUMN     "person_id" TEXT,
ADD COLUMN     "team_id" TEXT;

-- CreateTable
CREATE TABLE "sports_teams" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sport" TEXT NOT NULL,
    "season" TEXT,
    "gender" TEXT,
    "level" TEXT,
    "color_primary" TEXT,
    "logo_url" TEXT,
    "is_home" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sports_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sports_persons" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "team_id" TEXT,
    "full_name" TEXT NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "number" TEXT,
    "position" TEXT,
    "photo_url" TEXT,
    "grad_year" INTEGER,
    "normalized_key" TEXT NOT NULL,
    "external_ref" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sports_persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_season_stats" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "team_id" TEXT,
    "sport" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "stat_key" TEXT NOT NULL,
    "stat_value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "games_played" INTEGER NOT NULL DEFAULT 0,
    "display_value" TEXT,
    "last_game_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_season_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_career_stats" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "team_id" TEXT,
    "sport" TEXT NOT NULL,
    "stat_key" TEXT NOT NULL,
    "stat_value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "games_played" INTEGER NOT NULL DEFAULT 0,
    "display_value" TEXT,
    "last_game_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_career_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stat_records" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "team_id" TEXT,
    "sport" TEXT NOT NULL,
    "stat_key" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'SCHOOL',
    "season" TEXT,
    "record_type" TEXT NOT NULL DEFAULT 'SINGLE_GAME',
    "value" DOUBLE PRECISION NOT NULL,
    "display_value" TEXT,
    "holder_person_id" TEXT,
    "holder_name" TEXT NOT NULL,
    "game_id" TEXT,
    "set_on" TIMESTAMP(3),
    "higher_is_better" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stat_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stat_milestone_defs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "sport" TEXT NOT NULL,
    "stat_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION,
    "label" TEXT NOT NULL,
    "cue_key" TEXT NOT NULL,
    "emoji" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stat_milestone_defs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_milestones" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "game_id" TEXT,
    "sport" TEXT NOT NULL,
    "stat_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "cue_key" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "celebrated_at" TIMESTAMP(3),
    "fired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sports_teams_tenant_id_sport_season_idx" ON "sports_teams"("tenant_id", "sport", "season");

-- CreateIndex
CREATE INDEX "sports_persons_tenant_id_team_id_idx" ON "sports_persons"("tenant_id", "team_id");

-- CreateIndex
CREATE UNIQUE INDEX "sports_persons_tenant_id_team_id_normalized_key_grad_year_key" ON "sports_persons"("tenant_id", "team_id", "normalized_key", "grad_year");

-- CreateIndex
CREATE INDEX "player_season_stats_tenant_id_sport_season_stat_key_stat_va_idx" ON "player_season_stats"("tenant_id", "sport", "season", "stat_key", "stat_value" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "player_season_stats_person_id_season_stat_key_key" ON "player_season_stats"("person_id", "season", "stat_key");

-- CreateIndex
CREATE INDEX "player_career_stats_tenant_id_sport_stat_key_stat_value_idx" ON "player_career_stats"("tenant_id", "sport", "stat_key", "stat_value" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "player_career_stats_person_id_stat_key_key" ON "player_career_stats"("person_id", "stat_key");

-- CreateIndex
CREATE UNIQUE INDEX "stat_records_tenant_id_team_id_sport_stat_key_scope_season__key" ON "stat_records"("tenant_id", "team_id", "sport", "stat_key", "scope", "season", "record_type");

-- CreateIndex
CREATE INDEX "stat_milestone_defs_tenant_id_sport_idx" ON "stat_milestone_defs"("tenant_id", "sport");

-- CreateIndex
CREATE INDEX "player_milestones_tenant_id_game_id_idx" ON "player_milestones"("tenant_id", "game_id");

-- CreateIndex
CREATE UNIQUE INDEX "player_milestones_person_id_dedupe_key_key" ON "player_milestones"("person_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "games_home_team_id_idx" ON "games"("home_team_id");

-- CreateIndex
CREATE INDEX "games_away_team_id_idx" ON "games"("away_team_id");

-- CreateIndex
CREATE INDEX "roster_players_person_id_idx" ON "roster_players"("person_id");

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_home_team_id_fkey" FOREIGN KEY ("home_team_id") REFERENCES "sports_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_away_team_id_fkey" FOREIGN KEY ("away_team_id") REFERENCES "sports_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_players" ADD CONSTRAINT "roster_players_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "sports_persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_players" ADD CONSTRAINT "roster_players_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "sports_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sports_teams" ADD CONSTRAINT "sports_teams_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sports_persons" ADD CONSTRAINT "sports_persons_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sports_persons" ADD CONSTRAINT "sports_persons_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "sports_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_season_stats" ADD CONSTRAINT "player_season_stats_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "sports_persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_season_stats" ADD CONSTRAINT "player_season_stats_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_career_stats" ADD CONSTRAINT "player_career_stats_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "sports_persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_career_stats" ADD CONSTRAINT "player_career_stats_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stat_records" ADD CONSTRAINT "stat_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stat_milestone_defs" ADD CONSTRAINT "stat_milestone_defs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_milestones" ADD CONSTRAINT "player_milestones_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "sports_persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_milestones" ADD CONSTRAINT "player_milestones_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

