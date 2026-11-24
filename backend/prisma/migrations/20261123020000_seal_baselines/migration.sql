ALTER TABLE "Baseline" ADD COLUMN "sealedAt" TIMESTAMP(3);

DROP TRIGGER "protect_baseline" ON "Baseline";
UPDATE "Baseline" SET "sealedAt" = "approvedAt";

CREATE OR REPLACE FUNCTION reject_baseline_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'Baseline' THEN
    IF TG_OP = 'UPDATE' AND OLD."sealedAt" IS NULL AND NEW."sealedAt" IS NOT NULL
       AND (to_jsonb(NEW) - 'sealedAt') = (to_jsonb(OLD) - 'sealedAt') THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'Approved baselines are read-only';
END;
$$;

CREATE TRIGGER "protect_baseline" BEFORE UPDATE OR DELETE ON "Baseline"
  FOR EACH ROW EXECUTE FUNCTION reject_baseline_mutation();

CREATE FUNCTION reject_sealed_baseline_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Baseline" WHERE id = NEW."baselineId" AND "sealedAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'Approved baseline snapshots are read-only';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "protect_baseline_task_insert" BEFORE INSERT ON "BaselineTask"
  FOR EACH ROW EXECUTE FUNCTION reject_sealed_baseline_insert();
CREATE TRIGGER "protect_baseline_dependency_insert" BEFORE INSERT ON "BaselineDependency"
  FOR EACH ROW EXECUTE FUNCTION reject_sealed_baseline_insert();
