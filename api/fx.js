export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  const API_KEY = process.env.ALPHA_VANTAGE_KEY || "N631OGLXXGIATN35";
  const { interval = "15min", outputsize = "full" } = req.query;

  const url = `https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=MXN&to_symbol=JPY&interval=${interval}&outputsize=${outputsize}&apikey=${API_KEY}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
