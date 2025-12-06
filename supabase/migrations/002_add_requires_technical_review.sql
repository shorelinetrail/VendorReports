-- Add requires_technical_review column to maintenance_routines
ALTER TABLE maintenance_routines
ADD COLUMN IF NOT EXISTS requires_technical_review BOOLEAN DEFAULT TRUE;

-- Update existing records to default to true (all existing routines require review)
UPDATE maintenance_routines SET requires_technical_review = TRUE WHERE requires_technical_review IS NULL;
