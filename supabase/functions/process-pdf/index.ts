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

    const pdfData = await extractAllPages(uint8Array);
    const { transactions, headers } = parseTransactions(pdfData);

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

async function extractAllPages(data: Uint8Array): Promise<TextItem[][]> {
  try {
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const allItems: TextItem[][] = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      const pageItems: TextItem[] = textContent.items
        .filter((item: any) => item.str && item.str.trim())
        .map((item: any) => ({
          text: item.str,
          y: item.transform[5],
          x: item.transform[4],
        }));

      allItems.push(pageItems);
    }

    return allItems;
  } catch (error) {
    console.error('PDF extraction error:', error);
    throw new Error('Failed to extract text from PDF');
  }
}

interface ParseResult {
  transactions: Array<{ [key: string]: string }>;
  headers: string[];
}

function parseTransactions(pageItems: TextItem[][]): ParseResult {
  const allRows = buildRowsFromPages(pageItems);

  if (allRows.length === 0) {
    return { transactions: [], headers: [] };
  }

  let headerRow: string[] = [];
  let dataStartIndex = 0;

  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i];
    if (isHeaderRow(row)) {
      headerRow = row;
      dataStartIndex = i + 1;
      break;
    }
  }

  if (headerRow.length === 0) {
    headerRow = ['Date', 'Description', 'Withdrawal', 'Deposit', 'Balance'];
  }

  const transactions: Array<{ [key: string]: string }> = [];

  for (let i = dataStartIndex; i < allRows.length; i++) {
    const row = allRows[i];

    if (isFooterRow(row)) break;

    if (isTransactionRow(row, headerRow)) {
      const transaction = mapRowToTransaction(row, headerRow);
      if (hasTransactionData(transaction)) {
        transactions.push(transaction);
      }
    }
  }

  return {
    transactions,
    headers: normalizeHeaders(headerRow),
  };
}

function buildRowsFromPages(pageItems: TextItem[][]): string[][] {
  const rows: string[][] = [];

  for (const pageItems_ of pageItems) {
    const pageRows = buildRowsFromItems(pageItems_);
    rows.push(...pageRows);
  }

  return rows;
}

function buildRowsFromItems(items: TextItem[]): string[][] {
  const rowMap = new Map<number, TextItem[]>();

  items.forEach(item => {
    const rowKey = Math.round(item.y / 2) * 2;
    if (!rowMap.has(rowKey)) {
      rowMap.set(rowKey, []);
    }
    rowMap.get(rowKey)!.push(item);
  });

  const sortedRows = Array.from(rowMap.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([_, items_]) => {
      return items_
        .sort((a, b) => a.x - b.x)
        .map(item => item.text);
    });

  return sortedRows;
}

function isHeaderRow(row: string[]): boolean {
  if (row.length < 2) return false;

  const headerKeywords = [
    'date', 'description', 'particulars', 'debit', 'credit',
    'withdrawal', 'deposit', 'balance', 'amount', 'transaction',
    'reference', 'memo', 'cheque'
  ];

  const lowerRow = row.map(cell => cell.toLowerCase());
  const matchCount = lowerRow.filter(cell =>
    headerKeywords.some(keyword => cell.includes(keyword))
  ).length;

  const hasNoDate = !lowerRow.some(cell =>
    /^\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}/.test(cell)
  );

  return matchCount >= 2 && hasNoDate;
}

function isFooterRow(row: string[]): boolean {
  const footerKeywords = [
    'end of statement', 'closing balance', 'total', 'page',
    'thank you', 'regards', 'signature', 'generated',
    'terms and conditions'
  ];

  const joinedRow = row.join(' ').toLowerCase();
  return footerKeywords.some(keyword => joinedRow.includes(keyword));
}

function isTransactionRow(row: string[], headers: string[]): boolean {
  if (row.length < 2) return false;

  const joinedRow = row.join(' ');

  const hasDate = /\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}|\d{1,2}\s+\w{3}\s+\d{4}/.test(joinedRow);
  const hasAmount = /\d+(?:[.,]\d{2})?(?:\s|$)/.test(joinedRow);

  return hasDate && hasAmount;
}

function mapRowToTransaction(row: string[], headers: string[]): { [key: string]: string } {
  const transaction: { [key: string]: string } = {};

  headers.forEach((header, index) => {
    transaction[header] = row[index]?.trim() || '';
  });

  return transaction;
}

function hasTransactionData(transaction: { [key: string]: string }): boolean {
  return Object.values(transaction).some(value => value && value.length > 0);
}

function normalizeHeaders(headers: string[]): string[] {
  const normalized: { [key: string]: boolean } = {};
  const result: string[] = [];

  const headerMap: { [key: string]: string } = {
    'date': 'Date',
    'description': 'Description',
    'particulars': 'Particulars',
    'debit': 'Withdrawal',
    'withdrawal': 'Withdrawal',
    'credit': 'Deposit',
    'deposit': 'Deposit',
    'balance': 'Balance',
    'amount': 'Amount',
    'memo': 'Description',
    'reference': 'Reference',
    'cheque': 'Cheque',
  };

  headers.forEach(header => {
    const lower = header.toLowerCase();
    const normalized_ = headerMap[lower] || header;

    if (!normalized[normalized_]) {
      normalized[normalized_] = true;
      result.push(normalized_);
    }
  });

  return result.length > 0 ? result : ['Date', 'Description', 'Withdrawal', 'Deposit', 'Balance'];
}
