import { supabase } from '../lib/supabase';
import { ConversionResult } from '../types/transaction';

export async function processPDF(file: File): Promise<ConversionResult> {
  try {
    const formData = new FormData();
    formData.append('file', file);

    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-pdf`;

    console.log('Sending PDF to:', apiUrl);
    console.log('File:', file.name, file.size, file.type);

    const response = await fetch(apiUrl, {
      method: 'POST',
      body: formData,
    });

    console.log('Response status:', response.status);
    console.log('Response ok:', response.ok);

    const result = await response.json();
    console.log('Processing result:', result);

    if (result.success && result.data && result.data.length > 0) {
      try {
        await supabase.from('conversions').insert({
          original_filename: file.name,
          extracted_data: result.data,
          status: 'completed',
        });
      } catch (dbError) {
        console.warn('Database insert warning (not critical):', dbError);
      }
    }

    return result;
  } catch (error) {
    console.error('Error processing PDF:', error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Failed to process PDF. Please try again.');
  }
}
