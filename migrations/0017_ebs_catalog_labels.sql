-- Correct catalogue labels without rewriting migration 0004, which may already
-- have been applied to deployed databases.
UPDATE ebs_disease_master SET disease_name='Diare Berdarah/Disentri' WHERE ebs_id='202';
UPDATE ebs_disease_master SET disease_name='ISPA/Pneumonia (dengan hasil lab)' WHERE ebs_id='249';
UPDATE ebs_disease_master SET disease_name='Pneumonia' WHERE ebs_id='30';
UPDATE ebs_disease_master SET disease_name='Suspek Meningitis' WHERE ebs_id='228';
