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
        JSON.stringify({ error: "No file provided", success: false, data: [], headers: [] }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    const allPagesData = await extractAllPages(uint8Array);
    const { transactions, headers } = parseAllPages(allPagesData);

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
}

interface ColumnRange {
  header: string;
  minX: number;
  maxX: number;
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

interface ParseResult {
  transactions: Array<{ [key: string]: string }>;
  headers: string[];
}

function parseAllPages(allPagesData: TextItem[][]): ParseResult {
  let allTransactions: Array<{ [key: string]: string }> = [];
  let globalHeaders: string[] = [];
  let columnRanges: ColumnRange[] = [];

  for (let pageIndex = 0; pageIndex < allPagesData.length; pageIndex++) {
    const pageItems = allPagesData[pageIndex];

    if (pageItems.length === 0) continue;

    const rows = groupItemsIntoRows(pageItems);

    let headerRowIndex = -1;
    let headerRow: TextItem[] = [];

    for (let i = 0; i < rows.length && i < 30; i++) {
      if (isHeaderRow(rows[i])) {
        headerRowIndex = i;
        headerRow = rows[i];
        break;
      }
    }

    if (headerRowIndex >= 0 && globalHeaders.length === 0) {
      globalHeaders = headerRow.map(item => item.text);
      columnRanges = calculateColumnRanges(headerRow);
    }

    if (pageIndex === 0 && headerRowIndex >= 0) {
      const dataStartIndex = headerRowIndex + 1;

      for (let i = dataStartIndex; i < rows.length; i++) {
        const row = rows[i];

        if (isFooterRow(row)) break;
        if (!isTransactionRow(row)) continue;

        const transaction = mapRowToColumns(row, columnRanges, globalHeaders);

        if (hasValidTransactionData(transaction)) {
          allTransactions.push(transaction);
        }
      }
    } else if (pageIndex > 0 && columnRanges.length > 0) {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        if (isHeaderRow(row) || isFooterRow(row)) continue;
        if (!isTransactionRow(row)) continue;

        const transaction = mapRowToColumns(row, columnRanges, globalHeaders);

        if (hasValidTransactionData(transaction)) {
          allTransactions.push(transaction);
        }
      }
    }
  }

  const normalizedHeaders = globalHeaders.length > 0
    ? normalizeHeaders(globalHeaders)
    : ['Date', 'Description', 'Withdrawal', 'Deposit', 'Balance'];

  return {
    transactions: allTransactions,
    headers: normalizedHeaders,
  };
}

function groupItemsIntoRows(items: TextItem[]): TextItem[][] {
  const rowMap = new Map<number, TextItem[]>();
  const tolerance = 3;

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

function calculateColumnRanges(headerRow: TextItem[]): ColumnRange[] {
  const ranges: ColumnRange[] = [];

  for (let i = 0; i < headerRow.length; i++) {
    const current = headerRow[i];
    const next = headerRow[i + 1];

    const minX = i === 0 ? 0 : current.x;
    const maxX = next ? next.x : Infinity;

    ranges.push({
      header: current.text,
      minX: minX,
      maxX: maxX,
    });
  }

  return ranges;
}

function mapRowToColumns(
  row: TextItem[],
  columnRanges: ColumnRange[],
  headers: string[]
): { [key: string]: string } {
  const transaction: { [key: string]: string } = {};

  headers.forEach((header, index) => {
    transaction[header] = '';
  });

  const columnAssignments = new Map<number, string[]>();

  row.forEach(item => {
    for (let i = 0; i < columnRanges.length; i++) {
      const range = columnRanges[i];

      if (item.x >= range.minX && item.x < range.maxX) {
        if (!columnAssignments.has(i)) {
          columnAssignments.set(i, []);
        }
        columnAssignments.get(i)!.push(item.text);
        break;
      }
    }
  });

  columnAssignments.forEach((texts, columnIndex) => {
    const header = headers[columnIndex];
    if (header) {
      const combinedText = texts.join('');
      transaction[header] = combinedText;
    }
  });

  return transaction;
}

function isHeaderRow(row: TextItem[]): boolean {
  if (row.length < 2) return false;

  const headerKeywords = [
    'date', 'description', 'particulars', 'debit', 'credit',
    'withdrawal', 'deposit', 'balance', 'amount', 'transaction',
    'reference', 'memo', 'cheque', 'narration', 'details'
  ];

  const texts = row.map(item => item.text.toLowerCase());
  const matchCount = texts.filter(text =>
    headerKeywords.some(keyword => text.includes(keyword))
  ).length;

  const hasNoDate = !texts.some(text =>
    /^\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}/.test(text)
  );

  return matchCount >= 2 && hasNoDate;
}

function isFooterRow(row: TextItem[]): boolean {
  const footerKeywords = [
    'end of statement', 'closing balance', 'total', 'page',
    'thank you', 'regards', 'signature', 'generated',
    'terms and conditions', 'continued', 'statement from',
    'statement period', 'account summary', 'opening balance'
  ];

  const joinedText = row.map(item => item.text).join(' ').toLowerCase();
  return footerKeywords.some(keyword => joinedText.includes(keyword));
}

function isTransactionRow(row: TextItem[]): boolean {
  if (row.length < 2) return false;

  const joinedText = row.map(item => item.text).join(' ');

  const hasDate = /\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}|\d{1,2}\s+\w{3}\s+\d{4}/.test(joinedText);
  const hasAmount = /\d+[,.]?\d*(?:[.,]\d{2})?(?:\s|$)/.test(joinedText);

  const nonTransactionPatterns = [
    /statement\s+(from|period|to)/i,
    /opening\s+balance/i,
    /closing\s+balance/i,
    /account\s+(summary|number|name)/i,
    /customer\s+(id|name)/i,
    /branch\s+(code|name)/i,
    /ifsc\s+code/i,
  ];

  const isNonTransaction = nonTransactionPatterns.some(pattern => pattern.test(joinedText));

  return hasDate && hasAmount && !isNonTransaction;
}

function hasValidTransactionData(transaction: { [key: string]: string }): boolean {
  const values = Object.values(transaction);
  const nonEmptyCount = values.filter(v => v && v.length > 0).length;

  if (nonEmptyCount < 2) return false;

  const transactionText = Object.values(transaction).join(' ').toLowerCase();

  const invalidPatterns = [
    /statement\s+(from|period|to)/,
    /opening\s+balance/,
    /account\s+(summary|number)/,
    /customer\s+(id|name)/,
    /branch\s+(code|name)/,
    /ifsc\s+code/,
  ];

  return !invalidPatterns.some(pattern => pattern.test(transactionText));
}

function normalizeHeaders(headers: string[]): string[] {
  const headerMap: { [key: string]: string } = {
    'date': 'Date',
    'description': 'Description',
    'particulars': 'Particulars',
    'narration': 'Narration',
    'details': 'Details',
    'debit': 'Withdrawal',
    'withdrawal': 'Withdrawal',
    'credit': 'Deposit',
    'deposit': 'Deposit',
    'balance': 'Balance',
    'amount': 'Amount',
    'memo': 'Memo',
    'reference': 'Reference',
    'ref': 'Reference',
    'cheque': 'Cheque',
    'chq': 'Cheque',
  };

  const result: string[] = [];
  const seen = new Set<string>();

  headers.forEach(header => {
    const lower = header.toLowerCase();
    const normalized = headerMap[lower] || header;

    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  });

  return result.length > 0 ? result : ['Date', 'Description', 'Withdrawal', 'Deposit', 'Balance'];
}
