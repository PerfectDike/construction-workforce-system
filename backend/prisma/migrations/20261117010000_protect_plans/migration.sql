ALTER TABLE "Task" ADD CONSTRAINT "task_date_order" CHECK ("finishDate" >= "startDate" AND (NOT "isMilestone" OR "startDate" = "finishDate"));
ALTER TABLE "BaselineTask" ADD CONSTRAINT "baseline_task_date_order" CHECK ("finishDate" >= "startDate" AND (NOT "isMilestone" OR "startDate" = "finishDate"));
CREATE FUNCTION reject_baseline_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Approved baselines are read-only';
END;
$$;
CREATE TRIGGER protect_baseline BEFORE UPDATE OR DELETE ON "Baseline" FOR EACH ROW EXECUTE FUNCTION reject_baseline_mutation();
CREATE TRIGGER protect_baseline_task BEFORE UPDATE OR DELETE ON "BaselineTask" FOR EACH ROW EXECUTE FUNCTION reject_baseline_mutation();
CREATE TRIGGER protect_baseline_dependency BEFORE UPDATE OR DELETE ON "BaselineDependency" FOR EACH ROW EXECUTE FUNCTION reject_baseline_mutation();
