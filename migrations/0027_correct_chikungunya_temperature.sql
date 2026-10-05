-- The source table's comparison symbol was lost in the copied line wrapping.
-- Restore the explicit SKDR threshold so the criterion is not ambiguous.
UPDATE w2_indicators
SET definition = 'Demam mendadak >38,5°C dan nyeri persendian hebat (severe arthralgia), dan/atau dapat disertai adanya ruam (rash).',
    updated_at = datetime('now')
WHERE indicator_code = 'H';
