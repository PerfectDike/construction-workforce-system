ALTER TABLE "SiteUpdate" ADD COLUMN "entryKey" TEXT;
WITH RECURSIVE chains AS (
 SELECT id, id::text AS root FROM "SiteUpdate" WHERE "supersedesId" IS NULL
 UNION ALL SELECT s.id, c.root FROM "SiteUpdate" s JOIN chains c ON s."supersedesId" = c.id
) UPDATE "SiteUpdate" s SET "entryKey" = c.root FROM chains c WHERE s.id = c.id;
CREATE UNIQUE INDEX "SiteUpdate_one_current_entry" ON "SiteUpdate" ("entryKey") WHERE "isCurrent" = true AND "status" = 'APPROVED';
ALTER TABLE "SiteUpdate" ADD CONSTRAINT "site_update_no_self_approval" CHECK ("approvedById" IS NULL OR "approvedById" <> "authorId");
ALTER TABLE "SiteUpdate" ADD CONSTRAINT "site_update_hours_valid" CHECK ("recordedHours" IS NULL OR ("recordedHours" >= 0 AND "allocationId" IS NOT NULL));

