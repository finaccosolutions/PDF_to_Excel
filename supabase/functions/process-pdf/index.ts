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
        JSON.stringify({ error: "No file provided", success: false, data: [], pages: [], headers: [], columnTypes: {} }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    const allPagesData = await extractAllPages(uint8Array);
    const { transactions, headers, pages, columnTypes } = parseAllPages(allPagesData);

    return new Response(
      JSON.stringify({
        success: transactions.length > 0,
        data: transactions,
        pages: pages,
        headers: headers,
        columnTypes: columnTypes,
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
        pages: [],
        headers: [],
        columnTypes: {}
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

interface TextItem {
  text: string;
  y: number;
  x: number;
}

interface Row {
  y: number;
  items: TextItem[];
}

interface PageData {
  pageNumber: number;
  transactions: Array<{ [key: string]: string }>;
}

async function extractAllPages(data: Uint8Array): Promise<TextItem[][]> {
  try {
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const allPages: TextItem[][] = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      const pageItems: TextItem[] = textContent.items
        .filter((item: any) => item.str && item.str.trim())
        .map((item: any) => ({
          text: item.str.trim(),
          y: item.transform[5],
          x: item.transform[4],
        }));

      allPages.push(pageItems);
    }

    return allPages;
  } catch (error) {
    console.error('PDF extraction error:', error);
    throw new Error('Failed to extract text from PDF');
  }
}

function groupIntoRows(items: TextItem[]): Row[] {
  const sortedByY = [...items].sort((a, b) => b.y - a.y);
  const yPositions = [...new Set(sortedByY.map(item => Math.round(item.y * 10) / 10))];

  const rowMap = new Map<number, TextItem[]>();

  items.forEach(item => {
    const roundedY = Math.round(item.y * 10) / 10;
    const closestY = yPositions.find(y => Math.abs(y - roundedY) < 0.5);

    if (closestY !== undefined) {
      if (!rowMap.has(closestY)) {
        rowMap.set(closestY, []);
      }
      rowMap.get(closestY)!.push(item);
    }
  });

  return Array.from(rowMap.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([y, items]) => ({
      y,
      items: items.sort((a, b) => a.x - b.x),
    }));
}

function isHeaderKeyword(text: string): boolean {
  const lower = text.toLowerCase().trim();
  const keywords = [
    'date', 'dt', 'posting date', 'value date', 'txn date',
    'description', 'narration', 'particulars', 'details', 'remarks', 'transaction details',
    'debit', 'credit', 'amount', 'withdrawal', 'deposit',
    'balance', 'reference', 'ref', 'cheque', 'chq', 'memo',
    'dr', 'cr'
  ];

  return keywords.some(kw => lower === kw || lower.includes(kw));
}

function findHeaders(rows: Row[]): { headerRowIndex: number; headers: string[] } | null {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const row = rows[i];

    if (row.items.length < 2) continue;

    const rowTexts = row.items.map(item => item.text);
    const matchCount = rowTexts.filter(text => isHeaderKeyword(text)).length;

    const hasActualDates = rowTexts.some(text => isDateValue(text));

    if (matchCount >= 2 && !hasActualDates) {
      return {
        headerRowIndex: i,
        headers: rowTexts,
      };
    }
  }

  return null;
}

function isDateValue(text: string): boolean {
  if (!text || text.trim().length === 0) return false;

  const datePatterns = [
    /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/,
    /^\d{1,2}\s+[A-Za-z]{3}\s+\d{4}$/,
    /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/,
    /^\d{1,2}\s+[A-Za-z]+\s+\d{4}$/,
    /^\d{1,2}-[A-Za-z]{3}-\d{2,4}$/,
  ];

  return datePatterns.some(pattern => pattern.test(text.trim()));
}

function isAmountValue(text: string): boolean {
  if (!text || text.trim().length === 0) return false;
  if (isDateValue(text)) return false;

  const cleaned = text.trim().replace(/,/g, '');
  return /^-?\d+\.?\d*$/.test(cleaned) && cleaned.length > 0;
}

function assignDataToColumns(
  row: Row,
  headerRow: Row,
  headers: string[]
): { [key: string]: string } {
  const result: { [key: string]: string } = {};

  headers.forEach(h => {
    result[h] = '';
  });

  if (headerRow.items.length === 0) return result;

  for (const item of row.items) {
    let closestHeaderIdx = -1;
    let minDistance = Infinity;

    for (let i = 0; i < headerRow.items.length; i++) {
      const headerItem = headerRow.items[i];
      const distance = Math.abs(item.x - headerItem.x);

      if (distance < minDistance) {
        minDistance = distance;
        closestHeaderIdx = i;
      }
    }

    if (closestHeaderIdx !== -1 && closestHeaderIdx < headers.length) {
      const header = headers[closestHeaderIdx];
      if (result[header]) {
        result[header] += ' ' + item.text;
      } else {
        result[header] = item.text;
      }
    }
  }

  return result;
}

function detectColumnType(header: string): 'date' | 'amount' | 'text' {
  const lower = header.toLowerCase().trim();

  if (lower.includes('date') || lower === 'dt' || lower === 'posting date' || lower === 'value date') {
    return 'date';
  }

  if (lower.includes('debit') || lower.includes('credit') ||
      lower.includes('withdrawal') || lower.includes('deposit') ||
      lower.includes('amount') || lower.includes('balance') ||
      lower === 'dr' || lower === 'cr') {
    return 'amount';
  }

  return 'text';
}

function isValidTransaction(transaction: { [key: string]: string }, headers: string[]): boolean {
  const filledFields = Object.values(transaction).filter(v => v && v.trim().length > 0).length;

  if (filledFields < 2) return false;

  const dateHeader = headers.find(h => {
    const lower = h.toLowerCase().trim();
    return lower.includes('date') || lower === 'dt';
  });

  const hasValidDate = dateHeader && transaction[dateHeader] && isDateValue(transaction[dateHeader]);

  const amountHeaders = headers.filter(h => {
    const lower = h.toLowerCase().trim();
    return lower.includes('debit') || lower.includes('credit') ||
           lower.includes('withdrawal') || lower.includes('deposit') ||
           lower.includes('amount') || lower.includes('balance');
  });

  const hasValidAmount = amountHeaders.some(h => transaction[h] && isAmountValue(transaction[h]));

  return hasValidDate || hasValidAmount;
}

function parseAllPages(allPagesData: TextItem[][]): { transactions: Array<{ [key: string]: string }>; headers: string[]; pages: PageData[]; columnTypes: { [key: string]: string } } {
  let globalHeaders: string[] = [];
  let globalColumnTypes: { [key: string]: string } = {};
  let allTransactions: Array<{ [key: string]: string }> = [];
  let pages: PageData[] = [];
  const deduplicationSet = new Set<string>();

  for (let pageIndex = 0; pageIndex < allPagesData.length; pageIndex++) {
    const pageItems = allPagesData[pageIndex];

    if (pageItems.length === 0) continue;

    const rows = groupIntoRows(pageItems);

    if (globalHeaders.length === 0) {
      const headerInfo = findHeaders(rows);
      if (!headerInfo) continue;

      globalHeaders = headerInfo.headers;
      globalColumnTypes = {};
      globalHeaders.forEach(h => {
        globalColumnTypes[h] = detectColumnType(h);
      });
    }

    const headerRowInfo = findHeaders(rows);
    if (!headerRowInfo) continue;

    const headerRowIndex = headerRowInfo.headerRowIndex;
    const headerRow = rows[headerRowIndex];
    const pageTransactions: Array<{ [key: string]: string }> = [];

    let currentTransaction: { [key: string]: string } | null = null;
    const narrationHeaderIdx = globalHeaders.findIndex(h => {
      const lower = h.toLowerCase().trim();
      return lower.includes('narration') || lower.includes('particulars') ||
             lower.includes('description') || lower.includes('details') ||
             lower.includes('remarks') || lower.includes('transaction');
    });

    for (let rowIdx = headerRowIndex + 1; rowIdx < rows.length; rowIdx++) {
      const row = rows[rowIdx];

      if (row.items.length === 0) continue;

      const joinedText = row.items.map(item => item.text).join(' ').toLowerCase();
      const isFooter = [
        'end of statement', 'closing balance', 'opening balance',
        'total debit', 'total credit', 'page', 'continued',
        'thank you', 'regards', 'signature', 'generated',
        'terms and conditions', 'account summary', 'account number'
      ].some(keyword => joinedText.includes(keyword));

      if (isFooter) {
        if (currentTransaction && isValidTransaction(currentTransaction, globalHeaders)) {
          const key = JSON.stringify(currentTransaction);
          if (!deduplicationSet.has(key)) {
            deduplicationSet.add(key);
            allTransactions.push(currentTransaction);
            pageTransactions.push(currentTransaction);
          }
        }
        break;
      }

      const rowData = assignDataToColumns(row, headerRow, globalHeaders);

      const hasDate = globalHeaders.some(h => {
        return globalColumnTypes[h] === 'date' && rowData[h] && isDateValue(rowData[h]);
      });

      const hasAmount = globalHeaders.some(h => {
        return globalColumnTypes[h] === 'amount' && rowData[h] && isAmountValue(rowData[h]);
      });

      if (hasDate || hasAmount) {
        if (currentTransaction && isValidTransaction(currentTransaction, globalHeaders)) {
          const key = JSON.stringify(currentTransaction);
          if (!deduplicationSet.has(key)) {
            deduplicationSet.add(key);
            allTransactions.push(currentTransaction);
            pageTransactions.push(currentTransaction);
          }
        }

        currentTransaction = rowData;
      } else if (currentTransaction && narrationHeaderIdx !== -1) {
        const narrationHeader = globalHeaders[narrationHeaderIdx];
        const nonEmptyTexts = row.items
          .map(item => item.text)
          .filter(text => text && !isDateValue(text) && !isAmountValue(text))
          .join(' ');

        if (nonEmptyTexts) {
          if (currentTransaction[narrationHeader]) {
            currentTransaction[narrationHeader] += ' ' + nonEmptyTexts;
          } else {
            currentTransaction[narrationHeader] = nonEmptyTexts;
          }
        }
      }
    }

    if (currentTransaction && isValidTransaction(currentTransaction, globalHeaders)) {
      const key = JSON.stringify(currentTransaction);
      if (!deduplicationSet.has(key)) {
        deduplicationSet.add(key);
        allTransactions.push(currentTransaction);
        pageTransactions.push(currentTransaction);
      }
    }

    if (pageTransactions.length > 0) {
      pages.push({
        pageNumber: pageIndex + 1,
        transactions: pageTransactions,
      });
    }
  }

  return {
    transactions: allTransactions,
    headers: globalHeaders,
    pages: pages,
    columnTypes: globalColumnTypes,
  };
}
