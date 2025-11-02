import { useState, useEffect } from 'react';
import { Download, Edit2, Trash2, Plus, Check, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { Transaction } from '../types/transaction';
import * as XLSX from 'xlsx';

interface DataPreviewProps {
  data: Transaction[];
  filename: string;
  onDataChange: (data: Transaction[]) => void;
  headers?: string[];
}

export default function DataPreview({ data, filename, onDataChange, headers: initialHeaders }: DataPreviewProps) {
  const [editableData, setEditableData] = useState<Transaction[]>(data);
  const [editingCell, setEditingCell] = useState<{ row: number; col: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const headers = initialHeaders && initialHeaders.length > 0
    ? initialHeaders
    : (data.length > 0 ? Object.keys(data[0]) : []);

  const totalPages = Math.ceil(editableData.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentData = editableData.slice(startIndex, endIndex);

  useEffect(() => {
    setEditableData(data);
    setCurrentPage(1);
  }, [data]);

  const handleCellEdit = (rowIndex: number, column: keyof Transaction, value: string) => {
    const actualIndex = startIndex + rowIndex;
    const newData = [...editableData];
    newData[actualIndex] = { ...newData[actualIndex], [column]: value };
    setEditableData(newData);
    onDataChange(newData);
  };

  const handleStartEdit = (rowIndex: number, column: string, currentValue: string) => {
    setEditingCell({ row: rowIndex, col: column });
    setEditValue(currentValue);
  };

  const handleSaveEdit = (rowIndex: number, column: keyof Transaction) => {
    handleCellEdit(rowIndex, column, editValue);
    setEditingCell(null);
    setEditValue('');
  };

  const handleCancelEdit = () => {
    setEditingCell(null);
    setEditValue('');
  };

  const handleDeleteRow = (rowIndex: number) => {
    const actualIndex = startIndex + rowIndex;
    const newData = editableData.filter((_, index) => index !== actualIndex);
    setEditableData(newData);
    onDataChange(newData);
    if (currentData.length === 1 && currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const handleAddRow = () => {
    const newRow: Transaction = {
      date: '',
      particulars: '',
      withdrawal: '',
      deposit: '',
      balance: '',
    };
    const newData = [...editableData, newRow];
    setEditableData(newData);
    onDataChange(newData);
  };

  const downloadExcel = () => {
    const formattedData = editableData.map(row => {
      const newRow: any = {};
      headers.forEach(header => {
        const value = row[header as keyof Transaction];
        const lowerHeader = header.toLowerCase();

        if (value && (lowerHeader.includes('withdrawal') || lowerHeader.includes('deposit') || lowerHeader.includes('balance') || lowerHeader.includes('amount') || lowerHeader.includes('debit') || lowerHeader.includes('credit'))) {
          const cleanedValue = value.replace(/,/g, '').trim();
          const numValue = parseFloat(cleanedValue);
          newRow[header] = isNaN(numValue) ? value : numValue;
        } else {
          newRow[header] = value;
        }
      });
      return newRow;
    });

    const worksheet = XLSX.utils.json_to_sheet(formattedData);

    const columnWidths = headers.map(h => ({
      wch: h.toLowerCase().includes('description') || h.toLowerCase().includes('particulars') || h.toLowerCase().includes('narration')
        ? 50
        : h.toLowerCase().includes('date')
          ? 12
          : 18
    }));
    worksheet['!cols'] = columnWidths;

    const amountColumnIndices = headers
      .map((h, idx) => {
        const lowerH = h.toLowerCase();
        if (lowerH.includes('withdrawal') || lowerH.includes('deposit') || lowerH.includes('balance') || lowerH.includes('amount') || lowerH.includes('debit') || lowerH.includes('credit')) {
          return idx;
        }
        return -1;
      })
      .filter(idx => idx !== -1);

    amountColumnIndices.forEach(colIdx => {
      const colLetter = XLSX.utils.encode_col(colIdx);
      for (let rowIdx = 2; rowIdx <= formattedData.length + 1; rowIdx++) {
        const cellRef = `${colLetter}${rowIdx}`;
        if (worksheet[cellRef] && typeof worksheet[cellRef].v === 'number') {
          worksheet[cellRef].t = 'n';
          worksheet[cellRef].z = '#,##0.00';
        }
      }
    });

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Transactions');

    const cleanFilename = filename.replace('.pdf', '');
    XLSX.writeFile(workbook, `${cleanFilename}_transactions.xlsx`);
  };

  const columns = headers.map(header => ({
    key: header,
    label: header,
    width: header.toLowerCase().includes('description') || header.toLowerCase().includes('particulars')
      ? 'w-96'
      : header.toLowerCase().includes('date')
        ? 'w-32'
        : 'w-32'
  }));

  return (
    <div className="w-full bg-white rounded-2xl shadow-xl p-6 animate-fadeIn">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Transaction Preview</h2>
          <p className="text-gray-500 mt-1">{editableData.length} transactions found</p>
        </div>
        <div className="flex space-x-3">
          <button
            onClick={handleAddRow}
            className="flex items-center space-x-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-all duration-200 transform hover:scale-105 shadow-md hover:shadow-lg"
          >
            <Plus className="w-4 h-4" />
            <span>Add Row</span>
          </button>
          <button
            onClick={downloadExcel}
            className="flex items-center space-x-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all duration-200 transform hover:scale-105 shadow-md hover:shadow-lg"
          >
            <Download className="w-5 h-5" />
            <span>Download Excel</span>
          </button>
        </div>
      </div>

      <div className="overflow-x-auto border border-gray-200 rounded-xl">
        <table className="w-full">
          <thead>
            <tr className="bg-gradient-to-r from-blue-50 to-indigo-50">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`${col.width} px-4 py-3 text-left text-sm font-semibold text-gray-700 border-b-2 border-gray-200`}
                >
                  {col.label}
                </th>
              ))}
              <th className="w-24 px-4 py-3 text-left text-sm font-semibold text-gray-700 border-b-2 border-gray-200">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {currentData.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className="border-b border-gray-100 hover:bg-blue-50 transition-colors duration-150"
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className="px-4 py-3 text-sm text-gray-700"
                    onDoubleClick={() =>
                      handleStartEdit(rowIndex, col.key, row[col.key as keyof Transaction])
                    }
                  >
                    {editingCell?.row === rowIndex && editingCell?.col === col.key ? (
                      <div className="flex items-center space-x-2">
                        <input
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="flex-1 px-2 py-1 border border-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                          autoFocus
                        />
                        <button
                          onClick={() => handleSaveEdit(rowIndex, col.key as keyof Transaction)}
                          className="p-1 text-green-600 hover:bg-green-100 rounded transition-colors"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          className="p-1 text-red-600 hover:bg-red-100 rounded transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center group">
                        <span className="flex-1">{row[col.key as keyof Transaction]}</span>
                        <Edit2
                          className="w-3 h-3 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer ml-2"
                          onClick={() =>
                            handleStartEdit(rowIndex, col.key, row[col.key as keyof Transaction])
                          }
                        />
                      </div>
                    )}
                  </td>
                ))}
                <td className="px-4 py-3">
                  <button
                    onClick={() => handleDeleteRow(rowIndex)}
                    className="p-2 text-red-500 hover:bg-red-100 rounded-lg transition-all duration-200 transform hover:scale-110"
                    title="Delete row"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <div className="text-sm text-gray-500">
          Showing {startIndex + 1} to {Math.min(endIndex, editableData.length)} of {editableData.length} transactions
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
            disabled={currentPage === 1}
            className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <span className="text-sm font-medium text-gray-700">
            Page {currentPage} of {totalPages}
          </span>

          <button
            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
            disabled={currentPage === totalPages}
            className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        <div className="text-sm text-gray-500">
          Double-click any cell to edit
        </div>
      </div>
    </div>
  );
}
