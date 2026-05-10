import { useState, useEffect, useCallback, useRef } from "react";
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Area, Cell
} from "recharts";

const API_KEY      = "N631OGLXXGIATN35";
const CLAUDE_MODEL = "claude-sonnet-4-20250514";
const ALERT_EMAIL  = "seninves@gmail.com";

// EmailJS
const EJS_SERVICE  = "service_iz9zdrs";
const EJS_TEMPLATE = "template_7chzu28";
const EJS_PUBLIC   = "796hMIPW1nD9lUgVy";

// ─────────────────────────────────────────────────────────────
// DATA
// ─────────────────────────────────────────────────────────────
async function fetchRealData() {
  const url = `/api/fx?interval=15min&outputsize=full`;
  const res  = await fetch(url);
  const json = await res.json();
  if (json["Note"])        throw new Error("APIレート制限中");
  if (json["Information"]) throw new Error("API上限超過");
  const series = json["Time Series FX (15min)"];
  if (!series) throw new Error("データなし");
  return Object.entries(series)
    .sort(([a],[b]) => a.localeCompare(b))
    .map(([time, v]) => ({
      time:  time.slice(11,16),
      date:  time.slice(0,10),
      open:  +parseFloat(v["1. open"]).toFixed(5),
      high:  +parseFloat(v["2. high"]).toFixed(5),
      low:   +parseFloat(v["3. low"]).toFixed(5),
      close: +parseFloat(v["4. close"]).toFixed(5),
      volume:Math.floor(Math.random()*600+100),
    }));
}

function generateMockCandles(count=300) {
  let price=8.42;
  const now=new Date(); now.setMinutes(0,0,0);
  return Array.from({length:count},(_,idx)=>{
    const t=new Date(now.getTime()-(count-1-idx)*15*60*1000);
    const change=(Math.random()-0.48)*0.06;
    const open=price, close=price+change;
    const high=Math.max(open,close)+Math.random()*0.03;
    const low =Math.min(open,close)-Math.random()*0.03;
    price=close;
    return {
      time:`${t.getHours().toString().padStart(2,"0")}:${t.getMinutes().toString().padStart(2,"0")}`,
      date:t.toISOString().slice(0,10),
      open:+open.toFixed(5),high:+high.toFixed(5),low:+low.toFixed(5),close:+close.toFixed(5),
      volume:Math.floor(Math.random()*800+200),
    };
  });
}

// ─────────────────────────────────────────────────────────────
// INDICATORS
// ─────────────────────────────────────────────────────────────
function calcEMA(arr, period) {
  const k=2/(period+1); let ema=null;
  return arr.map(v=>{ ema=ema===null?v:v*k+ema*(1-k); return +ema.toFixed(5); });
}
function calcRSI(closes, period=14) {
  const res=Array(period).fill(null);
  let g=0,l=0;
  for(let i=1;i<=period;i++){const d=closes[i]-closes[i-1];d>0?g+=d:l-=d;}
  let ag=g/period,al=l/period;
  res.push(al===0?100:+(100-100/(1+ag/al)).toFixed(2));
  for(let i=period+1;i<closes.length;i++){
    const d=closes[i]-closes[i-1];
    ag=(ag*(period-1)+Math.max(d,0))/period;
    al=(al*(period-1)+Math.max(-d,0))/period;
    res.push(al===0?100:+(100-100/(1+ag/al)).toFixed(2));
  }
  return res;
}
function calcATR(candles, period=14) {
  const trs=candles.map((d,i)=>{
    if(i===0) return d.high-d.low;
    const p=candles[i-1];
    return Math.max(d.high-d.low,Math.abs(d.high-p.close),Math.abs(d.low-p.close));
  });
  let atr=trs.slice(0,period).reduce((a,b)=>a+b,0)/period;
  const res=Array(period).fill(null); res.push(+atr.toFixed(5));
  for(let i=period+1;i<trs.length;i++){
    atr=(atr*(period-1)+trs[i])/period; res.push(+atr.toFixed(5));
  }
  return res;
}

function computeAllIndicators(candles) {
  const closes=candles.map(d=>d.close);
  const ema9  =calcEMA(closes,9);
  const ema21 =calcEMA(closes,21);
  const ema12 =calcEMA(closes,12);
  const ema26 =calcEMA(closes,26);
  const macdL =ema12.map((v,i)=>+(v-ema26[i]).toFixed(5));
  const macdS =calcEMA(macdL,9);
  const macdH =macdL.map((v,i)=>+(v-macdS[i]).toFixed(5));
  const rsi   =calcRSI(closes);
  const atr   =calcATR(candles);

  // BB
  const bb=closes.map((_,i)=>{
    if(i<19) return {upper:null,mid:null,lower:null};
    const sl=closes.slice(i-19,i+1),m=sl.reduce((a,b)=>a+b,0)/20;
    const std=Math.sqrt(sl.reduce((a,b)=>a+(b-m)**2,0)/20);
    return{upper:+(m+2*std).toFixed(5),mid:+m.toFixed(5),lower:+(m-2*std).toFixed(5)};
  });

  // Stoch
  const stochK=candles.map((_,i)=>{
    if(i<13) return null;
    const sl=candles.slice(i-13,i+1);
    const lo=Math.min(...sl.map(d=>d.low)),hi=Math.max(...sl.map(d=>d.high));
    return hi===lo?50:+((candles[i].close-lo)/(hi-lo)*100).toFixed(2);
  });
  const stochD=stochK.map((_,i)=>{
    const w=stochK.slice(Math.max(0,i-2),i+1).filter(v=>v!==null);
    return w.length===3?+(w.reduce((a,b)=>a+b,0)/3).toFixed(2):null;
  });

  return{ema9,ema21,macdL,macdS,macdH,rsi,atr,bb,stochK,stochD};
}

