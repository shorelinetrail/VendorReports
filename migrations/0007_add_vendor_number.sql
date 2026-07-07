-- External vendor reference (e.g. the SAP vendor number). Optional, but unique when set.
ALTER TABLE vendors ADD COLUMN vendor_number TEXT;
CREATE UNIQUE INDEX idx_vendors_number ON vendors(vendor_number);
