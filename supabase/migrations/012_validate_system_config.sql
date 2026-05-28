-- Guard the numeric deadline settings against nonsensical values at the DB
-- level (the Settings form also validates, but this is the backstop).
CREATE OR REPLACE FUNCTION validate_system_config()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.config_key IN (
        'visit_confirmation_days',
        'report_upload_weeks',
        'recommendations_review_days',
        'technical_review_days'
    ) THEN
        IF NEW.config_value !~ '^[0-9]+$'
           OR NEW.config_value::int < 1
           OR NEW.config_value::int > 365 THEN
            RAISE EXCEPTION 'Config "%" must be a whole number between 1 and 365 (got "%")',
                NEW.config_key, NEW.config_value;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_system_config_trigger ON system_config;
CREATE TRIGGER validate_system_config_trigger BEFORE INSERT OR UPDATE ON system_config
    FOR EACH ROW EXECUTE FUNCTION validate_system_config();
