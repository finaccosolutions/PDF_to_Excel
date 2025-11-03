import { useState, useEffect } from 'react';
import { Download, Edit2, Check, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { Transaction, PageData } from '../types/transaction';
import * as XLSX from 'xlsx';

interface DataPreviewProps {
  data: Transaction[];
  pages: PageData[];
  filename: string;
  onDataChange: (data: Transaction[], pages: PageData[]) => void;
  headers?: string[];
  columnTypes?: { [key: string]: string };
}

export default function DataPreview({ 
  data, 
  pages, 
  filename, 
  onDataChange, 
  headers: initialHeaders,
  columnTypes = {}
}: DataPreviewProps) {
  const [editableData, setEditableData] = useState<Transaction[]>(data);
  const [editablePages, setEditablePages] = useState<PageData[]>(pages);
  const [editingCell, setEditingCell] = useState<{ row: number; col: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [currentPage, setCurrentPage] = useState(0);

  const headers = initialHeaders && initialHeaders.length > 0
    ? initialHeaders
    : (data.length > 0 ? Object.keys(data[0]) : []);

  useEffect(() => {
    setEditableData(data);
    setEditablePages(pages);
    setCurrentPage(0);
  }, [data, pages]);

  const currentPageData = editablePages.length > 0 && editablePages[currentPage]
    ? editablePages[currentPage].transactions
    : editableData;

  const formatCellValue = (value: string, columnType: string): string => {
    if (!value || value.trim().length === 0) return '';
    
    if (columnType === 'amount') {
      const cleaned = value.replace(/,/g, '').trim();
      const num = parseFloat(cleaned);
      if (!isNaN(num)) {
        return num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }
    } else if (columnType === 'date') {
      return value;
    }
    
    return value;
  };

  const handleCellEdit = (rowIndex: number, column: keyof Transaction, value: string) => {
    if (editablePages.length > 0) {
      const newPages = [...editablePages];
      const pageTransactions = [...newPages[currentPage].transactions];
      pageTransactions[rowIndex] = { ...pageTransactions[rowIndex], [column]: value };
      newPages[currentPage] = { ...newPages[currentPage], transactions: pageTransactions };

      const newAllData: Transaction[] = [];
      newPages.forEach(page => {
        newAllData.push(...page.transactions);
      });

      setEditablePages(newPages);
      setEditableData(newAllData);
      onDataChange(newAllData, newPages);
    } else {
      const newData = [...editableData];
      newData[rowIndex] = { ...newData[rowIndex], [column]: value };
      setEditableData(newData);
      onDataChange(newData, []);
    }
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

  const downloadExcel = () => {
    const formattedData = editableData.map(row => {
      const newRow: any = {};
      headers.forEach(header => {
        const value = row[header as keyof Transaction];
        const columnType = columnTypes[header] || 'text';

        if (value && columnType === 'amount') {
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

    const columnWidths = headers.map(h => {
      const columnType = columnTypes[h] || 'text';
      const lower = h.toLowerCase();
      
      if (lower.includes('description') || lower.includes('particulars') || lower.includes('narration')) {
        return { wch: 60 };
      } else if (columnType === 'date') {
        return { wch: 12 };
      } else if (columnType === 'amount') {
        return { wch: 15 };
      } else {
        return { wch: 18 };
      }
    });
    worksheet['!cols'] = columnWidths;

    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
    for (let C = range.s.c; C <= range.e.c; C++) {
      const headerCell = XLSX.utils.encode_cell({ r: 0, c: C });
      if (!worksheet[headerCell]) continue;

      worksheet[headerCell].s = {
        font: { bold: true, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "2563EB" } },
        alignment: { horizontal: "center", vertical: "center" }
      };
    }

    const amountColumnIndices: number[] = [];
    headers.forEach((h, idx) => {
      const columnType = columnTypes[h] || 'text';
      if (columnType === 'amount') {
        amountColumnIndices.push(idx);
      }
    });

    amountColumnIndices.forEach(colIdx => {
      const colLetter = XLSX.utils.encode_col(colIdx);
      for (let rowIdx = 2; rowIdx <= formattedData.length + 1; rowIdx++) {
        const cellRef = `${colLetter}${rowIdx}`;
        if (worksheet[cellRef] && typeof worksheet[cellRef].v === 'number') {
          worksheet[cellRef].t = 'n';
          worksheet[cellRef].z = '#,##0.00';
          worksheet[cellRef].s = {
            alignment: { horizontal: "right" }
          };
        }
      }
    });

    for (let R = 1; R <= formattedData.length; R++) {
      for (let C = range.s.c; C <= range.e.c; C++) {
        const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
        if (!worksheet[cellRef]) continue;

        const isAmountCol = amountColumnIndices.includes(C);

        worksheet[cellRef].s = {
          ...worksheet[cellRef].s,
          border: {
            top: { style: "thin", color: { rgb: "D1D5DB" } },
            bottom: { style: "thin", color: { rgb: "D1D5DB" } },
            left: { style: "thin", color: { rgb: "D1D5DB" } },
            right: { style: "thin", color: { rgb: "D1D5DB" } }
          },
          alignment: {
            horizontal: isAmountCol ? "right" : "left",
            vertical: "top",
            wrapText: true
          }
        };
      }
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Transactions');

    const cleanFilename = filename.replace('.pdf', '');
    XLSX.writeFile(workbook, `${cleanFilename}_transactions.xlsx`);
  };

  const getCellAlignment = (header: string): string => {
    const columnType = columnTypes[header] || 'text';
    if (columnType === 'amount') return 'text-right';
    if (columnType === 'date') return 'text-left';
    return 'text-left';
  };

  const getColumnWidth = (header: string): string => {
    const columnType = columnTypes[header] || 'text';
    const lower = header.toLowerCase();
    
    if (lower.includes('description') || lower.includes('particulars') || lower.includes('narration')) {
      return 'min-w-[400px]';
    } else if (columnType === 'date') {
      return 'w-32';
    } else if (columnType === 'amount') {
      return 'w-36';
    } else {
      return 'w-40';
    }
  };

  const columns = headers.map(header => ({
    key: header,
    label: header,
    width: getColumnWidth(header),
    type: columnTypes[header] || 'text',
    alignment: getCellAlignment(header)
  }));

  return (
    <div className="w-full bg-white rounded-2xl shadow-xl p-6 animate-fadeIn">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Transaction Preview</h2>
          <p className="text-gray-500 mt-1">
            {editableData.length} total transactions
            {editablePages.length > 0 && ` • Page ${currentPage + 1} of ${editablePages.length}`}
          </p>
        </div>
        <button
          onClick={downloadExcel}
          className="flex items-center space-x-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all duration-200 transform hover:scale-105 shadow-md hover:shadow-lg"
        >
          <Download className="w-5 h-5" />
          <span>Download Excel</span>
        </button>
      </div>

      <div className="overflow-x-auto border border-gray-200 rounded-xl max-h-[600px] overflow-y-auto">
        <table className="w-full">
          <thead className="sticky top-0 z-10">
            <tr className="bg-gradient-to-r from-blue-600 to-blue-700">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`${col.width} px-4 py-3 text-left text-sm font-bold text-white border-b-2 border-blue-800 ${col.alignment}`}
                >
                  <div className="flex flex-col">
                    <span>{col.label}</span>
                    <span className="text-xs font-normal text-blue-100 opacity-75">
                      {col.type === 'date' && '(Date)'}
                      {col.type === 'amount' && '(Amount)'}
                      {col.type === 'text' && '(Text)'}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {currentPageData.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className="border-b border-gray-100 hover:bg-blue-50 transition-colors duration-150"
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-4 py-3 text-sm text-gray-700 align-top ${col.alignment}`}
                    onDoubleClick={() =>
                      handleStartEdit(rowIndex, col.key, row[col.key as keyof Transaction])
                    }
                  >
                    {editingCell?.row === rowIndex && editingCell?.col === col.key ? (
                      <div className="flex items-center space-x-2">
                        <textarea
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="flex-1 px-2 py-1 border border-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[60px]"
                          autoFocus
                          rows={3}
                        />
                        <div className="flex flex-col space-y-1">
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
                      </div>
                    ) : (
                      <div className="flex items-start group">
                        <span className="flex-1 whitespace-pre-wrap break-words">
                          {formatCellValue(row[col.key as keyof Transaction], col.type)}
                        </span>
                        <Edit2
                          className="w-3 h-3 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer ml-2 flex-shrink-0 mt-1"
                          onClick={() =>
                            handleStartEdit(rowIndex, col.key, row[col.key as keyof Transaction])
                          }
                        />
                      </div>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editablePages.length > 0 && (
        <div className="flex items-center justify-between mt-4 bg-gray-50 p-3 rounded-lg">
          <button
            onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
            disabled={currentPage === 0}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-all ${
              currentPage === 0
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-white text-blue-600 hover:bg-blue-50 shadow-sm'
            }`}
          >
            <ChevronLeft className="w-4 h-4" />
            <span>Previous</span>
          </button>

          <div className="text-sm font-semibold text-gray-700">
            Page {currentPage + 1} of {editablePages.length}
            <span className="text-gray-500 ml-2">
              ({currentPageData.length} transactions)
            </span>
          </div>

          <button
            onClick={() => setCurrentPage(Math.min(editablePages.length - 1, currentPage + 1))}
            disabled={currentPage === editablePages.length - 1}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-all ${
              currentPage === editablePages.length - 1
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-white text-blue-600 hover:bg-blue-50 shadow-sm'
            }`}
          >
            <span>Next</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between">
        <div className="text-sm text-gray-500">
          Total: {editableData.length} transactions across {editablePages.length > 0 ? `${editablePages.length} pages` : '1 page'}
        </div>

        <div className="text-sm text-gray-500">
          Double-click any cell to edit
        </div>
      </div>
    </div>
  );
}
