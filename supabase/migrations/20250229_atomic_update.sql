-- Create a function to atomically update chunk status and increment completed_chunks in one transaction
CREATE OR REPLACE FUNCTION update_chunk_and_increment(
  p_job_id UUID,
  p_chunk_index INTEGER,
  p_audio_url TEXT
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_total_chunks INTEGER;
  v_completed_chunks INTEGER;
  v_chunk_status TEXT;
BEGIN
  -- Start a transaction block
  BEGIN
    -- First check if this chunk is already completed to prevent double-counting
    SELECT status INTO v_chunk_status
    FROM podcast_chunks
    WHERE job_id = p_job_id AND chunk_index = p_chunk_index;
    
    -- Only proceed if the chunk was not already completed
    IF v_chunk_status IS NULL OR v_chunk_status != 'completed' THEN
      -- Update the chunk status first
      UPDATE podcast_chunks
      SET 
        status = 'completed',
        audio_url = p_audio_url,
        updated_at = NOW()
      WHERE 
        job_id = p_job_id AND
        chunk_index = p_chunk_index;

      -- Get the current job details
      SELECT 
        total_chunks, completed_chunks
      INTO 
        v_total_chunks, v_completed_chunks
      FROM 
        podcast_jobs
      WHERE 
        id = p_job_id;

      -- Add safety check: prevent completed_chunks from exceeding total_chunks
      IF v_completed_chunks < v_total_chunks THEN
        -- Increment counter ONLY if it won't exceed total_chunks
        UPDATE podcast_jobs
        SET 
          completed_chunks = v_completed_chunks + 1,
          status = CASE 
            WHEN v_completed_chunks + 1 = v_total_chunks THEN 'completed'
            ELSE status
          END,
          updated_at = NOW()
        WHERE 
          id = p_job_id AND
          completed_chunks = v_completed_chunks; -- Ensures we don't increment twice
       
        -- If update affected no rows, it means we already counted this chunk
        IF NOT FOUND THEN
          -- Log this situation but don't fail the transaction
          RAISE NOTICE 'Chunk possibly already counted for job %', p_job_id;
        END IF;
      ELSE
        RAISE NOTICE 'Not incrementing counter as it would exceed total_chunks for job %', p_job_id;
      END IF;
    ELSE
      RAISE NOTICE 'Chunk % for job % is already marked as completed, skipping increment', p_chunk_index, p_job_id;
    END IF;
    
    -- Commit the transaction - happens automatically at the end of the block
  END;
END;
$$;

-- Create a function to audit and reconcile podcast jobs data
CREATE OR REPLACE FUNCTION audit_and_reconcile_podcast_job(
  p_job_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_total_chunks INTEGER;
  v_completed_chunks INTEGER;
  v_actual_completed_chunks INTEGER;
  v_pending_chunks INTEGER;
  v_processing_chunks INTEGER;
  v_errored_chunks INTEGER;
  v_result JSONB;
BEGIN
  -- Get the current job information
  SELECT 
    total_chunks, completed_chunks
  INTO 
    v_total_chunks, v_completed_chunks
  FROM 
    podcast_jobs
  WHERE 
    id = p_job_id;
    
  -- Count the actual completed chunks
  SELECT 
    COUNT(*)
  INTO 
    v_actual_completed_chunks
  FROM 
    podcast_chunks
  WHERE 
    job_id = p_job_id AND
    status = 'completed';
    
  -- Count pending chunks
  SELECT 
    COUNT(*)
  INTO 
    v_pending_chunks
  FROM 
    podcast_chunks
  WHERE 
    job_id = p_job_id AND
    status = 'pending';
    
  -- Count processing chunks
  SELECT 
    COUNT(*)
  INTO 
    v_processing_chunks
  FROM 
    podcast_chunks
  WHERE 
    job_id = p_job_id AND
    status = 'processing';
    
  -- Count errored chunks
  SELECT 
    COUNT(*)
  INTO 
    v_errored_chunks
  FROM 
    podcast_chunks
  WHERE 
    job_id = p_job_id AND
    status = 'error';
    
  -- Prepare the result object
  v_result = jsonb_build_object(
    'job_id', p_job_id,
    'recorded_total', v_total_chunks,
    'recorded_completed', v_completed_chunks,
    'actual_completed', v_actual_completed_chunks,
    'actual_pending', v_pending_chunks,
    'actual_processing', v_processing_chunks,
    'actual_errored', v_errored_chunks,
    'reconciled', FALSE
  );
  
  -- Always reconcile completed_chunks to match actual count
  IF v_completed_chunks != v_actual_completed_chunks THEN
    UPDATE podcast_jobs
    SET 
      completed_chunks = v_actual_completed_chunks,
      updated_at = NOW()
    WHERE 
      id = p_job_id;
      
    v_result = jsonb_set(v_result, '{reconciled}', 'true');
  END IF;
  
  -- Reset any jobs where completed_chunks exceeds total_chunks
  IF v_completed_chunks > v_total_chunks THEN
    UPDATE podcast_jobs
    SET 
      completed_chunks = v_actual_completed_chunks,
      updated_at = NOW()
    WHERE 
      id = p_job_id;
      
    v_result = jsonb_set(v_result, '{reconciled}', 'true');
    v_result = jsonb_set(v_result, '{fixed_overflow}', 'true');
  END IF;
  
  -- Determine appropriate job status
  DECLARE
    v_new_status TEXT;
  BEGIN
    -- Logic for determining job status based on chunk counts
    IF v_actual_completed_chunks = v_total_chunks THEN
      v_new_status := 'completed';
    ELSIF v_actual_completed_chunks > 0 OR v_pending_chunks > 0 OR v_processing_chunks > 0 THEN
      v_new_status := 'processing';
    ELSIF v_errored_chunks > 0 THEN
      v_new_status := 'error';
    ELSE
      v_new_status := 'processing'; -- Default if we can't determine
    END IF;
    
    -- Update status if needed
    UPDATE podcast_jobs
    SET 
      status = v_new_status,
      error = CASE
        WHEN v_errored_chunks > 0 THEN format('%s of %s chunks failed', v_errored_chunks, v_total_chunks)
        WHEN v_actual_completed_chunks = 0 AND v_pending_chunks = 0 AND v_processing_chunks = 0 THEN 'No chunks were processed'
        ELSE NULL
      END,
      updated_at = NOW()
    WHERE 
      id = p_job_id AND
      status != v_new_status;
      
    IF FOUND THEN
      v_result = jsonb_set(v_result, '{reconciled}', 'true');
      v_result = jsonb_set(v_result, '{status_updated}', to_jsonb(v_new_status));
    END IF;
  END;
  
  -- Check for any orphaned chunks (status=processing but stalled)
  -- In a real implementation, you might add logic to detect and reset stalled chunks
  
  RETURN v_result;
END;
$$;

-- Add a constraint to ensure completed_chunks never exceeds total_chunks
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_completed_chunks_not_exceed_total'
  ) THEN
    ALTER TABLE podcast_jobs
    ADD CONSTRAINT check_completed_chunks_not_exceed_total
    CHECK (completed_chunks <= total_chunks);
  END IF;
END $$;

-- Fix any existing inconsistencies before the constraint is applied
UPDATE podcast_jobs
SET completed_chunks = total_chunks
WHERE completed_chunks > total_chunks;

-- Add a function to reset any stuck processing chunks
CREATE OR REPLACE FUNCTION reset_stalled_processing_chunks()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_affected_count INTEGER;
BEGIN
  -- Reset chunks that have been in 'processing' state for more than 10 minutes
  -- This helps recover from edge function timeouts or crashes
  UPDATE podcast_chunks
  SET 
    status = 'pending',
    updated_at = NOW(),
    error = 'Reset after being stuck in processing state'
  WHERE 
    status = 'processing' AND
    updated_at < (NOW() - INTERVAL '10 minutes');
    
  GET DIAGNOSTICS v_affected_count = ROW_COUNT;
  
  RETURN v_affected_count;
END;
$$;

-- Create a scheduled function to run the cleanup periodically
COMMENT ON FUNCTION reset_stalled_processing_chunks() IS 
  'Resets podcast chunks that have been stuck in processing state for too long'; 