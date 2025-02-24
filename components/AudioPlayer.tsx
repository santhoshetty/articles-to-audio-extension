'use client';

import { useState, useEffect } from 'react';
import supabase from '../supabaseClient';

interface AudioPlayerProps {
  articleIds: string[];
}

export default function AudioPlayer({ articleIds }: AudioPlayerProps) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchExistingPodcast = async () => {
      try {
        // First get all article_audio entries for the selected articles
        const { data: articleAudioEntries, error: articleAudioError } = await supabase
          .from('article_audio')
          .select('audio_id, article_id')
          .in('article_id', articleIds);

        if (articleAudioError) throw articleAudioError;

        // Group entries by audio_id and find those that contain all selected articles
        const audioGroups = articleAudioEntries.reduce((acc, entry) => {
          acc[entry.audio_id] = acc[entry.audio_id] || new Set();
          acc[entry.audio_id].add(entry.article_id);
          return acc;
        }, {});

        // Find the audio_id that has all the selected articles
        const matchingAudioId = Object.entries(audioGroups).find(([_, articleSet]) => 
          articleIds.every(id => articleSet.has(id))
        )?.[0];

        if (!matchingAudioId) {
          setError('No existing podcast found for these articles');
          return;
        }

        // Get the audio file URL for the matching podcast
        const { data: audioFile, error: audioFileError } = await supabase
          .from('audio_files')
          .select('file_url')
          .eq('id', matchingAudioId)
          .single();

        if (audioFileError) throw audioFileError;
        if (!audioFile?.file_url) throw new Error('Audio file not found');

        setAudioUrl(audioFile.file_url);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load audio');
      } finally {
        setIsLoading(false);
      }
    };

    if (articleIds.length > 0) {
      fetchExistingPodcast();
    } else {
      setError('No articles selected');
      setIsLoading(false);
    }
  }, [articleIds]);

  if (isLoading) return <div>Loading audio...</div>;
  if (error) return <div>Error: {error}</div>;
  if (!audioUrl) return <div>No audio available</div>;

  return (
    <div className="w-full max-w-2xl mx-auto p-4">
      <audio 
        className="w-full" 
        controls 
        src={audioUrl}
        preload="metadata"
      >
        Your browser does not support the audio element.
      </audio>
    </div>
  );
} 