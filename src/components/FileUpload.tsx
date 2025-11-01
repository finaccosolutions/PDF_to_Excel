import { useState, useRef } from 'react';
import { Upload, FileText, Loader2 } from 'lucide-react';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  isProcessing: boolean;
}

export default function FileUpload({ onFileSelect, isProcessing }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].type === 'application/pdf') {
      setSelectedFile(files[0]);
      onFileSelect(files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      setSelectedFile(files[0]);
      onFileSelect(files[0]);
    }
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div
        onClick={handleClick}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={`
          relative border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer
          transition-all duration-300 ease-in-out transform
          ${isDragging
            ? 'border-blue-500 bg-blue-50 scale-105'
            : 'border-gray-300 bg-white hover:border-blue-400 hover:bg-gray-50 hover:scale-102'
          }
          ${isProcessing ? 'pointer-events-none opacity-60' : ''}
          shadow-lg hover:shadow-xl
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          onChange={handleFileChange}
          className="hidden"
          disabled={isProcessing}
        />

        <div className="flex flex-col items-center space-y-4">
          {isProcessing ? (
            <Loader2 className="w-16 h-16 text-blue-500 animate-spin" />
          ) : selectedFile ? (
            <FileText className="w-16 h-16 text-green-500 animate-bounce" />
          ) : (
            <Upload className="w-16 h-16 text-gray-400 transition-transform duration-300 group-hover:scale-110" />
          )}

          <div>
            <h3 className="text-xl font-semibold text-gray-700 mb-2">
              {isProcessing
                ? 'Processing your bank statement...'
                : selectedFile
                  ? selectedFile.name
                  : 'Upload Bank Statement PDF'
              }
            </h3>
            <p className="text-gray-500">
              {isProcessing
                ? 'Please wait while we extract your transaction data'
                : 'Drag and drop your PDF here, or click to browse'
              }
            </p>
          </div>

          {!isProcessing && !selectedFile && (
            <div className="text-sm text-gray-400 mt-4">
              Supports all major bank statement formats
            </div>
          )}
        </div>

        {isDragging && (
          <div className="absolute inset-0 bg-blue-100 bg-opacity-50 rounded-2xl flex items-center justify-center">
            <div className="text-blue-600 font-semibold text-lg">
              Drop your PDF here
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
