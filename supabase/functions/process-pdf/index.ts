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
        JSON.stringify({ error: "No file provided", success: false, data: [], pages: [], headers: [] }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    const allPagesData = await extractAllPages(uint8Array);
    const { transactions, headers, pages } = parseAllPages(allPagesData);

    return new Response(
      JSON.stringify({
        success: transactions.length > 0,
        data: transactions,
        pages: pages,
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
        pages: [],
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
  width?: number;
}

interface ColumnRange {
  header: string;
  minX: number;
  maxX: number;
  centerX: number;
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
          width: item.width || 0,
        }));

      allPages.push(pageItems);
    }

    return allPages;
  } catch (error) {
    console.error('PDF extraction error:', error);
    throw new Error('Failed to extract text from PDF');
  }
}

interface ParseResult {
  transactions: Array<{ [key: string]: string }>;
  headers: string[];
  pages: PageData[];
}

function parseAllPages(allPagesData: TextItem[][]): ParseResult {
  let allTransactions: Array<{ [key: string]: string }> = [];
  let pages: PageData[] = [];
  let headers: string[] = [];
  let columnRanges: ColumnRange[] = [];

  for (let pageIndex = 0; pageIndex < allPagesData.length; pageIndex++) {
    const pageItems = allPagesData[pageIndex];

    if (pageItems.length === 0) continue;

    const rows = groupItemsIntoRows(pageItems);

    let headerRowIndex = -1;
    let headerRow: TextItem[] = [];

    for (let i = 0; i < Math.min(rows.length, 40); i++) {
      if (isHeaderRow(rows[i])) {
        headerRowIndex = i;
        headerRow = rows[i];
        break;
      }
    }

    if (headerRowIndex >= 0 && headers.length === 0) {
      headers = headerRow.map(item => item.text);
      columnRanges = calculateColumnRanges(headerRow, headers, rows, headerRowIndex);
    }

    const pageTransactions: Array<{ [key: string]: string }> = [];

    if (pageIndex === 0 && headerRowIndex >= 0 && columnRanges.length > 0) {
      const dataStartIndex = headerRowIndex + 1;
      const groupedTransactions = groupMultiLineTransactions(
        rows.slice(dataStartIndex),
        columnRanges,
        headers
      );

      for (const transaction of groupedTransactions) {
        if (isFooterTransaction(transaction)) break;
        if (hasValidTransactionData(transaction, headers)) {
          allTransactions.push(transaction);
          pageTransactions.push(transaction);
        }
      }
    } else if (pageIndex > 0 && columnRanges.length > 0) {
      const groupedTransactions = groupMultiLineTransactions(rows, columnRanges, headers);

      for (const transaction of groupedTransactions) {
        if (isHeaderTransaction(transaction) || isFooterTransaction(transaction)) continue;
        if (hasValidTransactionData(transaction, headers)) {
          allTransactions.push(transaction);
          pageTransactions.push(transaction);
        }
      }
    }

    if (pageTransactions.length > 0) {
      pages.push({
        pageNumber: pageIndex + 1,
        transactions: pageTransactions
      });
    }
  }

  return {
    transactions: allTransactions,
    headers: headers,
    pages: pages,
  };
}

function groupItemsIntoRows(items: TextItem[]): TextItem[][] {
  if (items.length === 0) return [];

  const sortedByY = [...items].sort((a, b) => b.y - a.y);

  const yGaps: number[] = [];
  for (let i = 0; i < sortedByY.length - 1; i++) {
    const gap = Math.abs(sortedByY[i].y - sortedByY[i + 1].y);
    if (gap > 0.5) {
      yGaps.push(gap);
    }
  }

  yGaps.sort((a, b) => a - b);
  const medianGap = yGaps.length > 0 ? yGaps[Math.floor(yGaps.length / 2)] : 5;
  const tolerance = Math.max(3, Math.min(medianGap * 0.7, 8));

  const rowMap = new Map<number, TextItem[]>();

  items.forEach(item => {
    const rowKey = Math.round(item.y / tolerance) * tolerance;
    if (!rowMap.has(rowKey)) {
      rowMap.set(rowKey, []);
    }
    rowMap.get(rowKey)!.push(item);
  });

  const sortedRows = Array.from(rowMap.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([_, rowItems]) => {
      return rowItems.sort((a, b) => a.x - b.x);
    });

  return sortedRows;
}

