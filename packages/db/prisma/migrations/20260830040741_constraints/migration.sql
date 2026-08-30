-- Rafter integrity constraints (D3, D6, D7, append-only events).
-- These live in Postgres, not app code, on purpose.

-- 1. Issued quotes are immutable (D3).
CREATE OR REPLACE FUNCTION rafter_quote_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'issued quotes are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER quote_immutable
  BEFORE UPDATE OR DELETE ON "Quote"
  FOR EACH ROW EXECUTE FUNCTION rafter_quote_immutable();

CREATE TRIGGER quote_line_item_immutable
  BEFORE UPDATE OR DELETE ON "QuoteLineItem"
  FOR EACH ROW EXECUTE FUNCTION rafter_quote_immutable();

-- 2. Events are append-only.
CREATE OR REPLACE FUNCTION rafter_event_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'events are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER event_append_only
  BEFORE UPDATE OR DELETE ON "Event"
  FOR EACH ROW EXECUTE FUNCTION rafter_event_append_only();

-- 3. D6/D7 gate: a job may only reach CLOSED with a complete closeout
--    and zero unattributed variance.
CREATE OR REPLACE FUNCTION rafter_job_close_gate() RETURNS trigger AS $$
DECLARE
  co RECORD;
BEGIN
  SELECT "unattributedCents" INTO co FROM "Closeout" WHERE "jobId" = NEW.id;
  IF NOT FOUND OR co."unattributedCents" <> 0 THEN
    RAISE EXCEPTION 'job cannot close: closeout missing or unattributed variance remains';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER job_close_gate
  BEFORE UPDATE OF "state" ON "Job"
  FOR EACH ROW
  WHEN (NEW."state" = 'CLOSED')
  EXECUTE FUNCTION rafter_job_close_gate();

-- 4. CONCEALED_CONDITION attributions require photo evidence (D7).
ALTER TABLE "VarianceRecord"
  ADD CONSTRAINT variance_concealed_requires_photo
  CHECK ("reason" <> 'CONCEALED_CONDITION' OR "photoId" IS NOT NULL);