function scoreAtIndex(i, closes, ind) {
  if(i<26) return{score:0,signal:"WAIT"};
  const rsi=ind.rsi[i],macdH=ind.macdH[i],prevMH=ind.macdH[i-1];
  const sk=ind.stochK[i],sd=ind.stochD[i];
  const close=closes[i],bb=ind.bb[i];
  let score=0;
  if(ind.ema9[i]>ind.ema21[i]) score+=1; else score-=1;
  if(macdH>0&&macdH>prevMH) score+=1; else if(macdH<0&&macdH<prevMH) score-=1;
  if(rsi<35) score+=2; else if(rsi>65) score-=2;
  if(bb&&close<bb.lower) score+=1; else if(bb&&close>bb.upper) score-=1;
  if(sk&&sd&&sk>sd&&sk<30) score+=1; else if(sk&&sd&&sk<sd&&sk>70) score-=1;
  return{score,signal:score>=3?"BUY":score<=-3?"SELL":"WAIT"};
}

// ─────────────────────────────────────────────────────────────
// SIGNAL for latest candle (with TP/SL)
// ─────────────────────────────────────────────────────────────
function buildLatestSignal(candles, ind) {
  const n=candles.length-1;
  const {score,signal}=scoreAtIndex(n,candles.map(d=>d.close),ind);
  const reasons=[];
  const e9=ind.ema9[n],e21=ind.ema21[n];
  const rsi=ind.rsi[n],macdH=ind.macdH[n],prevMH=ind.macdH[n-1];
  const sk=ind.stochK[n],sd=ind.stochD[n];
  const close=candles[n].close,bb=ind.bb[n];
  if(e9>e21) reasons.push("EMA9>EMA21 ↑"); else reasons.push("EMA9<EMA21 ↓");
  if(macdH>0&&macdH>prevMH) reasons.push("MACDヒスト拡大 ↑");
  else if(macdH<0&&macdH<prevMH) reasons.push("MACDヒスト縮小 ↓");
  if(rsi<35) reasons.push(`RSI売られ過ぎ(${rsi})`);
  else if(rsi>65) reasons.push(`RSI買われ過ぎ(${rsi})`);
  if(bb&&close<bb.lower) reasons.push("BB下抜け反発期待");
  else if(bb&&close>bb.upper) reasons.push("BB上抜け反落期待");
  if(sk&&sd&&sk>sd&&sk<30) reasons.push("Stochゴールデンクロス");
  else if(sk&&sd&&sk<sd&&sk>70) reasons.push("Stochデッドクロス");

  const atr=ind.atr[n]||0.05;
  const color=signal==="BUY"?"#10b981":signal==="SELL"?"#ef4444":"#94a3b8";
  let entry=null,tp=null,sl=null,rr=null;
  if(signal==="BUY"){entry=close;tp=+(close+atr*1.5).toFixed(5);sl=+(close-atr*1.0).toFixed(5);rr=1.5;}
  else if(signal==="SELL"){entry=close;tp=+(close-atr*1.5).toFixed(5);sl=+(close+atr*1.0).toFixed(5);rr=1.5;}
  return{signal,score,color,reasons,entry,tp,sl,rr,atr:+atr.toFixed(5)};
}

// ─────────────────────────────────────────────────────────────
// BACKTEST ENGINE
// ─────────────────────────────────────────────────────────────
function runBacktest(candles, tpMult=1.5, slMult=1.0) {
  if(candles.length<50) return null;
  const ind=computeAllIndicators(candles);
  const closes=candles.map(d=>d.close);
  const trades=[];
  let i=30;
  while(i<candles.length-1){
    const{signal}=scoreAtIndex(i,closes,ind);
    if(signal==="WAIT"){i++;continue;}
    const entry=candles[i].close;
    const atr  =ind.atr[i]||0.05;
    const tp   =signal==="BUY"?entry+atr*tpMult:entry-atr*tpMult;
    const sl   =signal==="BUY"?entry-atr*slMult:entry+atr*slMult;
    let result=null,exitIdx=i+1,exitPrice=null;
    for(let j=i+1;j<Math.min(i+20,candles.length);j++){
      const hi=candles[j].high, lo=candles[j].low;
      if(signal==="BUY"){
        if(hi>=tp){result="WIN";exitPrice=tp;exitIdx=j;break;}
        if(lo<=sl){result="LOSS";exitPrice=sl;exitIdx=j;break;}
      } else {
        if(lo<=tp){result="WIN";exitPrice=tp;exitIdx=j;break;}
        if(hi>=sl){result="LOSS";exitPrice=sl;exitIdx=j;break;}
      }
    }
    if(!result){result="TIMEOUT";exitPrice=candles[Math.min(exitIdx,candles.length-1)].close;}
    const pnl=signal==="BUY"?(exitPrice-entry):(entry-exitPrice);
    trades.push({
      idx:i, signal, entry:+entry.toFixed(5), tp:+tp.toFixed(5), sl:+sl.toFixed(5),
      exitPrice:+exitPrice.toFixed(5), result, pnl:+pnl.toFixed(5),
      date:candles[i].date||"", time:candles[i].time,
    });
    i=exitIdx+1;
  }

  if(trades.length===0) return{trades:[],stats:null};
  const wins=trades.filter(t=>t.result==="WIN");
  const losses=trades.filter(t=>t.result==="LOSS");
  const timeouts=trades.filter(t=>t.result==="TIMEOUT");
  const totalPnl=trades.reduce((a,t)=>a+t.pnl,0);
  const winPnl=wins.reduce((a,t)=>a+t.pnl,0);
  const lossPnl=losses.reduce((a,t)=>a+t.pnl,0);
  // equity curve
  let equity=0;
  const equityCurve=trades.map(t=>{equity+=t.pnl;return{label:t.time,equity:+equity.toFixed(5)};});
  const maxDD=equityCurve.reduce((acc,_,i,arr)=>{
    const peak=Math.max(...arr.slice(0,i+1).map(e=>e.equity));
    return Math.min(acc,arr[i].equity-peak);
  },0);

  return{
    trades,
    equityCurve,
    stats:{
      total:trades.length, wins:wins.length, losses:losses.length, timeouts:timeouts.length,
      winRate:+(wins.length/trades.length*100).toFixed(1),
      totalPnl:+totalPnl.toFixed(5),
      avgWin:wins.length?+(winPnl/wins.length).toFixed(5):0,
      avgLoss:losses.length?+(lossPnl/losses.length).toFixed(5):0,
      profitFactor:lossPnl<0?+(-winPnl/lossPnl).toFixed(2):null,
      maxDD:+maxDD.toFixed(5),
    },
  };
}

