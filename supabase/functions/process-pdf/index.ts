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
        JSON.stringify({ error: "No file", success: false, data: [] }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const text = extractTextFromPDF(arrayBuffer);
    const lines = text.split(/[\n\r]+/).filter(l => l.trim().length > 0);

    const transactions = parseTransactions(text);

    return new Response(
      JSON.stringify({
        success: transactions.length > 0,
        data: transactions,
        filename: file.name,
        debug: {
          extractedTextLength: text.length,
          linesCount: lines.length,
          transactionsFound: transactions.length,
          sampleLines: lines.slice(0, 10),
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : String(error), 
        data: [] 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function extractTextFromPDF(arrayBuffer: ArrayBuffer): string {
  const uint8Array = new Uint8Array(arrayBuffer);
  const textParts: string[] = [];

  const utf8Decoder = new TextDecoder("utf-8", { fatal: false });
  let decodedPDF = utf8Decoder.decode(uint8Array);

  textParts.push(extractFromStreams(decodedPDF));
  textParts.push(extractFromParentheses(decodedPDF));
  textParts.push(extractFromBinaryData(uint8Array));

  const combined = textParts.join(" ").trim();
  const cleaned = combined
    .replace(/\s+/g, " ")
    .replace(/[^\x20-\x7E\n\r\t]/g, " ")
    .trim();

  return cleaned;
}

function extractFromStreams(decodedPDF: string): string {
  const result: string[] = [];
  const parts = decodedPDF.split("stream");

  for (let i = 1; i < parts.length && i < 500; i++) {
    const idx = parts[i].indexOf("endstream");
    if (idx > 0) {
      const data = parts[i].substring(0, idx);
      const cleaned = data.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g, " ");
      if (cleaned.trim().length > 0) {
        result.push(cleaned.trim());
      }
    }
  }

  return result.join(" ");
}

function extractFromParentheses(decodedPDF: string): string {
  const result: string[] = [];
  let startIdx = 0;
  let count = 0;

  while (count < 2000) {
    const idx = decodedPDF.indexOf("(", startIdx);
    if (idx === -1) break;

    const endIdx = decodedPDF.indexOf(")", idx);
    if (endIdx === -1) break;

    const len = endIdx - idx - 1;
    if (len > 2 && len < 500) {
      let content = decodedPDF.substring(idx + 1, endIdx);
      content = content.replace(/\\\(/g, "(").replace(/\\\)/g, ")");
      content = content.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g, " ");
      if (content.trim().length > 0) {
        result.push(content.trim());
      }
    }

    startIdx = endIdx + 1;
    count++;
  }

  return result.join(" ");
}

function extractFromBinaryData(uint8Array: Uint8Array): string {
  const result: string[] = [];
  let current = "";

  for (let i = 0; i < uint8Array.length; i++) {
    const byte = uint8Array[i];
    if (byte >= 32 && byte <= 126) {
      current += String.fromCharCode(byte);
    } else {
      if (current.length > 3) {
        result.push(current);
      }
      current = "";
    }
  }

  if (current.length > 3) {
    result.push(current);
  }

  return result.join(" ");
}

function parseTransactions(text: string): Array<any> {
  const lines = text
    .split(/[\n\r]+/)
    .map(l => l.trim())
    .filter(l => l.length > 5);

  const transactions: Array<any> = [];
  const seen = new Set<string>();

  for (const line of lines) {
    if (seen.has(line.substring(0, 100))) continue;
    seen.add(line.substring(0, 100));

    const date = extractDate(line);
    if (!date) continue;

    const amounts = extractAmounts(line);
    if (amounts.length === 0) continue;

    let description = line
      .replace(date, "")
      .replace(/[0-9.,\s]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!description || description.length < 2) {
      description = "Transaction";
    }

    transactions.push({
      date: date,
      particulars: description.substring(0, 150),
      withdrawal: "",
      deposit: "",
      balance: amounts[amounts.length - 1] || "",
    });
  }

  return transactions.slice(0, 1000);
}

function extractDate(line: string): string {
  const patterns = [
    /(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/,
    /(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/,
    /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})/i,
    /(\d{2}-\d{2}-\d{4})/,
  ];

  for (const p of patterns) {
    const m = line.match(p);
    if (m) return m[0];
  }

  return "";
}

function extractAmounts(line: string): string[] {
  const amounts = new Set<string>();
  const patterns = [
    /\d{1,3}(?:,\d{3})*\.\d{1,2}/g,
    /\d+\.\d{2}/g,
    /\d{1,3}(?:,\d{3})+/g,
  ];

  for (const p of patterns) {
    const m = line.match(p);
    if (m) {
      m.forEach(amt => amounts.add(amt));
    }
  }

  return Array.from(amounts);
}