function calculateColumnRanges(
  headerRow: TextItem[],
  headers: string[],
  allRows: TextItem[][],
  headerRowIndex: number
): ColumnRange[] {
  const sortedHeaders = [...headerRow].sort((a, b) => a.x - b.x);

  const sampleRows = allRows.slice(headerRowIndex + 1, Math.min(headerRowIndex + 20, allRows.length));

  const allXPositions: number[] = [];
  sampleRows.forEach(row => {
    row.forEach(item => {
      allXPositions.push(item.x);
    });
  });
  allXPositions.sort((a, b) => a - b);

  const xGaps: Array<{ position: number; gap: number }> = [];
  for (let i = 0; i < allXPositions.length - 1; i++) {
    const gap = allXPositions[i + 1] - allXPositions[i];
    if (gap > 20) {
      xGaps.push({ position: (allXPositions[i] + allXPositions[i + 1]) / 2, gap });
    }
  }

  const ranges: ColumnRange[] = [];

  for (let i = 0; i < sortedHeaders.length; i++) {
    const current = sortedHeaders[i];
    const next = sortedHeaders[i + 1];

    let minX = current.x - 10;
    let maxX: number;

    if (next) {
      const midpoint = (current.x + next.x) / 2;

      const relevantGaps = xGaps.filter(g =>
        g.position > current.x && g.position < next.x && g.gap > 30
      );

      if (relevantGaps.length > 0) {
        maxX = relevantGaps[0].position;
      } else {
        maxX = midpoint;
      }
    } else {
      maxX = Infinity;
    }

    ranges.push({
      header: current.text,
      minX: minX,
      maxX: maxX,
      centerX: current.x,
    });
  }

  return ranges;
}

function groupMultiLineTransactions(
  rows: TextItem[][],
  columnRanges: ColumnRange[],
  headers: string[]
): Array<{ [key: string]: string }> {
  const transactions: Array<{ [key: string]: string }> = [];
  let i = 0;

  const dateHeader = headers.find(h =>
    h.toLowerCase().includes('date') ||
    h.toLowerCase() === 'dt' ||
    h.toLowerCase() === 'txn date'
  ) || headers[0];

  while (i < rows.length) {
    const row = rows[i];

    if (isFooterRow(row) || row.length === 0) {
      i++;
      continue;
    }

    const transaction = mapRowToColumns(row, columnRanges, headers);

    const hasDate = transaction[dateHeader] && isValidDate(transaction[dateHeader]);
    const hasAmount = headers.some(h => {
      const lower = h.toLowerCase();
      return (lower.includes('withdrawal') || lower.includes('deposit') ||
              lower.includes('debit') || lower.includes('credit') ||
              lower.includes('balance') || lower.includes('amount')) &&
             transaction[h] && transaction[h].trim().length > 0;
    });

    if (!hasDate && !hasAmount) {
      i++;
      continue;
    }

    let j = i + 1;
    let continuationCount = 0;
    const maxContinuations = 15;

    while (j < rows.length && continuationCount < maxContinuations) {
      const nextRow = rows[j];

      if (isFooterRow(nextRow) || isHeaderRow(nextRow)) {
        break;
      }

      const nextTransaction = mapRowToColumns(nextRow, columnRanges, headers);
      const nextHasDate = nextTransaction[dateHeader] && isValidDate(nextTransaction[dateHeader]);

      const nextHasAmount = headers.some(h => {
        const lower = h.toLowerCase();
        return (lower.includes('withdrawal') || lower.includes('deposit') ||
                lower.includes('debit') || lower.includes('credit') ||
                lower.includes('balance')) &&
               nextTransaction[h] && /\d/.test(nextTransaction[h]);
      });

      if (nextHasDate && nextHasAmount) {
        break;
      }

      if (nextHasDate) {
        const nextRowHasOtherData = headers.some(h =>
          h !== dateHeader && nextTransaction[h] && nextTransaction[h].trim().length > 0
        );
        if (nextRowHasOtherData) {
          break;
        }
      }

      const continuationData = mapRowToColumns(nextRow, columnRanges, headers);

      headers.forEach(header => {
        if (continuationData[header] && continuationData[header].trim().length > 0) {
          const isContinuation = !isValidDate(continuationData[header]) || header !== dateHeader;

          if (isContinuation) {
            if (transaction[header] && transaction[header].trim().length > 0) {
              transaction[header] = transaction[header].trim() + ' ' + continuationData[header].trim();
            } else {
              transaction[header] = continuationData[header].trim();
            }
          }
        }
      });

      j++;
      continuationCount++;
    }

    if (hasDate || hasAmount) {
      transactions.push(transaction);
    }

    i = j;
  }

  return transactions;
}

