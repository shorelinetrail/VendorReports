-- Switch the report-upload deadline setting from weeks to days so every
-- timeline setting is expressed consistently in days.

-- Seed the new key from the old one (weeks * 7), defaulting to 14 days.
INSERT INTO system_config (config_key, config_value, description)
VALUES (
    'report_upload_days',
    COALESCE((SELECT (config_value::int * 7)::text FROM system_config WHERE config_key = 'report_upload_weeks'), '14'),
    'Days after visit date for report upload deadline'
)
ON CONFLICT (config_key) DO NOTHING;

DELETE FROM system_config WHERE config_key = 'report_upload_weeks';

-- Update the validation trigger to check the new key.
CREATE OR REPLACE FUNCTION validate_system_config()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.config_key IN (
        'visit_confirmation_days',
        'report_upload_days',
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
