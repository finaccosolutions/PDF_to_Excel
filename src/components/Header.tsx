import { FileSpreadsheet, Sparkles } from 'lucide-react';

export default function Header() {
  return (
    <header className="bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-700 text-white py-6 shadow-2xl">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="relative">
              <FileSpreadsheet className="w-10 h-10 animate-pulse" />
              <Sparkles className="w-4 h-4 absolute -top-1 -right-1 text-yellow-300" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">
                PDF to Excel Converter
              </h1>
              <p className="text-blue-100 text-sm mt-1">
                Convert bank statements to perfect Excel spreadsheets
              </p>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