function mapRowToColumns(
  row: TextItem[],
  columnRanges: ColumnRange[],
  headers: string[]
): { [key: string]: string } {
  const transaction: { [key: string]: string } = {};

  headers.forEach((header) => {
    transaction[header] = '';
  });

  row.forEach(item => {
    let bestMatch = -1;
    let bestScore = -1;

    for (let i = 0; i < columnRanges.length; i++) {
      const range = columnRanges[i];

      if (item.x >= range.minX && item.x < range.maxX) {
        const distanceFromCenter = Math.abs(item.x - range.centerX);
        const score = 1000 - distanceFromCenter;

        if (score > bestScore) {
          bestScore = score;
          bestMatch = i;
        }
      }
    }

    if (bestMatch >= 0) {
      const header = columnRanges[bestMatch].header;
      if (transaction[header]) {
        transaction[header] += ' ' + item.text;
      } else {
        transaction[header] = item.text;
      }
    }
  });

  headers.forEach(header => {
    if (transaction[header]) {
      transaction[header] = transaction[header].trim();
    }
  });

  return transaction;
}

function isValidDate(text: string): boolean {
  if (!text || text.trim().length === 0) return false;

  const datePatterns = [
    /^\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}/,
    /^\d{1,2}\s+\w{3}\s+\d{4}/,
    /^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/,
    /^\d{1,2}\s+[A-Za-z]+\s+\d{4}/,
  ];

  return datePatterns.some(pattern => pattern.test(text.trim()));
}

function isHeaderRow(row: TextItem[]): boolean {
  if (row.length < 2) return false;

  const headerKeywords = [
    'date', 'description', 'particulars', 'debit', 'credit',
    'withdrawal', 'deposit', 'balance', 'amount', 'transaction',
    'reference', 'memo', 'cheque', 'narration', 'details', 'value',
    'txn', 'chq', 'ref', 'dr', 'cr'
  ];

  const texts = row.map(item => item.text.toLowerCase());
  const matchCount = texts.filter(text =>
    headerKeywords.some(keyword => text.includes(keyword))
  ).length;

  const hasNoTransactionDate = !texts.some(text => isValidDate(text));

  return matchCount >= 2 && hasNoTransactionDate;
}

function isFooterRow(row: TextItem[]): boolean {
  const footerKeywords = [
    'end of statement', 'closing balance', 'page', 'continued',
    'thank you', 'regards', 'signature', 'generated', 'statement from',
    'terms and conditions', 'statement period', 'account summary',
    'opening balance', 'total debit', 'total credit', 'account number',
    'ifsc', 'branch', 'customer', 'address'
  ];

  const joinedText = row.map(item => item.text).join(' ').toLowerCase();
  return footerKeywords.some(keyword => joinedText.includes(keyword));
}

function hasValidTransactionData(
  transaction: { [key: string]: string },
  headers: string[]
): boolean {
  const values = Object.values(transaction);
  const nonEmptyCount = values.filter(v => v && v.trim().length > 0).length;

  if (nonEmptyCount < 1) return false;

  const dateHeader = headers.find(h =>
    h.toLowerCase().includes('date') ||
    h.toLowerCase() === 'dt'
  );

  const hasDate = dateHeader && transaction[dateHeader] && isValidDate(transaction[dateHeader]);

  const hasAmount = headers.some(h => {
    const lower = h.toLowerCase();
    return (lower.includes('withdrawal') || lower.includes('deposit') ||
            lower.includes('debit') || lower.includes('credit') ||
            lower.includes('balance') || lower.includes('amount')) &&
           transaction[h] && transaction[h].trim().length > 0;
  });

  if (!hasDate && !hasAmount) return false;

  const transactionText = Object.values(transaction).join(' ').toLowerCase();

  const invalidPatterns = [
    /statement\s+(from|period|to|date)/,
    /account\s+(summary|number)/,
    /customer\s+(id|name)/,
    /branch\s+(code|name)/,
    /ifsc\s+code/,
    /opening\s+balance/,
    /closing\s+balance/,
  ];

  if (invalidPatterns.some(pattern => pattern.test(transactionText))) {
    return false;
  }

  return true;
}

function isHeaderTransaction(transaction: { [key: string]: string }): boolean {
  const transactionText = Object.values(transaction).join(' ').toLowerCase();
  const headerKeywords = [
    'date', 'description', 'particulars', 'debit', 'credit',
    'withdrawal', 'deposit', 'balance'
  ];

  const matchCount = headerKeywords.filter(keyword => transactionText.includes(keyword)).length;
  return matchCount >= 3;
}

function isFooterTransaction(transaction: { [key: string]: string }): boolean {
  const transactionText = Object.values(transaction).join(' ').toLowerCase();
  const footerKeywords = [
    'end of statement', 'closing balance', 'total', 'page',
    'thank you', 'regards', 'signature', 'generated',
    'terms and conditions', 'continued', 'opening balance'
  ];

  return footerKeywords.some(keyword => transactionText.includes(keyword));
}
