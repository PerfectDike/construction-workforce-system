CREATE FUNCTION reject_provenance_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Provenance events are append-only';
END;
$$;

CREATE TRIGGER protect_provenance_event
  BEFORE UPDATE OR DELETE ON "ProvenanceEvent"
  FOR EACH ROW EXECUTE FUNCTION reject_provenance_mutation();
