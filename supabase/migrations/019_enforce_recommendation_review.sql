-- Enforce the technical-review gate at the database level: a recommendation on
-- a routine that requires technical review cannot jump straight from draft
-- ('open') to 'completed'. It must first be sent for review (-> 'in_review')
-- and reviewed (-> 'approved'/'completed' by the technical engineer). Direct
-- open -> completed is only allowed when the routine does not require review.

CREATE OR REPLACE FUNCTION enforce_recommendation_review()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_requires_review BOOLEAN;
BEGIN
    IF NEW.status = 'completed' AND OLD.status = 'open' THEN
        SELECT r.requires_technical_review
          INTO v_requires_review
          FROM maintenance_visits mv
          JOIN maintenance_routines r ON r.id = mv.routine_id
         WHERE mv.id = NEW.visit_id;

        IF COALESCE(v_requires_review, TRUE) THEN
            RAISE EXCEPTION 'Recommendation must be sent for technical review before it can be completed';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_recommendation_review_trigger ON recommendations;
CREATE TRIGGER enforce_recommendation_review_trigger BEFORE UPDATE ON recommendations
    FOR EACH ROW EXECUTE FUNCTION enforce_recommendation_review();
