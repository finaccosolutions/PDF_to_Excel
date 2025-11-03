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

    const result = await extractBankStatementData(uint8Array);

    return new Response(
      JSON.stringify({
        success: result.transactions.length > 0,
        data: result.transactions,
        pages: result.pages,
        headers: result.headers,
        columnTypes: result.columnTypes,
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
  index: number;
  type: 'date' | 'amount' | 'text';
}

interface Transaction {
  [key: string]: string;
}

interface PageData {
  pageNumber: number;
  transactions: Transaction[];
}

async function extractBankStatementData(data: Uint8Array): Promise<{
  transactions: Transaction[];
  pages: PageData[];
  headers: string[];
  columnTypes: { [key: string]: string };
}> {
  try {
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const allPagesData: TextItem[][] = [];

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

function processAllPages(allPagesData: TextItem[][]): {
  transactions: Transaction[];
  pages: PageData[];
  headers: string[];
  columnTypes: { [key: string]: string };
} {
  let globalHeaders: string[] = [];
  let globalColumns: Column[] = [];
  let columnTypes: { [key: string]: string } = {};
  const pages: PageData[] = [];
  const seenTransactions = new Set<string>();

  for (let pageIndex = 0; pageIndex < allPagesData.length; pageIndex++) {
    const pageItems = allPagesData[pageIndex];
    if (pageItems.length === 0) continue;

    const rows = groupItemsIntoRows(pageItems);
    
    if (pageIndex === 0 || globalHeaders.length === 0) {
      const structure = detectHeaderAndColumns(rows);
      
      if (structure.headers.length > 0) {
        globalHeaders = structure.headers;
        globalColumns = structure.columns;
        columnTypes = structure.columnTypes;
      }
    }

    const pageTransactions = extractTransactionsFromPage(
      rows,
      globalColumns,
      globalHeaders
    );

    const uniquePageTransactions: Transaction[] = [];
    for (const transaction of pageTransactions) {
      const key = createTransactionKey(transaction);
      if (!seenTransactions.has(key)) {
        seenTransactions.add(key);
        uniquePageTransactions.push(transaction);
      }
    }

    if (uniquePageTransactions.length > 0) {
      pages.push({
        pageNumber: pageIndex + 1,
        transactions: uniquePageTransactions
      });
    }
  }

  const allTransactions = pages.flatMap(p => p.transactions);

  return {
    transactions: allTransactions,
    pages,
    headers: globalHeaders,
    columnTypes
  };
}

function groupItemsIntoRows(items: TextItem[]): TextItem[][] {
  if (items.length === 0) return [];

  const sortedByY = [...items].sort((a, b) => b.y - a.y);
  
  const rows: TextItem[][] = [];
  let currentRow: TextItem[] = [sortedByY[0]];
  let currentY = sortedByY[0].y;

  for (let i = 1; i < sortedByY.length; i++) {
    const item = sortedByY[i];
    const yDiff = Math.abs(currentY - item.y);
    
    if (yDiff <= 3) {
      currentRow.push(item);
    } else {
      rows.push(currentRow.sort((a, b) => a.x - b.x));
      currentRow = [item];
      currentY = item.y;
    }
  }

  if (currentRow.length > 0) {
    rows.push(currentRow.sort((a, b) => a.x - b.x));
  }

  return rows;
}

function detectHeaderAndColumns(rows: TextItem[][]): {
  headers: string[];
  columns: Column[];
  columnTypes: { [key: string]: string };
} {
  // Find the header row
  let headerRowIndex = -1;
  let maxHeaderScore = 0;

  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i];
    const score = calculateHeaderScore(row);
    
    if (score > maxHeaderScore && score >= 3) {
      maxHeaderScore = score;
      headerRowIndex = i;
    }
  }

  if (headerRowIndex === -1) {
    return detectColumnsFromDataPatterns(rows);
  }

  const headerRow = rows[headerRowIndex];
  const sortedHeaders = [...headerRow].sort((a, b) => a.x - b.x);

  const columns: Column[] = [];
  const headers: string[] = [];
  const columnTypes: { [key: string]: string } = {};

  for (let i = 0; i < sortedHeaders.length; i++) {
    const header = sortedHeaders[i];
    const headerText = cleanHeaderText(header.text);
    
    const startX = i === 0 ? 0 : (sortedHeaders[i - 1].x + sortedHeaders[i - 1].width + header.x) / 2;
    const endX = i === sortedHeaders.length - 1 
      ? Infinity 
      : (header.x + header.width + sortedHeaders[i + 1].x) / 2;

    const columnType = detectColumnType(headerText);

    columns.push({
      header: headerText,
      startX,
      endX,
      index: i,
      type: columnType
    });

    headers.push(headerText);
    columnTypes[headerText] = columnType;
  }

  return { headers, columns, columnTypes };
}

function cleanHeaderText(text: string): string {
  return text
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectColumnType(headerText: string): 'date' | 'amount' | 'text' {
  const lower = headerText.toLowerCase();
  
  if (lower.includes('date') || lower.includes('dt') || lower === 'txn date' || lower === 'value date') {
    return 'date';
  }
  
  if (lower.includes('debit') || lower.includes('credit') || 
      lower.includes('withdrawal') || lower.includes('deposit') ||
      lower.includes('balance') || lower.includes('amount') ||
      lower.includes('dr') || lower.includes('cr') ||
      lower === 'withdrawals' || lower === 'deposits') {
    return 'amount';
  }
  
  return 'text';
}

function calculateHeaderScore(row: TextItem[]): number {
  if (row.length < 2) return 0;

  const headerKeywords = [
    'date', 'description', 'particulars', 'narration', 'details',
    'debit', 'credit', 'withdrawal', 'deposit', 'balance',
    'amount', 'transaction', 'value', 'chq', 'cheque',
    'ref', 'reference', 'no', 'number', 'dr', 'cr', 'txn'
  ];

  let score = 0;
  
  for (const item of row) {
    const lower = item.text.toLowerCase();
    for (const keyword of headerKeywords) {
      if (lower.includes(keyword)) {
        score += 2;
      }
    }
  }

  if (hasDataLikeContent(row)) {
    score -= 10;
  }

  if (row.length >= 3) score += 1;
  if (row.length >= 5) score += 1;

  return Math.max(0, score);
}

function hasDataLikeContent(row: TextItem[]): boolean {
  return row.some(item => 
    isDateValue(item.text) || 
    (isAmountValue(item.text) && parseFloat(item.text.replace(/,/g, '')) > 10)
  );
}

function detectColumnsFromDataPatterns(rows: TextItem[][]): {
  headers: string[];
  columns: Column[];
  columnTypes: { [key: string]: string };
} {
  const dataRows = rows
    .filter(row => row.length >= 2 && !isFooterRow(row))
    .slice(0, 15);

  if (dataRows.length === 0) {
    return { headers: [], columns: [], columnTypes: {} };
  }

  const xPositions: number[][] = [];
  
  for (const row of dataRows) {
    const rowXs = row.map(item => item.x);
    xPositions.push(rowXs);
  }

  const allXs = xPositions.flat().sort((a, b) => a - b);
  const clusters = clusterXPositions(allXs, 15);
  
  const columnCenters = clusters
    .filter(cluster => cluster.length >= dataRows.length * 0.4)
    .map(cluster => cluster.reduce((a, b) => a + b) / cluster.length)
    .sort((a, b) => a - b);

  const headers: string[] = [];
  const columns: Column[] = [];
  const columnTypes: { [key: string]: string } = {};

  for (let i = 0; i < columnCenters.length; i++) {
    const center = columnCenters[i];
    const headerName = `Column ${i + 1}`;
    
    const startX = i === 0 ? 0 : (columnCenters[i - 1] + center) / 2;
    const endX = i === columnCenters.length - 1 ? Infinity : (center + columnCenters[i + 1]) / 2;

    const type = guessColumnTypeFromData(dataRows, startX, endX);

    columns.push({
      header: headerName,
      startX,
      endX,
      index: i,
      type
    });

    headers.push(headerName);
    columnTypes[headerName] = type;
  }

  return { headers, columns, columnTypes };
}

function clusterXPositions(sortedXs: number[], threshold: number): number[][] {
  if (sortedXs.length === 0) return [];

  const clusters: number[][] = [[sortedXs[0]]];
  
  for (let i = 1; i < sortedXs.length; i++) {
    const x = sortedXs[i];
    const lastCluster = clusters[clusters.length - 1];
    const lastX = lastCluster[lastCluster.length - 1];
    
    if (x - lastX <= threshold) {
      lastCluster.push(x);
    } else {
      clusters.push([x]);
    }
  }
  
  return clusters;
}

function guessColumnTypeFromData(dataRows: TextItem[][], startX: number, endX: number): 'date' | 'amount' | 'text' {
  const samples: string[] = [];
  
  for (const row of dataRows.slice(0, 10)) {
    for (const item of row) {
      if (item.x >= startX && item.x < endX) {
        samples.push(item.text);
      }
    }
  }

  let dateCount = 0;
  let amountCount = 0;
  
  for (const sample of samples) {
    if (isDateValue(sample)) dateCount++;
    if (isAmountValue(sample)) amountCount++;
  }

  if (dateCount > samples.length * 0.5) return 'date';
  if (amountCount > samples.length * 0.4) return 'amount';
  return 'text';
}

function extractTransactionsFromPage(
  rows: TextItem[][],
  columns: Column[],
  headers: string[]
): Transaction[] {
  if (columns.length === 0 || headers.length === 0) {
    return [];
  }

  const transactions: Transaction[] = [];
  let i = 0;

  while (i < rows.length) {
    const row = rows[i];
    
    if (isFooterRow(row) || isHeaderLikeRow(row) || row.length === 0) {
      i++;
      continue;
    }

    const transaction = mapRowToTransaction(row, columns, headers);
    
    if (hasMinimumData(transaction)) {
      let j = i + 1;
      let continuationCount = 0;
      const maxContinuations = 3;

      while (j < rows.length && continuationCount < maxContinuations) {
        const nextRow = rows[j];
        
        if (isFooterRow(nextRow) || isHeaderLikeRow(nextRow)) break;
        
        const nextTransaction = mapRowToTransaction(nextRow, columns, headers);
        
        if (isNewTransaction(nextTransaction)) break;
        
        mergeTransactionData(transaction, nextTransaction, headers);
        j++;
        continuationCount++;
      }

      if (isValidTransaction(transaction)) {
        transactions.push(transaction);
      }

      i = j;
    } else {
      i++;
    }
  }

  return transactions;
}

function mapRowToTransaction(row: TextItem[], columns: Column[], headers: string[]): Transaction {
  const transaction: Transaction = {};
  
  for (const header of headers) {
    transaction[header] = '';
  }

  for (const column of columns) {
    const items = row.filter(item => item.x >= column.startX && item.x < column.endX);
    
    if (items.length > 0) {
      const text = items.map(item => item.text).join(' ').trim();
      transaction[column.header] = text;
    }
  }

  return transaction;
}

function hasMinimumData(transaction: Transaction): boolean {
  const nonEmptyValues = Object.values(transaction).filter(v => v && v.trim().length > 0);
  return nonEmptyValues.length >= 2;
}

function isNewTransaction(transaction: Transaction): boolean {
  const values = Object.values(transaction);
  
  const hasDate = values.some(v => isDateValue(v));
  if (hasDate) return true;

  const amounts = values.filter(v => isAmountValue(v));
  if (amounts.length >= 2) return true;

  return false;
}

function mergeTransactionData(target: Transaction, source: Transaction, headers: string[]): void {
  for (const header of headers) {
    const targetVal = target[header] || '';
    const sourceVal = source[header] || '';
    
    if (sourceVal && !isDateValue(sourceVal) && !isAmountValue(sourceVal)) {
      if (targetVal && !targetVal.includes(sourceVal)) {
        target[header] = (targetVal + ' ' + sourceVal).trim();
      } else if (!targetVal) {
        target[header] = sourceVal;
      }
    }
  }
}

function isValidTransaction(transaction: Transaction): boolean {
  const values = Object.values(transaction).filter(v => v && v.trim().length > 0);
  
  if (values.length < 2) return false;

  const allText = values.join(' ').toLowerCase();
  
  const invalidPatterns = [
    /opening\s+balance/i,
    /closing\s+balance/i,
    /total\s+(debit|credit)/i,
    /brought\s+forward/i,
    /carried\s+forward/i,
    /page\s+\d+/i,
    /continued/i
  ];
  
  for (const pattern of invalidPatterns) {
    if (pattern.test(allText)) return false;
  }

  const hasDate = values.some(v => isDateValue(v));
  const hasAmount = values.some(v => isAmountValue(v));
  
  return hasDate || hasAmount;
}

function isHeaderLikeRow(row: TextItem[]): boolean {
  if (row.length < 2) return false;

  const headerKeywords = [
    'date', 'description', 'particulars', 'debit', 'credit',
    'withdrawal', 'deposit', 'balance', 'amount', 'transaction', 'narration'
  ];

  const rowText = row.map(item => item.text).join(' ').toLowerCase();
  const matches = headerKeywords.filter(keyword => rowText.includes(keyword)).length;

  return matches >= 2;
}

function isFooterRow(row: TextItem[]): boolean {
  const footerKeywords = [
    'end of statement', 'closing balance', 'page', 'continued',
    'thank you', 'regards', 'total', 'summary', 'opening balance',
    'brought forward', 'carried forward'
  ];

  const rowText = row.map(item => item.text).join(' ').toLowerCase();
  return footerKeywords.some(keyword => rowText.includes(keyword));
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
    /^-?\d{1,}\.?\d{0,2}$/,
    /^\d{1,}\.\d{2}$/,
  ];

  if (!amountPatterns.some(pattern => pattern.test(cleaned))) return false;
  
  const num = parseFloat(cleaned);
  return !isNaN(num) && Math.abs(num) >= 0.01 && !isDateValue(text);
}

function createTransactionKey(transaction: Transaction): string {
  return JSON.stringify(transaction).toLowerCase();
}
