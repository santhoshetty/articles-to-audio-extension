-- Create a function to atomically increment the completed_chunks counter
CREATE OR REPLACE FUNCTION increment_completed_chunks(job_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE podcast_jobs
  SET 
    completed_chunks = completed_chunks + 1,
    status = CASE 
      WHEN completed_chunks + 1 = total_chunks THEN 'completed'
      ELSE status
    END,
    updated_at = NOW()
  WHERE id = job_id;
END;
$$; 