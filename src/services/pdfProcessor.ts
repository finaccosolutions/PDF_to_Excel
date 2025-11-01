import { supabase } from '../lib/supabase';
import { ConversionResult } from '../types/transaction';

export async function processPDF(file: File): Promise<ConversionResult> {
  try {
    const formData = new FormData();
    formData.append('file', file);

    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-pdf`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error('Failed to process PDF');
    }

    const result = await response.json();

    await supabase.from('conversions').insert({
      original_filename: file.name,
      extracted_data: result.data,
      status: 'completed',
    });

    return result;
  } catch (error) {
    console.error('Error processing PDF:', error);
    throw error;
  }
}
