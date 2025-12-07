-- Add review decision fields to recommendations table
-- This enables the technical engineer to make structured decisions on recommendations

-- Create enum type for review decisions
DO $$ BEGIN
  CREATE TYPE review_decision_type AS ENUM ('no_action', 'request_sap', 'other_action');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add new columns to recommendations table
ALTER TABLE recommendations
ADD COLUMN IF NOT EXISTS review_decision review_decision_type,
ADD COLUMN IF NOT EXISTS review_action_description TEXT,
ADD COLUMN IF NOT EXISTS action_assigned_to_id UUID REFERENCES users(id);

-- Create index for faster lookups by assigned user
CREATE INDEX IF NOT EXISTS idx_recommendations_action_assigned_to ON recommendations(action_assigned_to_id);

-- Add comment for documentation
COMMENT ON COLUMN recommendations.review_decision IS 'Technical engineer decision: no_action, request_sap, or other_action';
COMMENT ON COLUMN recommendations.review_action_description IS 'Description of the action required (for other_action type)';
COMMENT ON COLUMN recommendations.action_assigned_to_id IS 'User assigned to take action on this recommendation';
