DROP INDEX IF EXISTS "SiteUpdate_supersedesId_key";
CREATE UNIQUE INDEX "SiteUpdate_one_pending_correction"
  ON "SiteUpdate" ("supersedesId")
  WHERE "supersedesId" IS NOT NULL AND "status" = 'SUBMITTED';