// ─────────────────────────────────────────────────────────────
// EMAIL ALERT via EmailJS
// ─────────────────────────────────────────────────────────────
async function sendAlertEmail(signalData, latestCandle) {
  // EmailJS SDK をCDNから動的ロード
  if (!window.emailjs) {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js";
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
    window.emailjs.init({ publicKey: EJS_PUBLIC });
  }

  const reasons = signalData.reasons.join(" / ");

  const templateParams = {
    to_email:  ALERT_EMAIL,
    subject:   `【MXN/JPY ${signalData.signal}】¥${latestCandle.close.toFixed(5)} TP:¥${signalData.tp ?? "—"} SL:¥${signalData.sl ?? "—"}`,
    signal:    signalData.signal,
    score:     `${signalData.score > 0 ? "+" : ""}${signalData.score} / 6`,
    price:     `¥${latestCandle.close.toFixed(5)}`,
    high:      `¥${latestCandle.high.toFixed(5)}`,
    low:       `¥${latestCandle.low.toFixed(5)}`,
    entry:     signalData.entry   ? `¥${signalData.entry}`  : "—",
    tp:        signalData.tp      ? `¥${signalData.tp}`     : "—",
    sl:        signalData.sl      ? `¥${signalData.sl}`     : "—",
    rr:        signalData.rr      ? `1 : ${signalData.rr}`  : "—",
    atr:       `${signalData.atr ?? "—"}`,
    rsi:       latestCandle.rsi        != null ? `${latestCandle.rsi.toFixed(1)}` : "—",
    macd_hist: latestCandle.macdHist   != null ? `${latestCandle.macdHist.toFixed(5)}` : "—",
    reasons,
    sent_at:   new Date().toLocaleString("ja-JP"),
  };

  const res = await window.emailjs.send(EJS_SERVICE, EJS_TEMPLATE, templateParams);
  return res;
}

// ─────────────────────────────────────────────────────────────
// AI COMMENT
// ─────────────────────────────────────────────────────────────
async function fetchAIComment(signalData, latestCandle, btStats) {
  const prompt=`あなたはFXデイトレードのアナリストです。以下のMXN/JPY 15分足データを分析し日本語で簡潔なコメントを提供してください。

## 現在値
- 価格: ¥${latestCandle.close.toFixed(5)}
- シグナル: ${signalData.signal}（スコア: ${signalData.score}/6）
- ATR: ${signalData.atr}
${signalData.entry?`- TP: ¥${signalData.tp} / SL: ¥${signalData.sl} / RR: 1:${signalData.rr}`:"- WAIT（エントリーなし）"}
- 根拠: ${signalData.reasons.join(", ")}

${btStats?`## バックテスト実績
- 勝率: ${btStats.winRate}% (${btStats.wins}勝${btStats.losses}敗)
- 累計損益: ${btStats.totalPnl>0?"+":""}${btStats.totalPnl} JPY/単位
- プロフィットファクター: ${btStats.profitFactor??"N/A"}
- 最大DD: ${btStats.maxDD}`:""}

以下の構成で300文字以内で回答:
1. **相場状況**（1〜2文）
2. **注目ポイント**（1〜2文）
3. **トレード方針**（1文）
⚠投資判断は自己責任です。`;

  const res=await fetch("https://api.anthropic.com/v1/messages",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({model:CLAUDE_MODEL,max_tokens:1000,messages:[{role:"user",content:prompt}]}),
  });
  const data=await res.json();
  return data.content?.[0]?.text||"コメントを取得できませんでした。";
}

