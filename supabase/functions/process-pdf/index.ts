import * as pdfjsLib from "npm:pdfjs-dist@4.0.379/legacy/build/pdf.mjs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return new Response(
        JSON.stringify({ error: "No file provided", success: false, data: [] }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    const { transactions, headers } = await extractBankStatementData(uint8Array);

    return new Response(
      JSON.stringify({
        success: transactions.length > 0,
        data: transactions,
        headers: headers,
        filename: file.name,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error('Error processing PDF:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        data: [],
        headers: []
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

interface TextItem {
  text: string;
  y: number;
  x: number;
  height: number;
  width: number;
}

interface Column {
  header: string;
  startX: number;
  endX: number;
  originalHeader: string;
}

interface Transaction {
  [key: string]: string;
}

async function extractBankStatementData(data: Uint8Array): Promise<{ transactions: Transaction[], headers: string[] }> {
  try {
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const allPagesData: TextItem[][] = [];

    // Extract text from all pages
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      
      const pageItems: TextItem[] = textContent.items
        .filter((item: any) => item.str && item.str.trim())
        .map((item: any) => ({
          text: item.str.trim(),
          y: Math.round(item.transform[5] * 100) / 100,
          x: Math.round(item.transform[4] * 100) / 100,
          height: item.height || 0,
          width: item.width || 0,
        }));

      allPagesData.push(pageItems);
    }

    return processAllPages(allPagesData);
  } catch (error) {
    console.error('PDF extraction error:', error);
    throw new Error('Failed to extract data from PDF');
  }
}

function processAllPages(allPagesData: TextItem[][]): { transactions: Transaction[], headers: string[] } {
  let allTransactions: Transaction[] = [];
  let globalHeaders: string[] = [];
  let globalColumns: Column[] = [];
  const seenTransactions = new Set<string>();

  for (let pageIndex = 0; pageIndex < allPagesData.length; pageIndex++) {
    const pageItems = allPagesData[pageIndex];
    if (pageItems.length === 0) continue;

    const rows = groupItemsIntoRows(pageItems);
    
    // Detect structure for first page or if we don't have headers yet
    if (pageIndex === 0 || globalHeaders.length === 0) {
      const structure = detectPageStructure(rows);
      
      if (structure.headers.length > 0) {
        globalHeaders = structure.headers;
        globalColumns = structure.columns;
      }
    }

    const pageTransactions = extractTransactionsFromPage(
      rows, 
      globalColumns, 
      globalHeaders,
      pageIndex
    );

    // Add unique transactions
    for (const transaction of pageTransactions) {
      const key = createTransactionKey(transaction);
      if (!seenTransactions.has(key) && isValidTransaction(transaction)) {
        seenTransactions.add(key);
        allTransactions.push(transaction);
      }
    }
  }

  return {
    transactions: allTransactions,
    headers: globalHeaders
  };
}

function groupItemsIntoRows(items: TextItem[]): TextItem[][] {
  if (items.length === 0) return [];

  // Sort by Y coordinate (top to bottom in PDF coordinates)
  const sortedByY = [...items].sort((a, b) => b.y - a.y);
  
  const rows: TextItem[][] = [];
  let currentRow: TextItem[] = [sortedByY[0]];
  let currentY = sortedByY[0].y;

  for (let i = 1; i < sortedByY.length; i++) {
    const item = sortedByY[i];
    const yDiff = Math.abs(currentY - item.y);
    
    // Consider items on same row if Y difference is small (within line height tolerance)
    if (yDiff <= 2) {
      currentRow.push(item);
    } else {
      // Sort current row by X coordinate (left to right) and add to rows
      rows.push(currentRow.sort((a, b) => a.x - b.x));
      currentRow = [item];
      currentY = item.y;
    }
  }

  // Add the last row
  if (currentRow.length > 0) {
    rows.push(currentRow.sort((a, b) => a.x - b.x));
  }

  return rows;
}

function detectPageStructure(rows: TextItem[][]): { headers: string[], columns: Column[] } {
  let bestHeaderRow: TextItem[] | null = null;
  let bestHeaderScore = 0;

  // Look for header row in first 15 rows
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const row = rows[i];
    const score = calculateHeaderScore(row);
    
    if (score > bestHeaderScore && score > 2) {
      bestHeaderScore = score;
      bestHeaderRow = row;
    }
  }

  if (bestHeaderRow) {
    const columns = calculateColumnsFromHeader(bestHeaderRow);
    const headers = bestHeaderRow.map(item => item.text);
    
    return { headers, columns };
  }

  // Fallback: try to detect columns from data patterns
  return detectColumnsFromData(rows);
}

function calculateHeaderScore(row: TextItem[]): number {
  if (row.length < 2) return 0;

  const headerKeywords = [
    'date', 'description', 'particulars', 'narration', 'details',
    'debit', 'credit', 'withdrawal', 'deposit', 'balance',
    'amount', 'transaction', 'value', 'chq', 'cheque',
    'ref', 'reference', 'no', 'number', 'dr', 'cr'
  ];

  let score = 0;
  const rowText = row.map(item => item.text.toLowerCase()).join(' ');

  // Check for header keywords
  headerKeywords.forEach(keyword => {
    if (rowText.includes(keyword)) score += 2;
  });

  // Penalize rows that contain data-like content
  if (hasTransactionData(row)) score -= 5;
  
  // Penalize rows that are too short
  if (row.length < 3) score -= 2;

  return Math.max(0, score);
}

function hasTransactionData(row: TextItem[]): boolean {
  return row.some(item => 
    isDateValue(item.text) || 
    isAmountValue(item.text) ||
    hasMultipleWords(item.text)
  );
}

function hasMultipleWords(text: string): boolean {
  return text.trim().split(/\s+/).length > 2;
}

function calculateColumnsFromHeader(headerRow: TextItem[]): Column[] {
  const columns: Column[] = [];
  const sortedHeaders = [...headerRow].sort((a, b) => a.x - b.x);

  for (let i = 0; i < sortedHeaders.length; i++) {
    const header = sortedHeaders[i];
    
    const startX = i === 0 ? 0 : (sortedHeaders[i-1].x + header.x) / 2;
    const endX = i === sortedHeaders.length - 1 ? Infinity : (header.x + sortedHeaders[i+1].x) / 2;

    columns.push({
      header: header.text,
      originalHeader: header.text,
      startX,
      endX
    });
  }

  return columns;
}

function detectColumnsFromData(rows: TextItem[][]): { headers: string[], columns: Column[] } {
  // Find data rows to detect column structure
  const dataRows = rows.filter(row => 
    !isHeaderRow(row) && 
    !isFooterRow(row) && 
    hasTransactionData(row) &&
    row.length >= 2
  ).slice(0, 10); // Use first 10 data rows

  if (dataRows.length === 0) {
    return { headers: [], columns: [] };
  }

  // Cluster X positions to find columns
  const allXPositions = dataRows.flat().map(item => item.x).sort((a, b) => a - b);
  const clusters: number[][] = [[]];
  
  for (const x of allXPositions) {
    const lastCluster = clusters[clusters.length - 1];
    if (lastCluster.length === 0 || x - lastCluster[0] <= 10) {
      lastCluster.push(x);
    } else {
      clusters.push([x]);
    }
  }

  const columnCenters = clusters
    .filter(cluster => cluster.length >= dataRows.length * 0.3) // Must appear in at least 30% of rows
    .map(cluster => cluster.reduce((a, b) => a + b) / cluster.length)
    .sort((a, b) => a - b);

  const headers = columnCenters.map((_, i) => `Column_${i + 1}`);
  const columns: Column[] = columnCenters.map((center, i) => ({
    header: headers[i],
    originalHeader: headers[i],
    startX: i === 0 ? 0 : (columnCenters[i-1] + center) / 2,
    endX: i === columnCenters.length - 1 ? Infinity : (center + columnCenters[i+1]) / 2
  }));

  return { headers, columns };
}

function extractTransactionsFromPage(
  rows: TextItem[][], 
  columns: Column[], 
  headers: string[],
  pageIndex: number
): Transaction[] {
  const transactions: Transaction[] = [];
  
  if (columns.length === 0 || headers.length === 0) {
    return extractTransactionsWithoutStructure(rows);
  }

  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    
    if (isHeaderRow(row) || isFooterRow(row) || row.length === 0) {
      i++;
      continue;
    }

    // Check if this could be a transaction start
    const potentialTransaction = mapRowToColumns(row, columns, headers);
    
    if (isPotentialTransactionStart(potentialTransaction)) {
      // Look for continuation lines
      let transactionData = { ...potentialTransaction };
      let j = i + 1;
      let continuations = 0;
      const maxContinuations = 5;

      while (j < rows.length && continuations < maxContinuations) {
        const nextRow = rows[j];
        
        if (isFooterRow(nextRow) || isHeaderRow(nextRow)) break;
        
        const nextRowData = mapRowToColumns(nextRow, columns, headers);
        
        // If next row looks like a new transaction, stop
        if (isNewTransaction(nextRowData, transactionData)) break;
        
        // Merge continuation data
        transactionData = mergeTransactionLines(transactionData, nextRowData, headers);
        j++;
        continuations++;
      }

      if (isValidTransaction(transactionData)) {
        transactions.push(transactionData);
      }

      i = j; // Skip the lines we've processed
    } else {
      i++;
    }
  }

  return transactions;
}

function extractTransactionsWithoutStructure(rows: TextItem[][]): Transaction[] {
  const transactions: Transaction[] = [];
  const columnCount = detectColumnCountFromData(rows);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    
    if (isHeaderRow(row) || isFooterRow(row) || row.length === 0) continue;

    // Create simple transaction with detected columns
    const transaction: Transaction = {};
    for (let col = 0; col < Math.min(columnCount, row.length); col++) {
      transaction[`Column_${col + 1}`] = row[col].text;
    }

    // Try to merge multi-line transactions
    if (isPotentialTransactionStart(transaction)) {
      let j = i + 1;
      while (j < rows.length && shouldMergeWithNext(rows[j], transaction)) {
        for (let col = 0; col < Math.min(columnCount, rows[j].length); col++) {
          const current = transaction[`Column_${col + 1}`] || '';
          const additional = rows[j][col]?.text || '';
          if (additional && !current.includes(additional)) {
            transaction[`Column_${col + 1}`] = current + ' ' + additional;
          }
        }
        j++;
      }
      i = j - 1;
    }

    if (isValidTransaction(transaction)) {
      transactions.push(transaction);
    }
  }

  return transactions;
}

function detectColumnCountFromData(rows: TextItem[][]): number {
  const dataRows = rows.filter(row => 
    !isHeaderRow(row) && 
    !isFooterRow(row) && 
    hasTransactionData(row)
  ).slice(0, 20);

  if (dataRows.length === 0) return 3;

  const columnCounts = dataRows.map(row => row.length);
  const mode = columnCounts.reduce((a, b) => 
    columnCounts.filter(v => v === a).length >= columnCounts.filter(v => v === b).length ? a : b
  );

  return mode;
}

function shouldMergeWithNext(nextRow: TextItem[], currentTransaction: Transaction): boolean {
  if (isHeaderRow(nextRow) || isFooterRow(nextRow) || nextRow.length === 0) return false;
  
  // Don't merge if next row has a date (likely new transaction)
  if (nextRow.some(item => isDateValue(item.text))) return false;
  
  // Don't merge if next row has amounts in multiple columns (likely new transaction)
  const amountColumns = nextRow.filter(item => isAmountValue(item.text)).length;
  if (amountColumns >= 2) return false;

  return true;
}

function mapRowToColumns(row: TextItem[], columns: Column[], headers: string[]): Transaction {
  const transaction: Transaction = {};
  headers.forEach(header => transaction[header] = '');

  // Group items by column
  const columnItems: { [key: string]: string[] } = {};
  headers.forEach(header => columnItems[header] = []);

  row.forEach(item => {
    for (const column of columns) {
      if (item.x >= column.startX && item.x < column.endX) {
        columnItems[column.header].push(item.text);
        break;
      }
    }
  });

  // Join items in each column
  headers.forEach(header => {
    if (columnItems[header].length > 0) {
      transaction[header] = columnItems[header].join(' ').trim();
    }
  });

  return transaction;
}

function isPotentialTransactionStart(transaction: Transaction): boolean {
  const values = Object.values(transaction).filter(v => v.trim().length > 0);
  if (values.length < 2) return false;

  const hasDate = Object.values(transaction).some(v => isDateValue(v));
  const hasAmount = Object.values(transaction).some(v => isAmountValue(v));
  
  return hasDate || hasAmount;
}

function isNewTransaction(nextRowData: Transaction, currentTransaction: Transaction): boolean {
  // Check if next row has a date different from current transaction
  const currentDate = findDateValue(currentTransaction);
  const nextDate = findDateValue(nextRowData);
  
  if (nextDate && currentDate && nextDate !== currentDate) return true;

  // Check if next row has multiple amount fields (likely new transaction)
  const nextAmounts = Object.values(nextRowData).filter(v => isAmountValue(v)).length;
  if (nextAmounts >= 2) return true;

  return false;
}

function findDateValue(transaction: Transaction): string {
  for (const value of Object.values(transaction)) {
    if (isDateValue(value)) return value;
  }
  return '';
}

function mergeTransactionLines(current: Transaction, next: Transaction, headers: string[]): Transaction {
  const merged = { ...current };

  headers.forEach(header => {
    const currentVal = current[header] || '';
    const nextVal = next[header] || '';
    
    if (nextVal && !currentVal.includes(nextVal)) {
      // For description-like columns, append text
      if (header.toLowerCase().includes('desc') || 
          header.toLowerCase().includes('part') || 
          header.toLowerCase().includes('narr') ||
          header.toLowerCase().includes('detail')) {
        merged[header] = (currentVal + ' ' + nextVal).trim();
      } else if (!currentVal && nextVal) {
        // For empty columns, use next value
        merged[header] = nextVal;
      }
      // For amount/date columns, don't merge if current already has value
    }
  });

  return merged;
}

function isHeaderRow(row: TextItem[]): boolean {
  if (row.length < 2) return false;

  const headerKeywords = [
    'date', 'description', 'particulars', 'debit', 'credit',
    'withdrawal', 'deposit', 'balance', 'amount', 'transaction'
  ];

  const rowText = row.map(item => item.text.toLowerCase()).join(' ');
  const matches = headerKeywords.filter(keyword => rowText.includes(keyword)).length;

  return matches >= 2 && !hasTransactionData(row);
}

function isFooterRow(row: TextItem[]): boolean {
  const footerKeywords = [
    'end of statement', 'closing balance', 'page', 'continued',
    'thank you', 'regards', 'total', 'summary', 'opening balance'
  ];

  const rowText = row.map(item => item.text).join(' ').toLowerCase();
  return footerKeywords.some(keyword => rowText.includes(keyword));
}

function isValidTransaction(transaction: Transaction): boolean {
  const values = Object.values(transaction).filter(v => v && v.trim().length > 0);
  if (values.length < 2) return false;

  const allText = values.join(' ').toLowerCase();

  // Skip header-like rows
  if (isHeaderRowLike(allText)) return false;
  
  // Skip summary rows
  if (isSummaryRow(allText)) return false;

  // Should contain either date or amount data
  const hasDate = Object.values(transaction).some(v => isDateValue(v));
  const hasAmount = Object.values(transaction).some(v => isAmountValue(v));
  
  return (hasDate || hasAmount) && values.join('').length > 5;
}

function isHeaderRowLike(text: string): boolean {
  const headerPatterns = [
    /date.*description.*debit.*credit/i,
    /particulars.*withdrawal.*deposit.*balance/i
  ];
  
  return headerPatterns.some(pattern => pattern.test(text));
}

function isSummaryRow(text: string): boolean {
  const summaryPatterns = [
    /opening\s+balance/i,
    /closing\s+balance/i,
    /total\s+(debit|credit|amount)/i,
    /grand\s+total/i,
    /account\s+summary/i
  ];
  
  return summaryPatterns.some(pattern => pattern.test(text));
}

function isDateValue(text: string): boolean {
  if (!text || text.trim().length === 0) return false;

  const datePatterns = [
    /^\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}$/,
    /^\d{1,2}\s+\w{3}\s+\d{4}$/,
    /^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}$/,
    /^\d{1,2}\s+[A-Za-z]+\s+\d{4}$/,
    /^\d{1,2}-[A-Za-z]{3}-\d{2,4}$/,
    /^\d{1,2}\/\d{1,2}\/\d{4}$/,
    /^\d{1,2}-\d{1,2}-\d{4}$/,
  ];

  return datePatterns.some(pattern => pattern.test(text.trim()));
}

function isAmountValue(text: string): boolean {
  if (!text || text.trim().length === 0) return false;
  
  const cleaned = text.trim().replace(/,/g, '');
  
  const amountPatterns = [
    /^-?\d+\.\d{2}$/,
    /^-?\d+\.\d{1,2}$/,
    /^-?\d+$/,
    /^\d+\.\d{2}$/,
    /^\d+\.\d{1,2}$/,
    /^\d+$/,
  ];

  return amountPatterns.some(pattern => pattern.test(cleaned)) && !isDateValue(text);
}

function createTransactionKey(transaction: Transaction): string {
  // Create key from date and first amount found
  const date = findDateValue(transaction);
  const amounts = Object.values(transaction).filter(v => isAmountValue(v));
  const amount = amounts.length > 0 ? amounts[0] : '';
  
  return `${date}|${amount}|${JSON.stringify(transaction)}`.toLowerCase();
}