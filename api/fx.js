export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  // Yahoo Finance: MXNJPY=X
  // interval: 1m,2m,5m,15m,30m,60m,90m,1h,1d,5d,1wk,1mo,3mo
  // range:    1d,5d,1mo,3mo,6mo,1y,2y,5y,10y,ytd,max
  const { interval = "15m", range = "5d" } = req.query;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/MXNJPY=X?interval=${interval}&range=${range}`;

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    const data = await response.json();

    // Yahoo Financeのレスポンスを変換
    const chart = data?.chart?.result?.[0];
    if (!chart) {
      return res.status(500).json({ error: "データなし", raw: data });
    }

    const timestamps = chart.timestamp;
    const quote = chart.indicators.quote[0];

    const candles = timestamps.map((ts, i) => {
      const t = new Date(ts * 1000);
      const jst = new Date(t.getTime() + 9 * 60 * 60 * 1000);
      return {
        time: `${jst.getUTCHours().toString().padStart(2,"0")}:${jst.getUTCMinutes().toString().padStart(2,"0")}`,
        date: jst.toISOString().slice(0,10),
        open:  +( quote.open[i]  ?? 0).toFixed(5),
        high:  +( quote.high[i]  ?? 0).toFixed(5),
        low:   +( quote.low[i]   ?? 0).toFixed(5),
        close: +( quote.close[i] ?? 0).toFixed(5),
        volume: quote.volume?.[i] ?? 0,
      };
    }).filter(c => c.close > 0);

    res.status(200).json({ candles });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