// ─────────────────────────────────────────────────────────────
// ENRICH (last 80 for chart display)
// ─────────────────────────────────────────────────────────────
function enrichData(candles) {
  const ind=computeAllIndicators(candles);
  const last80=candles.slice(-80);
  const off=candles.length-80;
  return {
    chartData:last80.map((c,i)=>{
      const gi=off+i;
      return{
        ...c,
        ema9:ind.ema9[gi],ema21:ind.ema21[gi],rsi:ind.rsi[gi],
        macdHist:ind.macdH[gi],macdLine:ind.macdL[gi],macdSignal:ind.macdS[gi],
        bbUpper:ind.bb[gi]?.upper,bbMid:ind.bb[gi]?.mid,bbLower:ind.bb[gi]?.lower,
        stochK:ind.stochK[gi],stochD:ind.stochD[gi],atr:ind.atr[gi],
      };
    }),
    signal:buildLatestSignal(candles,ind),
    ind,
  };
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────
export default function App() {
  const [allCandles,  setAllCandles]  = useState([]);
  const [enriched,    setEnriched]    = useState(null);
  const [panel,       setPanel]       = useState("rsi");
  const [activeTab,   setActiveTab]   = useState("chart");
  const [lastUpdate,  setLastUpdate]  = useState(null);
  const [isLive,      setIsLive]      = useState(false);
  const [statusMsg,   setStatusMsg]   = useState("読み込み中...");
  const [isReal,      setIsReal]      = useState(false);
  const [signalLog,   setSignalLog]   = useState([]);
  const [aiComment,   setAiComment]   = useState("");
  const [aiLoading,   setAiLoading]   = useState(false);
  const [btResult,    setBtResult]    = useState(null);
  const [btLoading,   setBtLoading]   = useState(false);
  const [btParams,    setBtParams]    = useState({tp:1.5,sl:1.0});
  const [alertStatus, setAlertStatus] = useState("");
  const [alertEnabled,setAlertEnabled]= useState(true);
  const prevSignal = useRef(null);

  const refresh = useCallback(async()=>{
    setStatusMsg("データ取得中...");
    let candles, real=false;
    try{
      candles=await fetchRealData(); real=true;
      setStatusMsg("Alpha Vantage リアルデータ");
    }catch(e){
      candles=generateMockCandles(300);
      setStatusMsg("モックデータ（"+e.message+"）");
    }
    setAllCandles(candles);
    const en=enrichData(candles);
    setEnriched(en); setIsReal(real); setLastUpdate(new Date());

    const sig=en.signal;
    if(sig.signal!=="WAIT" && sig.signal!==prevSignal.current){
      const lat=candles[candles.length-1];
      const logEntry={
        time:new Date().toLocaleTimeString("ja-JP"),
        signal:sig.signal, color:sig.color,
        entry:sig.entry, tp:sig.tp, sl:sig.sl, rr:sig.rr, score:sig.score,
        reasons:sig.reasons,
      };
      setSignalLog(prev=>[logEntry,...prev].slice(0,20));
      prevSignal.current=sig.signal;

      // メールアラート
      if(alertEnabled){
        setAlertStatus("📧 メール送信中...");
        try{
          await sendAlertEmail(sig, lat);
          setAlertStatus(`✅ ${ALERT_EMAIL} に送信完了`);
        }catch(e){
          setAlertStatus("⚠ メール送信失敗: "+e.message);
        }
        setTimeout(()=>setAlertStatus(""),6000);
      }
    }
  },[alertEnabled]);

  const runBT = useCallback(async()=>{
    if(allCandles.length<50) return;
    setBtLoading(true);
    await new Promise(r=>setTimeout(r,50));
    const res=runBacktest(allCandles,btParams.tp,btParams.sl);
    setBtResult(res);
    setBtLoading(false);
  },[allCandles,btParams]);

  const fetchAI = useCallback(async()=>{
    if(!enriched) return;
    setAiLoading(true); setAiComment("");
    try{
      const lat=enriched.chartData[enriched.chartData.length-1];
      const comment=await fetchAIComment(enriched.signal,lat,btResult?.stats||null);
      setAiComment(comment);
    }catch(e){ setAiComment("取得失敗: "+e.message); }
    setAiLoading(false);
  },[enriched,btResult]);

  useEffect(()=>{ refresh(); },[refresh]);
  useEffect(()=>{
    if(!isLive) return;
    const id=setInterval(refresh,15*60*1000);
    return()=>clearInterval(id);
  },[isLive,refresh]);

  if(!enriched) return(
    <div style={{background:"#0a0e1a",minHeight:"100vh",color:"#94a3b8",
      fontFamily:"monospace",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>
      {statusMsg}
    </div>
  );

  const{chartData,signal}=enriched;
  const lat =chartData[chartData.length-1];
  const prev=chartData[chartData.length-2];
  const diff=lat.close-prev.close;
  const pct =((diff/prev.close)*100).toFixed(3);
  const pMin=Math.min(...chartData.map(d=>d.low))-0.02;
  const pMax=Math.max(...chartData.map(d=>d.high))+0.02;

  const Tab=({id,label})=>(
    <button onClick={()=>setActiveTab(id)} style={{
      background:activeTab===id?"#1e3a5f":"transparent",
      border:`1px solid ${activeTab===id?"#0ea5e9":"#1e293b"}`,
      color:activeTab===id?"#e2e8f0":"#475569",
      borderRadius:8,padding:"7px 14px",cursor:"pointer",
      fontSize:11,fontFamily:"inherit",fontWeight:activeTab===id?700:400,
      whiteSpace:"nowrap",
    }}>{label}</button>
  );

  return(
    <div style={{background:"#0a0e1a",minHeight:"100vh",color:"#e2e8f0",
      fontFamily:"'JetBrains Mono','Courier New',monospace"}}>

      {/* ── HEADER ── */}
      <div style={{background:"linear-gradient(90deg,#0f172a,#1e293b)",borderBottom:"1px solid #1e3a5f",
        padding:"12px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <div style={{background:"linear-gradient(135deg,#0ea5e9,#6366f1)",borderRadius:8,
            padding:"6px 14px",fontSize:13,fontWeight:700,letterSpacing:2,color:"#fff"}}>MXN/JPY</div>
          <div>
            <div style={{display:"flex",alignItems:"baseline",gap:8}}>
              <span style={{fontSize:24,fontWeight:700,color:"#f1f5f9"}}>¥{lat.close.toFixed(5)}</span>
              <span style={{fontSize:13,color:diff>=0?"#10b981":"#ef4444"}}>
                {diff>=0?"▲":"▼"}{Math.abs(diff).toFixed(5)} ({pct}%)
              </span>
            </div>
            <div style={{fontSize:11,color:"#64748b"}}>
              15分足 • {allCandles.length}本
              {isReal?<span style={{color:"#10b981",marginLeft:8}}>● REAL</span>
                :<span style={{color:"#f59e0b",marginLeft:8}}>⚠ MOCK</span>}
              {alertEnabled&&<span style={{color:"#6366f1",marginLeft:8}}>🔔 アラートON</span>}
            </div>
          </div>
        </div>

        <div style={{background:signal.color+"22",border:`2px solid ${signal.color}`,
          borderRadius:10,padding:"8px 24px",textAlign:"center",minWidth:120}}>
          <div style={{fontSize:24,fontWeight:900,color:signal.color,letterSpacing:3}}>{signal.signal}</div>
          <div style={{fontSize:10,color:"#64748b"}}>スコア {signal.score>0?"+":""}{signal.score}/6</div>
        </div>

        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <button onClick={refresh} style={{background:"#1e293b",border:"1px solid #334155",
            color:"#94a3b8",borderRadius:6,padding:"6px 12px",cursor:"pointer",fontSize:12,fontFamily:"inherit"}}>
            ↻ 更新</button>
          <button onClick={()=>setIsLive(v=>!v)} style={{
            background:isLive?"#10b98122":"#1e293b",border:`1px solid ${isLive?"#10b981":"#334155"}`,
            color:isLive?"#10b981":"#64748b",borderRadius:6,padding:"6px 12px",
            cursor:"pointer",fontSize:12,fontFamily:"inherit"}}>
            ● {isLive?"LIVE ON":"LIVE"}
          </button>
          <button onClick={()=>setAlertEnabled(v=>!v)} style={{
            background:alertEnabled?"#6366f122":"#1e293b",border:`1px solid ${alertEnabled?"#6366f1":"#334155"}`,
            color:alertEnabled?"#818cf8":"#64748b",borderRadius:6,padding:"6px 12px",
            cursor:"pointer",fontSize:12,fontFamily:"inherit"}}>
            🔔 アラート{alertEnabled?"ON":"OFF"}
          </button>
        </div>
      </div>

      {alertStatus&&(
        <div style={{background:"#1e293b",borderBottom:"1px solid #334155",padding:"8px 20px",
          fontSize:12,color:"#a5b4fc",textAlign:"center"}}>{alertStatus}</div>
      )}

      <div style={{padding:"12px 16px"}}>

        {/* REASON BAR */}
        <div style={{background:"#0f172a",border:"1px solid #1e3a5f",borderRadius:10,
          padding:"10px 16px",marginBottom:10,display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
          <span style={{fontSize:11,color:"#64748b",flexShrink:0}}>判定根拠:</span>
          {signal.reasons.map((r,i)=>(
            <span key={i} style={{background:"#1e293b",border:"1px solid #334155",borderRadius:4,
              padding:"2px 8px",fontSize:11,
              color:r.includes("↑")||r.includes("期待")||r.includes("ゴールデン")||r.includes("売られ")
                ?"#10b981":r.includes("↓")||r.includes("デッド")||r.includes("買われ")?"#ef4444":"#f59e0b"}}>
              {r}
            </span>
          ))}
        </div>

        {/* TP/SL */}
        {signal.signal!=="WAIT"&&(
          <div style={{background:"#0f172a",border:`1px solid ${signal.color}44`,borderRadius:10,
            padding:"12px 16px",marginBottom:10}}>
            <div style={{fontSize:11,color:"#64748b",marginBottom:8}}>▶ エントリー計画（ATR={signal.atr}）</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
              {[{l:"エントリー",v:`¥${signal.entry?.toFixed(5)}`,c:"#e2e8f0"},
                {l:"利確 TP",v:`¥${signal.tp?.toFixed(5)}`,c:"#10b981"},
                {l:"損切 SL",v:`¥${signal.sl?.toFixed(5)}`,c:"#ef4444"},
                {l:"RR比",v:`1 : ${signal.rr}`,c:"#f59e0b"},
              ].map(({l,v,c})=>(
                <div key={l} style={{background:"#0a0e1a",border:"1px solid #1e293b",
                  borderRadius:8,padding:"8px",textAlign:"center"}}>
                  <div style={{fontSize:10,color:"#475569",marginBottom:3}}>{l}</div>
                  <div style={{fontSize:12,fontWeight:700,color:c}}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TABS */}
        <div style={{display:"flex",gap:6,marginBottom:12,overflowX:"auto",paddingBottom:2}}>
          <Tab id="chart"    label="📈 チャート"/>
          <Tab id="backtest" label={`🧪 バックテスト${btResult?` (${btResult.stats?.winRate}%)`:""}` }/>
          <Tab id="history"  label={`📋 履歴${signalLog.length>0?` (${signalLog.length})`:""}`}/>
          <Tab id="ai"       label="🤖 AI解説"/>
        </div>

        {/* ═══ CHART TAB ═══ */}
        {activeTab==="chart"&&(<>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:10}}>
            {[{l:"始値",v:lat.open},{l:"高値",v:lat.high,c:"#10b981"},
              {l:"安値",v:lat.low,c:"#ef4444"},{l:"終値",v:lat.close,c:diff>=0?"#10b981":"#ef4444"}
            ].map(({l,v,c})=>(
              <div key={l} style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:8,padding:"8px 10px"}}>
                <div style={{fontSize:10,color:"#475569",marginBottom:2}}>{l}</div>
                <div style={{fontSize:12,fontWeight:700,color:c||"#94a3b8"}}>{v.toFixed(5)}</div>
              </div>
            ))}
          </div>

          <div style={{background:"#0f172a",border:"1px solid #1e3a5f",borderRadius:10,padding:"10px 4px 0",marginBottom:8}}>
            <div style={{fontSize:11,color:"#64748b",paddingLeft:16,marginBottom:4}}>
              価格　EMA9<span style={{color:"#f59e0b"}}> ━ </span>EMA21<span style={{color:"#818cf8"}}> ━ </span>BB<span style={{color:"#334155"}}> ░</span>
              {signal.signal!=="WAIT"&&<>　TP<span style={{color:"#10b981"}}> ╌</span> SL<span style={{color:"#ef4444"}}> ╌</span></>}
            </div>
            <ResponsiveContainer width="100%" height={210}>
              <ComposedChart data={chartData} margin={{top:4,right:8,left:-10,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/>
                <XAxis dataKey="time" tick={{fontSize:10,fill:"#475569"}} interval={9}/>
                <YAxis domain={[pMin,pMax]} tick={{fontSize:10,fill:"#475569"}} tickFormatter={v=>v.toFixed(3)} width={58}/>
                <Tooltip contentStyle={{background:"#0f172a",border:"1px solid #334155",borderRadius:8,fontSize:11}}
                  formatter={(v,n)=>[typeof v==="number"?v.toFixed(5):v,n]}/>
                <Area dataKey="bbUpper" stroke="none" fill="#1e3a5f" fillOpacity={0.3}/>
                <Area dataKey="bbLower" stroke="none" fill="#0f172a" fillOpacity={1}/>
                <Line dataKey="bbUpper" stroke="#1e3a5f" strokeWidth={1} dot={false}/>
                <Line dataKey="bbMid"   stroke="#334155" strokeWidth={1} dot={false} strokeDasharray="4 2"/>
                <Line dataKey="bbLower" stroke="#1e3a5f" strokeWidth={1} dot={false}/>
                <Line dataKey="ema9"    stroke="#f59e0b" strokeWidth={1.5} dot={false}/>
                <Line dataKey="ema21"   stroke="#818cf8" strokeWidth={1.5} dot={false}/>
                <Line dataKey="close"   stroke="#94a3b8" strokeWidth={1} dot={false}/>
                {signal.tp&&<ReferenceLine y={signal.tp} stroke="#10b98188" strokeDasharray="6 3" label={{value:"TP",fill:"#10b981",fontSize:10,position:"right"}}/>}
                {signal.sl&&<ReferenceLine y={signal.sl} stroke="#ef444488" strokeDasharray="6 3" label={{value:"SL",fill:"#ef4444",fontSize:10,position:"right"}}/>}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div style={{background:"#0f172a",border:"1px solid #1e3a5f",borderRadius:10,padding:"4px 4px 0",marginBottom:8,height:56}}>
            <ResponsiveContainer width="100%" height={50}>
              <ComposedChart data={chartData} margin={{top:0,right:8,left:-10,bottom:0}}>
                <XAxis hide/><YAxis hide/>
                <Bar dataKey="volume" fill="#1e40af" opacity={0.7} radius={[1,1,0,0]}/>
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div style={{display:"flex",gap:6,marginBottom:6}}>
            {["rsi","macd","stoch"].map(p=>(
              <button key={p} onClick={()=>setPanel(p)} style={{
                background:panel===p?"#1e3a5f":"#0f172a",border:`1px solid ${panel===p?"#0ea5e9":"#1e293b"}`,
                color:panel===p?"#0ea5e9":"#475569",borderRadius:6,padding:"4px 12px",cursor:"pointer",
                fontSize:11,fontFamily:"inherit",textTransform:"uppercase",letterSpacing:1}}>{p}</button>
            ))}
          </div>

          {panel==="rsi"&&(
            <div style={{background:"#0f172a",border:"1px solid #1e3a5f",borderRadius:10,padding:"8px 4px 0"}}>
              <div style={{fontSize:11,color:"#64748b",paddingLeft:16,marginBottom:2}}>
                RSI(14):&nbsp;<span style={{color:(lat.rsi??50)>65?"#ef4444":(lat.rsi??50)<35?"#10b981":"#94a3b8"}}>
                {lat.rsi?.toFixed(1)??"—"}</span>
              </div>
              <ResponsiveContainer width="100%" height={100}>
                <ComposedChart data={chartData} margin={{top:4,right:8,left:-10,bottom:0}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/>
                  <XAxis dataKey="time" tick={{fontSize:9,fill:"#475569"}} interval={9}/>
                  <YAxis domain={[0,100]} tick={{fontSize:9,fill:"#475569"}} width={35}/>
                  <ReferenceLine y={70} stroke="#ef444466" strokeDasharray="4 2"/>
                  <ReferenceLine y={30} stroke="#10b98166" strokeDasharray="4 2"/>
                  <Line dataKey="rsi" stroke="#a78bfa" strokeWidth={1.5} dot={false}/>
                  <Tooltip contentStyle={{background:"#0f172a",border:"1px solid #334155",fontSize:11}} formatter={v=>[v?.toFixed(1),"RSI"]}/>
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
          {panel==="macd"&&(
            <div style={{background:"#0f172a",border:"1px solid #1e3a5f",borderRadius:10,padding:"8px 4px 0"}}>
              <div style={{fontSize:11,color:"#64748b",paddingLeft:16,marginBottom:2}}>
                MACD ヒスト:&nbsp;<span style={{color:(lat.macdHist??0)>0?"#10b981":"#ef4444"}}>{lat.macdHist?.toFixed(5)??"—"}</span>
              </div>
              <ResponsiveContainer width="100%" height={100}>
                <ComposedChart data={chartData} margin={{top:4,right:8,left:-10,bottom:0}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/>
                  <XAxis dataKey="time" tick={{fontSize:9,fill:"#475569"}} interval={9}/>
                  <YAxis tick={{fontSize:9,fill:"#475569"}} width={52} tickFormatter={v=>v.toFixed(4)}/>
                  <ReferenceLine y={0} stroke="#334155"/>
                  <Bar dataKey="macdHist" opacity={0.8} radius={[1,1,0,0]}>
                    {chartData.map((_,i)=><Cell key={i} fill={(chartData[i].macdHist??0)>0?"#10b981":"#ef4444"}/>)}
                  </Bar>
                  <Line dataKey="macdLine"   stroke="#0ea5e9" strokeWidth={1.5} dot={false}/>
                  <Line dataKey="macdSignal" stroke="#f59e0b" strokeWidth={1.5} dot={false}/>
                  <Tooltip contentStyle={{background:"#0f172a",border:"1px solid #334155",fontSize:11}} formatter={(v,n)=>[v?.toFixed(5),n]}/>
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
          {panel==="stoch"&&(
            <div style={{background:"#0f172a",border:"1px solid #1e3a5f",borderRadius:10,padding:"8px 4px 0"}}>
              <div style={{fontSize:11,color:"#64748b",paddingLeft:16,marginBottom:2}}>
                Stoch %K:<span style={{color:"#10b981"}}> {lat.stochK?.toFixed(1)??"—"}</span>&nbsp; %D:<span style={{color:"#f59e0b"}}> {lat.stochD?.toFixed(1)??"—"}</span>
              </div>
              <ResponsiveContainer width="100%" height={100}>
                <ComposedChart data={chartData} margin={{top:4,right:8,left:-10,bottom:0}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/>
                  <XAxis dataKey="time" tick={{fontSize:9,fill:"#475569"}} interval={9}/>
                  <YAxis domain={[0,100]} tick={{fontSize:9,fill:"#475569"}} width={35}/>
                  <ReferenceLine y={80} stroke="#ef444466" strokeDasharray="4 2"/>
                  <ReferenceLine y={20} stroke="#10b98166" strokeDasharray="4 2"/>
                  <Line dataKey="stochK" stroke="#10b981" strokeWidth={1.5} dot={false}/>
                  <Line dataKey="stochD" stroke="#f59e0b" strokeWidth={1.5} dot={false}/>
                  <Tooltip contentStyle={{background:"#0f172a",border:"1px solid #334155",fontSize:11}} formatter={(v,n)=>[v?.toFixed(1),n]}/>
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </>)}

        {/* ═══ BACKTEST TAB ═══ */}
        {activeTab==="backtest"&&(
          <div>
            {/* Params */}
            <div style={{background:"#0f172a",border:"1px solid #1e3a5f",borderRadius:10,padding:"14px 16px",marginBottom:12}}>
              <div style={{fontSize:11,color:"#64748b",marginBottom:10}}>パラメーター設定</div>
              <div style={{display:"flex",gap:16,flexWrap:"wrap",alignItems:"flex-end"}}>
                <div>
                  <div style={{fontSize:10,color:"#475569",marginBottom:4}}>TP倍率（ATR×）</div>
                  <input type="number" value={btParams.tp} step={0.1} min={0.5} max={5}
                    onChange={e=>setBtParams(p=>({...p,tp:+e.target.value}))}
                    style={{background:"#0a0e1a",border:"1px solid #334155",color:"#e2e8f0",
                      borderRadius:6,padding:"6px 10px",fontSize:13,width:80,fontFamily:"inherit"}}/>
                </div>
                <div>
                  <div style={{fontSize:10,color:"#475569",marginBottom:4}}>SL倍率（ATR×）</div>
                  <input type="number" value={btParams.sl} step={0.1} min={0.1} max={3}
                    onChange={e=>setBtParams(p=>({...p,sl:+e.target.value}))}
                    style={{background:"#0a0e1a",border:"1px solid #334155",color:"#e2e8f0",
                      borderRadius:6,padding:"6px 10px",fontSize:13,width:80,fontFamily:"inherit"}}/>
                </div>
                <button onClick={runBT} disabled={btLoading} style={{
                  background:btLoading?"#1e293b":"linear-gradient(135deg,#0ea5e9,#6366f1)",
                  border:"none",color:btLoading?"#475569":"#fff",borderRadius:8,
                  padding:"8px 20px",cursor:btLoading?"not-allowed":"pointer",
                  fontSize:12,fontFamily:"inherit",fontWeight:600}}>
                  {btLoading?"実行中...":"▶ バックテスト実行"}
                </button>
                <div style={{fontSize:10,color:"#334155"}}>対象: {allCandles.length}本</div>
              </div>
            </div>

            {btResult&&btResult.stats&&(
              <>
                {/* Stats */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:12}}>
                  {[
                    {l:"総トレード数",v:btResult.stats.total,c:"#e2e8f0"},
                    {l:"勝率",v:`${btResult.stats.winRate}%`,c:btResult.stats.winRate>=50?"#10b981":"#ef4444"},
                    {l:"PF",v:btResult.stats.profitFactor?`${btResult.stats.profitFactor}`:"N/A",
                      c:btResult.stats.profitFactor>=1.3?"#10b981":btResult.stats.profitFactor>=1?"#f59e0b":"#ef4444"},
                    {l:"勝/敗/TIMEOUT",v:`${btResult.stats.wins}/${btResult.stats.losses}/${btResult.stats.timeouts}`,c:"#94a3b8"},
                    {l:"累計損益",v:`${btResult.stats.totalPnl>0?"+":""}${btResult.stats.totalPnl}`,
                      c:btResult.stats.totalPnl>0?"#10b981":"#ef4444"},
                    {l:"最大DD",v:`${btResult.stats.maxDD}`,c:"#ef4444"},
                  ].map(({l,v,c})=>(
                    <div key={l} style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:8,padding:"10px 12px"}}>
                      <div style={{fontSize:10,color:"#475569",marginBottom:3}}>{l}</div>
                      <div style={{fontSize:13,fontWeight:700,color:c}}>{v}</div>
                    </div>
                  ))}
                </div>

                {/* Equity curve */}
                <div style={{background:"#0f172a",border:"1px solid #1e3a5f",borderRadius:10,padding:"10px 4px 0",marginBottom:12}}>
                  <div style={{fontSize:11,color:"#64748b",paddingLeft:16,marginBottom:4}}>エクイティカーブ</div>
                  <ResponsiveContainer width="100%" height={140}>
                    <ComposedChart data={btResult.equityCurve} margin={{top:4,right:8,left:-10,bottom:0}}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/>
                      <XAxis dataKey="label" hide/>
                      <YAxis tick={{fontSize:9,fill:"#475569"}} width={55} tickFormatter={v=>v.toFixed(4)}/>
                      <ReferenceLine y={0} stroke="#334155"/>
                      <Tooltip contentStyle={{background:"#0f172a",border:"1px solid #334155",fontSize:11}}
                        formatter={v=>[v?.toFixed(5),"累計損益"]}/>
                      <Area dataKey="equity" stroke="#0ea5e9" fill="#0ea5e922" strokeWidth={2}/>
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                {/* Trade list */}
                <div style={{background:"#0f172a",border:"1px solid #1e3a5f",borderRadius:10,padding:"12px"}}>
                  <div style={{fontSize:11,color:"#64748b",marginBottom:8}}>トレード一覧（最新20件）</div>
                  <div style={{overflowX:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                      <thead>
                        <tr style={{color:"#475569"}}>
                          {["日時","方向","エントリー","TP","SL","決済","損益","結果"].map(h=>(
                            <th key={h} style={{textAlign:"left",padding:"4px 8px",borderBottom:"1px solid #1e293b"}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {btResult.trades.slice(-20).reverse().map((t,i)=>(
                          <tr key={i} style={{borderBottom:"1px solid #0f172a"}}>
                            <td style={{padding:"4px 8px",color:"#64748b"}}>{t.time}</td>
                            <td style={{padding:"4px 8px",color:t.signal==="BUY"?"#10b981":"#ef4444",fontWeight:700}}>{t.signal}</td>
                            <td style={{padding:"4px 8px",color:"#94a3b8"}}>{t.entry}</td>
                            <td style={{padding:"4px 8px",color:"#10b981"}}>{t.tp}</td>
                            <td style={{padding:"4px 8px",color:"#ef4444"}}>{t.sl}</td>
                            <td style={{padding:"4px 8px",color:"#94a3b8"}}>{t.exitPrice}</td>
                            <td style={{padding:"4px 8px",color:t.pnl>0?"#10b981":"#ef4444",fontWeight:700}}>
                              {t.pnl>0?"+":""}{t.pnl}
                            </td>
                            <td style={{padding:"4px 8px",color:t.result==="WIN"?"#10b981":t.result==="LOSS"?"#ef4444":"#f59e0b"}}>
                              {t.result}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            {!btResult&&!btLoading&&(
              <div style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:10,
                padding:"40px",textAlign:"center",color:"#334155",fontSize:13}}>
                「▶ バックテスト実行」を押してください
              </div>
            )}
          </div>
        )}

        {/* ═══ HISTORY TAB ═══ */}
        {activeTab==="history"&&(
          <div>
            {signalLog.length===0?(
              <div style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:10,
                padding:"40px",textAlign:"center",color:"#334155",fontSize:13}}>
                まだシグナルが記録されていません
              </div>
            ):signalLog.map((log,i)=>(
              <div key={i} style={{background:"#0f172a",border:`1px solid ${log.color}33`,
                borderRadius:10,padding:"12px 14px",marginBottom:8}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <span style={{background:log.color+"22",border:`1px solid ${log.color}`,
                      borderRadius:6,padding:"2px 12px",fontSize:13,fontWeight:900,
                      color:log.color,letterSpacing:2}}>{log.signal}</span>
                    <span style={{fontSize:11,color:"#64748b"}}>スコア {log.score>0?"+":""}{log.score}</span>
                  </div>
                  <span style={{fontSize:11,color:"#334155"}}>{log.time}</span>
                </div>
                {log.entry&&(
                  <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:8}}>
                    {[{l:"エントリー",v:`¥${log.entry?.toFixed(5)}`,c:"#e2e8f0"},
                      {l:"TP",v:`¥${log.tp?.toFixed(5)}`,c:"#10b981"},
                      {l:"SL",v:`¥${log.sl?.toFixed(5)}`,c:"#ef4444"},
                      {l:"RR",v:`1:${log.rr}`,c:"#f59e0b"},
                    ].map(({l,v,c})=>(
                      <div key={l} style={{background:"#0a0e1a",borderRadius:6,padding:"5px 8px",textAlign:"center"}}>
                        <div style={{fontSize:9,color:"#475569",marginBottom:1}}>{l}</div>
                        <div style={{fontSize:11,fontWeight:700,color:c}}>{v}</div>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                  {log.reasons.map((r,j)=>(
                    <span key={j} style={{background:"#1e293b",borderRadius:4,padding:"2px 6px",fontSize:10,color:"#64748b"}}>{r}</span>
                  ))}
                </div>
              </div>
            ))}
            {signalLog.length>0&&(
              <button onClick={()=>setSignalLog([])} style={{background:"transparent",
                border:"1px solid #334155",color:"#475569",borderRadius:6,padding:"6px 14px",
                cursor:"pointer",fontSize:11,fontFamily:"inherit",width:"100%",marginTop:4}}>
                ✕ 履歴をクリア
              </button>
            )}
          </div>
        )}

        {/* ═══ AI TAB ═══ */}
        {activeTab==="ai"&&(
          <div>
            <div style={{background:"#0f172a",border:"1px solid #1e3a5f",borderRadius:10,padding:"16px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                <div style={{fontSize:12,color:"#64748b"}}>
                  Claude AIによる相場解説
                  {btResult?.stats&&<span style={{color:"#6366f1",marginLeft:8}}>＋バックテスト結果を反映</span>}
                </div>
                <button onClick={fetchAI} disabled={aiLoading} style={{
                  background:aiLoading?"#1e293b":"linear-gradient(135deg,#0ea5e9,#6366f1)",
                  border:"none",color:aiLoading?"#475569":"#fff",borderRadius:8,
                  padding:"8px 16px",cursor:aiLoading?"not-allowed":"pointer",
                  fontSize:12,fontFamily:"inherit",fontWeight:600}}>
                  {aiLoading?"分析中...":"🤖 解説を取得"}
                </button>
              </div>

              <div style={{background:"#0a0e1a",borderRadius:8,padding:"10px 12px",marginBottom:12,
                display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:6}}>
                {[
                  {l:"現在値",v:`¥${lat.close.toFixed(5)}`},
                  {l:"シグナル",v:signal.signal,c:signal.color},
                  ...(btResult?.stats?[
                    {l:"勝率",v:`${btResult.stats.winRate}%`,c:btResult.stats.winRate>=50?"#10b981":"#ef4444"},
                    {l:"PF",v:`${btResult.stats.profitFactor??"—"}`,c:"#f59e0b"},
                  ]:[]),
                ].map(({l,v,c})=>(
                  <div key={l} style={{display:"flex",justifyContent:"space-between"}}>
                    <span style={{fontSize:11,color:"#475569"}}>{l}</span>
                    <span style={{fontSize:11,fontWeight:700,color:c||"#94a3b8"}}>{v}</span>
                  </div>
                ))}
              </div>

              {aiLoading&&(
                <div style={{textAlign:"center",padding:"30px",color:"#475569",fontSize:13}}>
                  <div style={{marginBottom:8,fontSize:22,animation:"spin 1s linear infinite"}}>⟳</div>
                  Claudeが分析中...
                </div>
              )}
              {aiComment&&!aiLoading&&(
                <div style={{background:"#0a0e1a",borderRadius:8,padding:"14px 16px",
                  borderLeft:"3px solid #0ea5e9",lineHeight:1.9,fontSize:13,color:"#cbd5e1",whiteSpace:"pre-wrap"}}>
                  {aiComment}
                </div>
              )}
              {!aiComment&&!aiLoading&&(
                <div style={{textAlign:"center",padding:"24px",color:"#334155",fontSize:12}}>
                  「🤖 解説を取得」ボタンを押してください
                </div>
              )}
            </div>
            <div style={{marginTop:8,fontSize:10,color:"#1e293b",textAlign:"center"}}>
              ⚠ AI解説は参考情報です。投資判断は必ず自己責任で。
            </div>
          </div>
        )}

        {/* STATUS */}
        <div style={{marginTop:12,display:"flex",justifyContent:"space-between",
          fontSize:10,color:"#334155",padding:"0 4px"}}>
          <span>{lastUpdate?`更新: ${lastUpdate.toLocaleTimeString("ja-JP")}`:""}</span>
          <span style={{color:isReal?"#10b98155":"#f59e0b88"}}>{statusMsg}</span>
        </div>
      </div>
    </div>
  );
}
