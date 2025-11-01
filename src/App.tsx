import { useState } from 'react';
import Header from './components/Header';
import FileUpload from './components/FileUpload';
import DataPreview from './components/DataPreview';
import Features from './components/Features';
import { processPDF } from './services/pdfProcessor';
import { Transaction } from './types/transaction';
import { AlertCircle } from 'lucide-react';

function App() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [filename, setFilename] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = async (file: File) => {
    setIsProcessing(true);
    setError(null);
    setTransactions([]);

    try {
      const result = await processPDF(file);

      if (result.success && result.data) {
        setTransactions(result.data);
        setFilename(result.filename);
      } else {
        setError('Failed to extract transaction data from the PDF');
      }
    } catch (err) {
      setError('An error occurred while processing the PDF. Please try again.');
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDataChange = (newData: Transaction[]) => {
    setTransactions(newData);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50 to-indigo-50">
      <Header />

      <main className="container mx-auto px-4 py-12">
        <Features />

        <div className="mb-12">
          <FileUpload onFileSelect={handleFileSelect} isProcessing={isProcessing} />
        </div>

        {error && (
          <div className="max-w-2xl mx-auto mb-8 bg-red-50 border border-red-200 rounded-xl p-4 flex items-start space-x-3 animate-fadeIn">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="text-red-800 font-semibold">Error</h3>
              <p className="text-red-600 text-sm mt-1">{error}</p>
            </div>
          </div>
        )}

        {transactions.length > 0 && (
          <div className="animate-fadeIn">
            <DataPreview
              data={transactions}
              filename={filename}
              onDataChange={handleDataChange}
            />
          </div>
        )}

        {!isProcessing && transactions.length === 0 && !error && (
          <div className="text-center mt-12 text-gray-500">
            <p className="text-lg">Upload a bank statement PDF to get started</p>
            <p className="text-sm mt-2">Supports all major bank formats with automatic column detection</p>
          </div>
        )}
      </main>

      <footer className="bg-white border-t border-gray-200 py-6 mt-20">
        <div className="container mx-auto px-4 text-center text-gray-600 text-sm">
          <p>Secure PDF to Excel conversion for bank statements</p>
          <p className="mt-2 text-gray-400">All processing happens securely. Your data is safe.</p>
        </div>
      </footer>
    </div>
  );
}

export default App;
