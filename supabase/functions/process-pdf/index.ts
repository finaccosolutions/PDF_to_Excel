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

    const pdfText = await extractTextFromPDF(uint8Array);
    const { data, headers } = parseTabularData(pdfText);

    return new Response(
      JSON.stringify({
        success: data.length > 0,
        data: data,
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

async function extractTextFromPDF(data: Uint8Array): Promise<string> {
  try {
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const textParts: string[] = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ');

      textParts.push(pageText);
    }

    return textParts.join('\n');
  } catch (error) {
    console.error('PDF extraction error:', error);
    throw new Error('Failed to extract text from PDF');
  }
}

interface ParseResult {
  data: Array<{ [key: string]: string }>;
  headers: string[];
}

function parseTabularData(text: string): ParseResult {
  const lines = text.split(/\n+/).map(l => l.trim()).filter(l => l.length > 0);

  let headers: string[] = [];
  let dataLines: string[] = [];
  let inDataSection = false;
  let footerStartIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inDataSection) {
      if (isHeaderLine(line)) {
        headers = extractHeaders(line);
        inDataSection = true;
        continue;
      }
    } else {
      if (isFooterLine(line)) {
        footerStartIndex = i;
        break;
      }

      if (isValidDataLine(line, headers)) {
        dataLines.push(line);
      }
    }
  }

  if (headers.length === 0) {
    headers = detectHeadersFromContent(lines);
  }

  const transactions = dataLines.map(line => parseDataLine(line, headers));

  return {
    data: transactions.filter(t => Object.values(t).some(v => v && v.length > 0)),
    headers: headers
  };
}

function isHeaderLine(line: string): boolean {
  const lowerLine = line.toLowerCase();

  const headerPatterns = [
    /date|transaction|debit|credit|description|particulars|amount|balance/i,
  ];

  const headerIndicators = [
    'date',
    'transaction',
    'debit',
    'credit',
    'balance',
    'amount',
    'description',
    'particulars',
    'withdrawal',
    'deposit',
    'opening',
    'closing',
    'reference',
  ];

  const matches = headerIndicators.filter(indicator =>
    lowerLine.includes(indicator)
  );

  return matches.length >= 2 && !line.match(/\d{2,4}[-\/]\d{1,2}[-\/]\d{1,2}/);
}

function extractHeaders(line: string): string[] {
  const headers = line
    .split(/\s{2,}/)
    .map(h => h.trim())
    .filter(h => h.length > 0 && !h.match(/^\d+$/));

  if (headers.length === 0) {
    const parts = line.split(/\t+/).map(p => p.trim()).filter(p => p.length > 0);
    return parts;
  }

  return headers;
}

function isFooterLine(line: string): boolean {
  const lowerLine = line.toLowerCase();

  const footerPatterns = [
    /^(end of statement|total|grand total|closing balance|statement generated|thank you)/i,
    /^page \d+ of \d+/i,
    /bank name|branch|ifsc|micr/i,
    /^(this is a|please note|for further|thank|regards|signature|terms)/i,
  ];

  return footerPatterns.some(pattern => pattern.test(lowerLine));
}

function isValidDataLine(line: string, headers: string[]): boolean {
  if (line.length < 5) return false;

  const hasDate = /\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}|\d{2}[\s-]\w{3}[\s-]\d{4}/.test(line);
  const hasAmount = /\d+(?:[.,]\d{2})?(?:\s|$)/.test(line);

  return hasDate || (hasAmount && line.split(/\s+/).length >= 3);
}

function detectHeadersFromContent(lines: string[]): string[] {
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const line = lines[i];
    if (isHeaderLine(line)) {
      return extractHeaders(line);
    }
  }

  return ['Date', 'Description', 'Amount', 'Balance'];
}

function parseDataLine(line: string, headers: string[]): { [key: string]: string } {
  const parts = line
    .split(/\s{2,}/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  if (parts.length === 0) {
    const tabParts = line.split(/\t+/).map(p => p.trim()).filter(p => p.length > 0);
    return mapPartsToHeaders(tabParts, headers);
  }

  return mapPartsToHeaders(parts, headers);
}

function mapPartsToHeaders(parts: string[], headers: string[]): { [key: string]: string } {
  const result: { [key: string]: string } = {};

  headers.forEach((header, index) => {
    result[header] = parts[index] || '';
  });

  return result;
}
