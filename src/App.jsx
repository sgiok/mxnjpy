import { useState, useEffect, useCallback, useRef } from "react";
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Area, Cell,
  RadarChart, PolarGrid, PolarAngleAxis, Radar
} from "recharts";

const CLAUDE_MODEL = "claude-sonnet-4-5";
const ALERT_EMAIL  = "seninves@gmail.com";
const EJS_SERVICE  = "service_iz9zdrs";
const EJS_TEMPLATE = "template_7chzu28";
const EJS_PUBLIC   = "796hMIPW1nD9lUgVy";
const STORAGE_KEY  = "mxnjpy_weights_v2";
const TRADES_KEY   = "mxnjpy_trades_v2";

const DEFAULT_WEIGHTS = { ema:1.0, macd:2.0, rsi:2.0, bb:1.5, stoch:1.0, vwap:1.5, pattern:2.0 };

function loadWeights() {
  try { const w=JSON.parse(localStorage.getItem(STORAGE_KEY)); if(w&&Object.keys(w).length===7) return w; } catch {}
  return {...DEFAULT_WEIGHTS};
}
function saveWeights(w) { try { localStorage.setItem(STORAGE_KEY,JSON.stringify(w)); } catch {} }
function loadTrades() { try { return JSON.parse(localStorage.getItem(TRADES_KEY))||[]; } catch { return []; } }
function saveTrades(t) { try { localStorage.setItem(TRADES_KEY,JSON.stringify(t.slice(-500))); } catch {} }

function learnFromTrades(trades, currentWeights) {
  if(trades.length<10) return currentWeights;
  const recent=trades.slice(-50);
  const delta=Object.fromEntries(Object.keys(currentWeights).map(k=>[k,0]));
  const counts={...delta};
  recent.forEach(t=>{
    if(!t.contributions) return;
    const sign=t.result==="WIN"?1:-1;
    Object.entries(t.contributions).forEach(([k,contributed])=>{ if(contributed){delta[k]+=sign*0.05;counts[k]++;} });
  });
  const newW={...currentWeights};
  Object.keys(newW).forEach(k=>{ if(counts[k]>0){newW[k]=Math.max(0.3,Math.min(4.0,newW[k]+delta[k]));newW[k]=+newW[k].toFixed(3);} });
  return newW;
}

const TF_CONFIG = {
  "1m":  {interval:"1m",  range:"1d",  label:"1分足",   liveMs:60*1000},
  "5m":  {interval:"5m",  range:"5d",  label:"5分足",   liveMs:5*60*1000},
  "15m": {interval:"15m", range:"5d",  label:"15分足",  liveMs:15*60*1000},
  "30m": {interval:"30m", range:"1mo", label:"30分足",  liveMs:30*60*1000},
  "1h":  {interval:"60m", range:"1mo", label:"1時間足", liveMs:60*60*1000},
};

async function fetchRealData(tf="15m") {
  const {interval,range}=TF_CONFIG[tf];
  const res=await fetch(`/api/fx?interval=${interval}&range=${range}`);
  const json=await res.json();
  if(json.error) throw new Error(json.error);
  if(!json.candles||json.candles.length===0) throw new Error("データなし");
  return json.candles;
}

function generateMockCandles(count=300) {
  let price=8.42;
  const now=new Date(); now.setMinutes(0,0,0);
  return Array.from({length:count},(_,idx)=>{
    const t=new Date(now.getTime()-(count-1-idx)*15*60*1000);
    const change=(Math.random()-0.48)*0.06;
    const open=price,close=price+change;
    const high=Math.max(open,close)+Math.random()*0.03;
    const low=Math.min(open,close)-Math.random()*0.03;
    price=close;
    return {time:`${t.getHours().toString().padStart(2,"0")}:${t.getMinutes().toString().padStart(2,"0")}`,date:t.toISOString().slice(0,10),open:+open.toFixed(5),high:+high.toFixed(5),low:+low.toFixed(5),close:+close.toFixed(5),volume:Math.floor(Math.random()*800+200)};
  });
}

function calcEMA(arr,period){const k=2/(period+1);let ema=null;return arr.map(v=>{ema=ema===null?v:v*k+ema*(1-k);return +ema.toFixed(5);});}
function calcRSI(closes,period=14){const res=Array(period).fill(null);let g=0,l=0;for(let i=1;i<=period;i++){const d=closes[i]-closes[i-1];d>0?g+=d:l-=d;}let ag=g/period,al=l/period;res.push(al===0?100:+(100-100/(1+ag/al)).toFixed(2));for(let i=period+1;i<closes.length;i++){const d=closes[i]-closes[i-1];ag=(ag*(period-1)+Math.max(d,0))/period;al=(al*(period-1)+Math.max(-d,0))/period;res.push(al===0?100:+(100-100/(1+ag/al)).toFixed(2));}return res;}
function calcATR(candles,period=14){const trs=candles.map((d,i)=>{if(i===0)return d.high-d.low;const p=candles[i-1];return Math.max(d.high-d.low,Math.abs(d.high-p.close),Math.abs(d.low-p.close));});let atr=trs.slice(0,period).reduce((a,b)=>a+b,0)/period;const res=Array(period).fill(null);res.push(+atr.toFixed(5));for(let i=period+1;i<trs.length;i++){atr=(atr*(period-1)+trs[i])/period;res.push(+atr.toFixed(5));}return res;}

function calcVWAP(candles){let cumPV=0,cumV=0,lastDate=null;return candles.map(c=>{if(c.date&&c.date!==lastDate){cumPV=0;cumV=0;lastDate=c.date;}const tp=(c.high+c.low+c.close)/3;cumPV+=tp*(c.volume||1);cumV+=(c.volume||1);return +(cumPV/cumV).toFixed(5);});}

function detectPattern(candles,i){
  if(i<1) return {name:null,direction:0};
  const c=candles[i],p=candles[i-1];
  const body=Math.abs(c.close-c.open);
  const upperWick=c.high-Math.max(c.open,c.close);
  const lowerWick=Math.min(c.open,c.close)-c.low;
  if(p.close<p.open&&c.close>c.open&&c.open<=p.close&&c.close>=p.open) return {name:"強気包み足",direction:1};
  if(p.close>p.open&&c.close<c.open&&c.open>=p.close&&c.close<=p.open) return {name:"弱気包み足",direction:-1};
  if(lowerWick>body*2&&lowerWick>upperWick*2&&body>0) return {name:"上昇ピンバー",direction:1};
  if(upperWick>body*2&&upperWick>lowerWick*2&&body>0) return {name:"下降ピンバー",direction:-1};
  if(lowerWick>=body*2&&upperWick<body*0.3&&c.close>c.open) return {name:"ハンマー",direction:1};
  if(upperWick>=body*2&&lowerWick<body*0.3&&c.close<c.open) return {name:"流れ星",direction:-1};
  return {name:null,direction:0};
}

function computeAllIndicators(candles){
  const closes=candles.map(d=>d.close);
  const ema9=calcEMA(closes,9),ema21=calcEMA(closes,21);
  const ema12=calcEMA(closes,12),ema26=calcEMA(closes,26);
  const macdL=ema12.map((v,i)=>+(v-ema26[i]).toFixed(5));
  const macdS=calcEMA(macdL,9);
  const macdH=macdL.map((v,i)=>+(v-macdS[i]).toFixed(5));
  const rsi=calcRSI(closes),atr=calcATR(candles),vwap=calcVWAP(candles);
  const patterns=candles.map((_,i)=>detectPattern(candles,i));
  const bb=closes.map((_,i)=>{if(i<19)return{upper:null,mid:null,lower:null};const sl=closes.slice(i-19,i+1),m=sl.reduce((a,b)=>a+b,0)/20;const std=Math.sqrt(sl.reduce((a,b)=>a+(b-m)**2,0)/20);return{upper:+(m+2*std).toFixed(5),mid:+m.toFixed(5),lower:+(m-2*std).toFixed(5)};});
  const stochK=candles.map((_,i)=>{if(i<13)return null;const sl=candles.slice(i-13,i+1);const lo=Math.min(...sl.map(d=>d.low)),hi=Math.max(...sl.map(d=>d.high));return hi===lo?50:+((candles[i].close-lo)/(hi-lo)*100).toFixed(2);});
  const stochD=stochK.map((_,i)=>{const w=stochK.slice(Math.max(0,i-2),i+1).filter(v=>v!==null);return w.length===3?+(w.reduce((a,b)=>a+b,0)/3).toFixed(2):null;});
  return{ema9,ema21,macdL,macdS,macdH,rsi,atr,bb,stochK,stochD,vwap,patterns};
}

function scoreAtIndex(i,closes,ind,weights=DEFAULT_WEIGHTS){
  if(i<26) return{score:0,rawScore:0,maxScore:0,signal:"WAIT",contributions:{}};
  const rsi=ind.rsi[i],macdH=ind.macdH[i],prevMH=ind.macdH[i-1];
  const sk=ind.stochK[i],sd=ind.stochD[i],close=closes[i],bb=ind.bb[i];
  const vwap=ind.vwap[i],pattern=ind.patterns[i];
  let score=0;const contributions={};
  const emaS=(ind.ema9[i]>ind.ema21[i]?1:-1)*weights.ema;score+=emaS;contributions.ema=(emaS>0);
  let macdS=0;if(macdH>0&&macdH>prevMH)macdS=weights.macd;else if(macdH<0&&macdH<prevMH)macdS=-weights.macd;score+=macdS;contributions.macd=(macdS>0);
  let rsiS=0;if(rsi<35)rsiS=weights.rsi;else if(rsi>65)rsiS=-weights.rsi;score+=rsiS;contributions.rsi=(rsiS>0);
  let bbS=0;if(bb&&close<bb.lower)bbS=weights.bb;else if(bb&&close>bb.upper)bbS=-weights.bb;score+=bbS;contributions.bb=(bbS>0);
  let stochS=0;if(sk&&sd&&sk>sd&&sk<30)stochS=weights.stoch;else if(sk&&sd&&sk<sd&&sk>70)stochS=-weights.stoch;score+=stochS;contributions.stoch=(stochS>0);
  let vwapS=0;if(vwap&&close>vwap)vwapS=weights.vwap;else if(vwap&&close<vwap)vwapS=-weights.vwap;score+=vwapS;contributions.vwap=(vwapS>0);
  let patS=0;if(pattern.direction>0)patS=weights.pattern;else if(pattern.direction<0)patS=-weights.pattern;score+=patS;contributions.pattern=(patS>0);
  const maxScore=Object.values(weights).reduce((a,b)=>a+b,0);
  const threshold=maxScore*0.35;
  const signal=score>=threshold?"BUY":score<=-threshold?"SELL":"WAIT";
  return{score:+score.toFixed(2),rawScore:score,maxScore,signal,contributions};
}

function getSignalQuality(score,maxScore){
  const pct=Math.abs(score)/maxScore*100;
  if(pct>=60) return {label:"強",color:"#10b981",stars:"★★★"};
  if(pct>=45) return {label:"中",color:"#f59e0b",stars:"★★☆"};
  return {label:"弱",color:"#94a3b8",stars:"★☆☆"};
}

function buildLatestSignal(candles,ind,weights,btParams={tp:1.5,sl:1.0}){
  const n=candles.length-1;
  const {score,maxScore,signal,contributions}=scoreAtIndex(n,candles.map(d=>d.close),ind,weights);
  const reasons=[];
  const e9=ind.ema9[n],e21=ind.ema21[n],rsi=ind.rsi[n],macdH=ind.macdH[n],prevMH=ind.macdH[n-1];
  const sk=ind.stochK[n],sd=ind.stochD[n],close=candles[n].close,bb=ind.bb[n];
  const vwap=ind.vwap[n],pattern=ind.patterns[n];
  if(e9>e21)reasons.push("EMA9>EMA21 ↑");else reasons.push("EMA9<EMA21 ↓");
  if(macdH>0&&macdH>prevMH)reasons.push("MACDヒスト拡大 ↑");else if(macdH<0&&macdH<prevMH)reasons.push("MACDヒスト縮小 ↓");
  if(rsi<35)reasons.push(`RSI売られ過ぎ(${rsi})`);else if(rsi>65)reasons.push(`RSI買われ過ぎ(${rsi})`);
  if(bb&&close<bb.lower)reasons.push("BB下抜け反発期待");else if(bb&&close>bb.upper)reasons.push("BB上抜け反落期待");
  if(sk&&sd&&sk>sd&&sk<30)reasons.push("Stochゴールデンクロス");else if(sk&&sd&&sk<sd&&sk>70)reasons.push("Stochデッドクロス");
  if(vwap&&close>vwap)reasons.push(`VWAP上方(¥${vwap?.toFixed(5)})`);else if(vwap&&close<vwap)reasons.push(`VWAP下方(¥${vwap?.toFixed(5)})`);
  if(pattern.name)reasons.push(pattern.name+(pattern.direction>0?" ↑":" ↓"));
  const atr=ind.atr[n]||0.05;
  const color=signal==="BUY"?"#10b981":signal==="SELL"?"#ef4444":"#94a3b8";
  let entry=null,tp=null,sl=null,rr=null;
  if(signal==="BUY"){entry=close;tp=+(close+atr*btParams.tp).toFixed(5);sl=+(close-atr*btParams.sl).toFixed(5);rr=+(btParams.tp/btParams.sl).toFixed(2);}
  else if(signal==="SELL"){entry=close;tp=+(close-atr*btParams.tp).toFixed(5);sl=+(close+atr*btParams.sl).toFixed(5);rr=+(btParams.tp/btParams.sl).toFixed(2);}
  const quality=getSignalQuality(score,maxScore);
  return{signal,score,maxScore,color,reasons,entry,tp,sl,rr,atr:+atr.toFixed(5),quality,contributions,pattern};
}

function runBacktest(candles,tpMult=1.5,slMult=1.0,weights=DEFAULT_WEIGHTS){
  if(candles.length<50) return null;
  const ind=computeAllIndicators(candles);
  const closes=candles.map(d=>d.close);
  const trades=[];let i=30;
  while(i<candles.length-1){
    const {signal,contributions}=scoreAtIndex(i,closes,ind,weights);
    if(signal==="WAIT"){i++;continue;}
    const entry=candles[i].close,atr=ind.atr[i]||0.05;
    const tp=signal==="BUY"?entry+atr*tpMult:entry-atr*tpMult;
    const sl=signal==="BUY"?entry-atr*slMult:entry+atr*slMult;
    let result=null,exitIdx=i+1,exitPrice=null;
    for(let j=i+1;j<Math.min(i+20,candles.length);j++){
      const hi=candles[j].high,lo=candles[j].low;
      if(signal==="BUY"){if(hi>=tp){result="WIN";exitPrice=tp;exitIdx=j;break;}if(lo<=sl){result="LOSS";exitPrice=sl;exitIdx=j;break;}}
      else{if(lo<=tp){result="WIN";exitPrice=tp;exitIdx=j;break;}if(hi>=sl){result="LOSS";exitPrice=sl;exitIdx=j;break;}}
    }
    if(!result){result="TIMEOUT";exitPrice=candles[Math.min(exitIdx,candles.length-1)].close;}
    const pnl=signal==="BUY"?(exitPrice-entry):(entry-exitPrice);
    trades.push({idx:i,signal,entry:+entry.toFixed(5),tp:+tp.toFixed(5),sl:+sl.toFixed(5),exitPrice:+exitPrice.toFixed(5),result,pnl:+pnl.toFixed(5),date:candles[i].date||"",time:candles[i].time,contributions});
    i=exitIdx+1;
  }
  if(trades.length===0) return{trades:[],stats:null,equityCurve:[]};
  const wins=trades.filter(t=>t.result==="WIN");
  const losses=trades.filter(t=>t.result==="LOSS");
  const timeouts=trades.filter(t=>t.result==="TIMEOUT");
  const totalPnl=trades.reduce((a,t)=>a+t.pnl,0);
  const winPnl=wins.reduce((a,t)=>a+t.pnl,0);
  const lossPnl=losses.reduce((a,t)=>a+t.pnl,0);
  let equity=0;
  const equityCurve=trades.map(t=>{equity+=t.pnl;return{label:t.time,equity:+equity.toFixed(5)};});
  const maxDD=equityCurve.reduce((acc,_,i,arr)=>{const peak=Math.max(...arr.slice(0,i+1).map(e=>e.equity));return Math.min(acc,arr[i].equity-peak);},0);
  return{trades,equityCurve,stats:{total:trades.length,wins:wins.length,losses:losses.length,timeouts:timeouts.length,winRate:+(wins.length/trades.length*100).toFixed(1),totalPnl:+totalPnl.toFixed(5),avgWin:wins.length?+(winPnl/wins.length).toFixed(5):0,avgLoss:losses.length?+(lossPnl/losses.length).toFixed(5):0,profitFactor:lossPnl<0?+(-winPnl/lossPnl).toFixed(2):null,maxDD:+maxDD.toFixed(5)}};
}

function optimizeTPSL(candles,weights){
  const candidates=[{tp:1.0,sl:0.5},{tp:1.5,sl:0.5},{tp:2.0,sl:0.5},{tp:1.0,sl:1.0},{tp:1.5,sl:1.0},{tp:2.0,sl:1.0},{tp:1.5,sl:1.5},{tp:2.0,sl:1.5},{tp:2.5,sl:1.0}];
  let best=null,bestScore=-Infinity;
  candidates.forEach(({tp,sl})=>{
    const res=runBacktest(candles,tp,sl,weights);
    if(!res?.stats) return;
    const s=res.stats,score=s.winRate*0.4+(s.profitFactor||0)*30+s.totalPnl*10;
    if(score>bestScore){bestScore=score;best={tp,sl,stats:s};}
  });
  return best;
}

async function sendAlertEmail(signalData,latestCandle){
  if(!window.emailjs){
    await new Promise((resolve,reject)=>{const s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js";s.onload=resolve;s.onerror=reject;document.head.appendChild(s);});
    window.emailjs.init({publicKey:EJS_PUBLIC});
  }
  return window.emailjs.send(EJS_SERVICE,EJS_TEMPLATE,{
    to_email:ALERT_EMAIL,
    subject:`【MXN/JPY ${signalData.signal}】${signalData.quality?.label} ¥${latestCandle.close.toFixed(5)} TP:¥${signalData.tp??"—"} SL:¥${signalData.sl??"—"}`,
    signal:signalData.signal,score:`${signalData.score>0?"+":""}${signalData.score} / ${signalData.maxScore?.toFixed(1)}`,
    price:`¥${latestCandle.close.toFixed(5)}`,high:`¥${latestCandle.high.toFixed(5)}`,low:`¥${latestCandle.low.toFixed(5)}`,
    entry:signalData.entry?`¥${signalData.entry}`:"—",tp:signalData.tp?`¥${signalData.tp}`:"—",sl:signalData.sl?`¥${signalData.sl}`:"—",
    rr:signalData.rr?`1 : ${signalData.rr}`:"—",atr:`${signalData.atr??"—"}`,
    rsi:latestCandle.rsi!=null?`${latestCandle.rsi.toFixed(1)}`:"—",
    macd_hist:latestCandle.macdHist!=null?`${latestCandle.macdHist.toFixed(5)}`:"—",
    reasons:signalData.reasons.join(" / "),sent_at:new Date().toLocaleString("ja-JP"),
  });
}

async function fetchAIComment(signalData,latestCandle,btStats,weights){
  const wStr=Object.entries(weights).map(([k,v])=>`${k}:${v}`).join(", ");
  const prompt=`あなたはFXデイトレードのアナリストです。MXN/JPY データを分析し日本語で簡潔なコメントを提供してください。\n\n価格: ¥${latestCandle.close.toFixed(5)}\nシグナル: ${signalData.signal}（${signalData.score}/${signalData.maxScore?.toFixed(1)} 品質:${signalData.quality?.label}）\n${signalData.entry?`TP: ¥${signalData.tp} / SL: ¥${signalData.sl} / RR: 1:${signalData.rr}`:"WAIT"}\n根拠: ${signalData.reasons.join(", ")}\nパターン: ${signalData.pattern?.name??"なし"}\n学習済み重み: ${wStr}\n${btStats?`勝率: ${btStats.winRate}% / PF: ${btStats.profitFactor??"N/A"}`:""}\n\n以下の構成で300文字以内で回答:\n1. **相場状況**\n2. **注目ポイント**\n3. **トレード方針**\n⚠投資判断は自己責任です。`;
  const res=await fetch("/api/ai",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:CLAUDE_MODEL,max_tokens:1000,messages:[{role:"user",content:prompt}]})});
  const data=await res.json();
  if(data.error) throw new Error(data.error);
  if(!data.content?.[0]?.text) throw new Error("レスポンス異常");
  return data.content[0].text;
}

function enrichData(candles,weights,btParams){
  const ind=computeAllIndicators(candles);
  const last80=candles.slice(-80);
  const off=candles.length-80;
  return {
    chartData:last80.map((c,i)=>{const gi=off+i;return{...c,ema9:ind.ema9[gi],ema21:ind.ema21[gi],rsi:ind.rsi[gi],macdHist:ind.macdH[gi],macdLine:ind.macdL[gi],macdSignal:ind.macdS[gi],bbUpper:ind.bb[gi]?.upper,bbMid:ind.bb[gi]?.mid,bbLower:ind.bb[gi]?.lower,stochK:ind.stochK[gi],stochD:ind.stochD[gi],atr:ind.atr[gi],vwap:ind.vwap[gi],pattern:ind.patterns[gi]};}),
    signal:buildLatestSignal(candles,ind,weights,btParams),ind,
  };
}

export default function App() {
  const [allCandles,   setAllCandles]   = useState([]);
  const [enriched,     setEnriched]     = useState(null);
  const [panel,        setPanel]        = useState("rsi");
  const [activeTab,    setActiveTab]    = useState("chart");
  const [lastUpdate,   setLastUpdate]   = useState(null);
  const [isLive,       setIsLive]       = useState(false);
  const [statusMsg,    setStatusMsg]    = useState("読み込み中...");
  const [isReal,       setIsReal]       = useState(false);
  const [signalLog,    setSignalLog]    = useState([]);
  const [aiComment,    setAiComment]    = useState("");
  const [aiLoading,    setAiLoading]    = useState(false);
  const [btResult,     setBtResult]     = useState(null);
  const [btLoading,    setBtLoading]    = useState(false);
  const [btParams,     setBtParams]     = useState({tp:1.5,sl:1.0});
  const [alertStatus,  setAlertStatus]  = useState("");
  const [alertEnabled, setAlertEnabled] = useState(true);
  const [timeframe,    setTimeframe]    = useState("15m");
  const [weights,      setWeights]      = useState(()=>loadWeights());
  const [storedTrades, setStoredTrades] = useState(()=>loadTrades());
  const [optResult,    setOptResult]    = useState(null);
  const [optLoading,   setOptLoading]   = useState(false);
  const [learnCount,   setLearnCount]   = useState(()=>loadTrades().length);
  const prevSignal = useRef(null);

  const learnFromBT = useCallback((btTrades)=>{
    if(!btTrades?.length) return;
    const merged=[...storedTrades,...btTrades].slice(-500);
    saveTrades(merged);setStoredTrades(merged);setLearnCount(merged.length);
    const newW=learnFromTrades(merged,weights);saveWeights(newW);setWeights(newW);
  },[storedTrades,weights]);

  const refresh = useCallback(async()=>{
    setStatusMsg("データ取得中...");
    let candles,real=false;
    try{candles=await fetchRealData(timeframe);real=true;setStatusMsg("Yahoo Finance リアルデータ");}
    catch(e){candles=generateMockCandles(300);setStatusMsg("モックデータ（"+e.message+"）");}
    setAllCandles(candles);
    const en=enrichData(candles,weights,btParams);
    setEnriched(en);setIsReal(real);setLastUpdate(new Date());
    const sig=en.signal;
    if(sig.signal!=="WAIT"&&sig.signal!==prevSignal.current){
      const lat=candles[candles.length-1];
      setSignalLog(prev=>[{time:new Date().toLocaleTimeString("ja-JP"),signal:sig.signal,color:sig.color,entry:sig.entry,tp:sig.tp,sl:sig.sl,rr:sig.rr,score:sig.score,maxScore:sig.maxScore,quality:sig.quality,reasons:sig.reasons,pattern:sig.pattern?.name,contributions:sig.contributions},...prev].slice(0,20));
      prevSignal.current=sig.signal;
      if(alertEnabled){
        setAlertStatus("📧 メール送信中...");
        try{await sendAlertEmail(sig,lat);setAlertStatus(`✅ ${ALERT_EMAIL} に送信完了`);}
        catch(e){setAlertStatus("⚠ 送信失敗: "+e.message);}
        setTimeout(()=>setAlertStatus(""),6000);
      }
    }
  },[alertEnabled,timeframe,weights,btParams]);

  const runBT = useCallback(async()=>{
    if(allCandles.length<50) return;
    setBtLoading(true);await new Promise(r=>setTimeout(r,50));
    const res=runBacktest(allCandles,btParams.tp,btParams.sl,weights);
    setBtResult(res);if(res?.trades?.length) learnFromBT(res.trades);
    setBtLoading(false);
  },[allCandles,btParams,weights,learnFromBT]);

  const runOpt = useCallback(async()=>{
    if(allCandles.length<50) return;
    setOptLoading(true);await new Promise(r=>setTimeout(r,50));
    const best=optimizeTPSL(allCandles,weights);
    setOptResult(best);if(best) setBtParams({tp:best.tp,sl:best.sl});
    setOptLoading(false);
  },[allCandles,weights]);

  const fetchAI = useCallback(async()=>{
    if(!enriched) return;
    setAiLoading(true);setAiComment("");
    try{const lat=enriched.chartData[enriched.chartData.length-1];const comment=await fetchAIComment(enriched.signal,lat,btResult?.stats||null,weights);setAiComment(comment);}
    catch(e){setAiComment("取得失敗: "+e.message);}
    setAiLoading(false);
  },[enriched,btResult,weights]);

  const resetWeights = useCallback(()=>{
    if(!window.confirm("学習データをリセットしますか？")) return;
    saveWeights({...DEFAULT_WEIGHTS});saveTrades([]);
    setWeights({...DEFAULT_WEIGHTS});setStoredTrades([]);setLearnCount(0);
  },[]);

  useEffect(()=>{refresh();},[refresh]);
  useEffect(()=>{if(!isLive)return;const ms=TF_CONFIG[timeframe]?.liveMs??15*60*1000;const id=setInterval(refresh,ms);return()=>clearInterval(id);},[isLive,refresh,timeframe]);
  useEffect(()=>{if(allCandles.length>0)setEnriched(enrichData(allCandles,weights,btParams));},[weights,btParams]);

  if(!enriched) return(<div style={{background:"#0a0e1a",minHeight:"100vh",color:"#94a3b8",fontFamily:"monospace",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>{statusMsg}</div>);

  const{chartData,signal}=enriched;
  const lat=chartData[chartData.length-1],prev=chartData[chartData.length-2];
  const diff=lat.close-prev.close,pct=((diff/prev.close)*100).toFixed(3);
  const pMin=Math.min(...chartData.map(d=>d.low))-0.02,pMax=Math.max(...chartData.map(d=>d.high))+0.02;
  const radarData=Object.entries(weights).map(([key,val])=>({indicator:key.toUpperCase(),weight:+val.toFixed(2),fullMark:4}));

  const Tab=({id,label})=>(<button onClick={()=>setActiveTab(id)} style={{background:activeTab===id?"#1e3a5f":"transparent",border:`1px solid ${activeTab===id?"#0ea5e9":"#1e293b"}`,color:activeTab===id?"#e2e8f0":"#475569",borderRadius:8,padding:"7px 12px",cursor:"pointer",fontSize:11,fontFamily:"inherit",fontWeight:activeTab===id?700:400,whiteSpace:"nowrap"}}>{label}</button>);

  return(
    <div style={{background:"#0a0e1a",minHeight:"100vh",color:"#e2e8f0",fontFamily:"'JetBrains Mono','Courier New',monospace"}}>

      <div style={{background:"linear-gradient(90deg,#0f172a,#1e293b)",borderBottom:"1px solid #1e3a5f",padding:"12px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <div style={{background:"linear-gradient(135deg,#0ea5e9,#6366f1)",borderRadius:8,padding:"6px 14px",fontSize:13,fontWeight:700,letterSpacing:2,color:"#fff"}}>MXN/JPY</div>
          <div>
            <div style={{display:"flex",alignItems:"baseline",gap:8}}>
              <span style={{fontSize:24,fontWeight:700,color:"#f1f5f9"}}>¥{lat.close.toFixed(5)}</span>
              <span style={{fontSize:13,color:diff>=0?"#10b981":"#ef4444"}}>{diff>=0?"▲":"▼"}{Math.abs(diff).toFixed(5)} ({pct}%)</span>
            </div>
            <div style={{fontSize:11,color:"#64748b"}}>
              {TF_CONFIG[timeframe]?.label} • {allCandles.length}本
              {isReal?<span style={{color:"#10b981",marginLeft:8}}>● REAL</span>:<span style={{color:"#f59e0b",marginLeft:8}}>⚠ MOCK</span>}
              <span style={{color:"#6366f1",marginLeft:8}}>🧠 {learnCount}件学習済み</span>
            </div>
          </div>
        </div>

        <div style={{background:signal.color+"22",border:`2px solid ${signal.color}`,borderRadius:10,padding:"8px 20px",textAlign:"center",minWidth:140}}>
          <div style={{fontSize:24,fontWeight:900,color:signal.color,letterSpacing:3}}>{signal.signal}</div>
          <div style={{fontSize:11,color:signal.quality?.color,fontWeight:700}}>{signal.quality?.stars} {signal.quality?.label}シグナル</div>
          <div style={{fontSize:10,color:"#64748b"}}>{signal.score>0?"+":""}{signal.score} / {signal.maxScore?.toFixed(1)}</div>
        </div>

        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          <div style={{display:"flex",gap:4}}>
            {Object.entries(TF_CONFIG).map(([key,cfg])=>(<button key={key} onClick={()=>{setTimeframe(key);setBtResult(null);}} style={{background:timeframe===key?"#1e3a5f":"#0f172a",border:`1px solid ${timeframe===key?"#0ea5e9":"#334155"}`,color:timeframe===key?"#0ea5e9":"#64748b",borderRadius:6,padding:"5px 8px",cursor:"pointer",fontSize:10,fontFamily:"inherit"}}>{cfg.label}</button>))}
          </div>
          <button onClick={refresh} style={{background:"#1e293b",border:"1px solid #334155",color:"#94a3b8",borderRadius:6,padding:"6px 10px",cursor:"pointer",fontSize:11,fontFamily:"inherit"}}>↻</button>
          <button onClick={()=>setIsLive(v=>!v)} style={{background:isLive?"#10b98122":"#1e293b",border:`1px solid ${isLive?"#10b981":"#334155"}`,color:isLive?"#10b981":"#64748b",borderRadius:6,padding:"6px 10px",cursor:"pointer",fontSize:11,fontFamily:"inherit"}}>● LIVE</button>
          <button onClick={()=>setAlertEnabled(v=>!v)} style={{background:alertEnabled?"#6366f122":"#1e293b",border:`1px solid ${alertEnabled?"#6366f1":"#334155"}`,color:alertEnabled?"#818cf8":"#64748b",borderRadius:6,padding:"6px 10px",cursor:"pointer",fontSize:11,fontFamily:"inherit"}}>🔔</button>
        </div>
      </div>

      {alertStatus&&(<div style={{background:"#1e293b",borderBottom:"1px solid #334155",padding:"8px 20px",fontSize:12,color:"#a5b4fc",textAlign:"center"}}>{alertStatus}</div>)}

      <div style={{padding:"12px 16px"}}>

        <div style={{background:"#0f172a",border:"1px solid #1e3a5f",borderRadius:10,padding:"10px 14px",marginBottom:10,display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
          <span style={{fontSize:11,color:"#64748b",flexShrink:0}}>判定根拠:</span>
          {signal.reasons.map((r,i)=>(<span key={i} style={{background:"#1e293b",border:"1px solid #334155",borderRadius:4,padding:"2px 8px",fontSize:11,color:r.includes("↑")||r.includes("期待")||r.includes("ゴールデン")||r.includes("売られ")||r.includes("上方")?"#10b981":r.includes("↓")||r.includes("デッド")||r.includes("買われ")||r.includes("下方")?"#ef4444":"#f59e0b"}}>{r}</span>))}
          {signal.pattern?.name&&(<span style={{background:"#312e81",border:"1px solid #6366f1",borderRadius:4,padding:"2px 8px",fontSize:11,color:"#a5b4fc"}}>📊 {signal.pattern.name}</span>)}
        </div>

        {signal.signal!=="WAIT"&&(
          <div style={{background:"#0f172a",border:`1px solid ${signal.color}44`,borderRadius:10,padding:"12px 16px",marginBottom:10}}>
            <div style={{fontSize:11,color:"#64748b",marginBottom:8}}>▶ エントリー計画（ATR={signal.atr} / TP×{btParams.tp} SL×{btParams.sl}）</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
              {[{l:"エントリー",v:`¥${signal.entry?.toFixed(5)}`,c:"#e2e8f0"},{l:"利確 TP",v:`¥${signal.tp?.toFixed(5)}`,c:"#10b981"},{l:"損切 SL",v:`¥${signal.sl?.toFixed(5)}`,c:"#ef4444"},{l:"RR比",v:`1 : ${signal.rr}`,c:"#f59e0b"}].map(({l,v,c})=>(<div key={l} style={{background:"#0a0e1a",border:"1px solid #1e293b",borderRadius:8,padding:"8px",textAlign:"center"}}><div style={{fontSize:10,color:"#475569",marginBottom:3}}>{l}</div><div style={{fontSize:12,fontWeight:700,color:c}}>{v}</div></div>))}
            </div>
          </div>
        )}

        <div style={{display:"flex",gap:6,marginBottom:12,overflowX:"auto",paddingBottom:2}}>
          <Tab id="chart" label="📈 チャート"/>
          <Tab id="backtest" label={`🧪 バックテスト${btResult?` (${btResult.stats?.winRate}%)`:""}` }/>
          <Tab id="learn" label={`🧠 自己学習 (${learnCount})`}/>
          <Tab id="history" label={`📋 履歴${signalLog.length>0?` (${signalLog.length})`:""}`}/>
          <Tab id="ai" label="🤖 AI解説"/>
        </div>

        {activeTab==="chart"&&(<>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:10}}>
            {[{l:"始値",v:lat.open},{l:"高値",v:lat.high,c:"#10b981"},{l:"安値",v:lat.low,c:"#ef4444"},{l:"終値",v:lat.close,c:diff>=0?"#10b981":"#ef4444"}].map(({l,v,c})=>(<div key={l} style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:8,padding:"8px 10px"}}><div style={{fontSize:10,color:"#475569",marginBottom:2}}>{l}</div><div style={{fontSize:12,fontWeight:700,color:c||"#94a3b8"}}>{v.toFixed(5)}</div></div>))}
          </div>
          <div style={{background:"#0f172a",border:"1px solid #1e3a5f",borderRadius:10,padding:"10px 4px 0",marginBottom:8}}>
            <div style={{fontSize:11,color:"#64748b",paddingLeft:16,marginBottom:4}}>価格 EMA9<span style={{color:"#f59e0b"}}> ━ </span>EMA21<span style={{color:"#818cf8"}}> ━ </span>VWAP<span style={{color:"#06b6d4"}}> ╌ </span>BB<span style={{color:"#334155"}}> ░</span></div>
            <ResponsiveContainer width="100%" height={210}>
              <ComposedChart data={chartData} margin={{top:4,right:8,left:-10,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/>
                <XAxis dataKey="time" tick={{fontSize:10,fill:"#475569"}} interval={9}/>
                <YAxis domain={[pMin,pMax]} tick={{fontSize:10,fill:"#475569"}} tickFormatter={v=>v.toFixed(3)} width={58}/>
                <Tooltip contentStyle={{background:"#0f172a",border:"1px solid #334155",borderRadius:8,fontSize:11}} formatter={(v,n)=>[typeof v==="number"?v.toFixed(5):v,n]}/>
                <Area dataKey="bbUpper" stroke="none" fill="#1e3a5f" fillOpacity={0.3}/>
                <Area dataKey="bbLower" stroke="none" fill="#0f172a" fillOpacity={1}/>
                <Line dataKey="bbUpper" stroke="#1e3a5f" strokeWidth={1} dot={false}/>
                <Line dataKey="bbMid" stroke="#334155" strokeWidth={1} dot={false} strokeDasharray="4 2"/>
                <Line dataKey="bbLower" stroke="#1e3a5f" strokeWidth={1} dot={false}/>
                <Line dataKey="ema9" stroke="#f59e0b" strokeWidth={1.5} dot={false}/>
                <Line dataKey="ema21" stroke="#818cf8" strokeWidth={1.5} dot={false}/>
                <Line dataKey="vwap" stroke="#06b6d4" strokeWidth={1.5} dot={false} strokeDasharray="6 3"/>
                <Line dataKey="close" stroke="#94a3b8" strokeWidth={1} dot={false}/>
                {signal.tp&&<ReferenceLine y={signal.tp} stroke="#10b98188" strokeDasharray="6 3" label={{value:"TP",fill:"#10b981",fontSize:10,position:"right"}}/>}
                {signal.sl&&<ReferenceLine y={signal.sl} stroke="#ef444488" strokeDasharray="6 3" label={{value:"SL",fill:"#ef4444",fontSize:10,position:"right"}}/>}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div style={{background:"#0f172a",border:"1px solid #1e3a5f",borderRadius:10,padding:"4px 4px 0",marginBottom:8,height:56}}>
            <ResponsiveContainer width="100%" height={50}><ComposedChart data={chartData} margin={{top:0,right:8,left:-10,bottom:0}}><XAxis hide/><YAxis hide/><Bar dataKey="volume" fill="#1e40af" opacity={0.7} radius={[1,1,0,0]}/></ComposedChart></ResponsiveContainer>
          </div>
          <div style={{display:"flex",gap:6,marginBottom:6}}>
            {["rsi","macd","stoch"].map(p=>(<button key={p} onClick={()=>setPanel(p)} style={{background:panel===p?"#1e3a5f":"#0f172a",border:`1px solid ${panel===p?"#0ea5e9":"#1e293b"}`,color:panel===p?"#0ea5e9":"#475569",borderRadius:6,padding:"4px 12px",cursor:"pointer",fontSize:11,fontFamily:"inherit",textTransform:"uppercase",letterSpacing:1}}>{p}</button>))}
          </div>
          {panel==="rsi"&&(<div style={{background:"#0f172a",border:"1px solid #1e3a5f",borderRadius:10,padding:"8px 4px 0"}}><div style={{fontSize:11,color:"#64748b",paddingLeft:16,marginBottom:2}}>RSI(14): <span style={{color:(lat.rsi??50)>65?"#ef4444":(lat.rsi??50)<35?"#10b981":"#94a3b8"}}>{lat.rsi?.toFixed(1)??"—"}</span></div><ResponsiveContainer width="100%" height={100}><ComposedChart data={chartData} margin={{top:4,right:8,left:-10,bottom:0}}><CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/><XAxis dataKey="time" tick={{fontSize:9,fill:"#475569"}} interval={9}/><YAxis domain={[0,100]} tick={{fontSize:9,fill:"#475569"}} width={35}/><ReferenceLine y={70} stroke="#ef444466" strokeDasharray="4 2"/><ReferenceLine y={30} stroke="#10b98166" strokeDasharray="4 2"/><Line dataKey="rsi" stroke="#a78bfa" strokeWidth={1.5} dot={false}/><Tooltip contentStyle={{background:"#0f172a",border:"1px solid #334155",fontSize:11}} formatter={v=>[v?.toFixed(1),"RSI"]}/></ComposedChart></ResponsiveContainer></div>)}
          {panel==="macd"&&(<div style={{background:"#0f172a",border:"1px solid #1e3a5f",borderRadius:10,padding:"8px 4px 0"}}><div style={{fontSize:11,color:"#64748b",paddingLeft:16,marginBottom:2}}>MACD ヒスト: <span style={{color:(lat.macdHist??0)>0?"#10b981":"#ef4444"}}>{lat.macdHist?.toFixed(5)??"—"}</span></div><ResponsiveContainer width="100%" height={100}><ComposedChart data={chartData} margin={{top:4,right:8,left:-10,bottom:0}}><CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/><XAxis dataKey="time" tick={{fontSize:9,fill:"#475569"}} interval={9}/><YAxis tick={{fontSize:9,fill:"#475569"}} width={52} tickFormatter={v=>v.toFixed(4)}/><ReferenceLine y={0} stroke="#334155"/><Bar dataKey="macdHist" opacity={0.8} radius={[1,1,0,0]}>{chartData.map((_,i)=><Cell key={i} fill={(chartData[i].macdHist??0)>0?"#10b981":"#ef4444"}/>)}</Bar><Line dataKey="macdLine" stroke="#0ea5e9" strokeWidth={1.5} dot={false}/><Line dataKey="macdSignal" stroke="#f59e0b" strokeWidth={1.5} dot={false}/><Tooltip contentStyle={{background:"#0f172a",border:"1px solid #334155",fontSize:11}} formatter={(v,n)=>[v?.toFixed(5),n]}/></ComposedChart></ResponsiveContainer></div>)}
          {panel==="stoch"&&(<div style={{background:"#0f172a",border:"1px solid #1e3a5f",borderRadius:10,padding:"8px 4px 0"}}><div style={{fontSize:11,color:"#64748b",paddingLeft:16,marginBottom:2}}>Stoch %K:<span style={{color:"#10b981"}}> {lat.stochK?.toFixed(1)??"—"}</span> %D:<span style={{color:"#f59e0b"}}> {lat.stochD?.toFixed(1)??"—"}</span></div><ResponsiveContainer width="100%" height={100}><ComposedChart data={chartData} margin={{top:4,right:8,left:-10,bottom:0}}><CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/><XAxis dataKey="time" tick={{fontSize:9,fill:"#475569"}} interval={9}/><YAxis domain={[0,100]} tick={{fontSize:9,fill:"#475569"}} width={35}/><ReferenceLine y={80} stroke="#ef444466" strokeDasharray="4 2"/><ReferenceLine y={20} stroke="#10b98166" strokeDasharray="4 2"/><Line dataKey="stochK" stroke="#10b981" strokeWidth={1.5} dot={false}/><Line dataKey="stochD" stroke="#f59e0b" strokeWidth={1.5} dot={false}/><Tooltip contentStyle={{background:"#0f172a",border:"1px solid #334155",fontSize:11}} formatter={(v,n)=>[v?.toFixed(1),n]}/></ComposedChart></ResponsiveContainer></div>)}
        </>)}

        {activeTab==="backtest"&&(
          <div>
            <div style={{background:"#0f172a",border:"1px solid #1e3a5f",borderRadius:10,padding:"14px 16px",marginBottom:12}}>
              <div style={{fontSize:11,color:"#64748b",marginBottom:10}}>パラメーター設定</div>
              <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"flex-end"}}>
                <div><div style={{fontSize:10,color:"#475569",marginBottom:4}}>TP倍率（ATR×）</div><input type="number" value={btParams.tp} step={0.1} min={0.5} max={5} onChange={e=>setBtParams(p=>({...p,tp:+e.target.value}))} style={{background:"#0a0e1a",border:"1px solid #334155",color:"#e2e8f0",borderRadius:6,padding:"6px 10px",fontSize:13,width:80,fontFamily:"inherit"}}/></div>
                <div><div style={{fontSize:10,color:"#475569",marginBottom:4}}>SL倍率（ATR×）</div><input type="number" value={btParams.sl} step={0.1} min={0.1} max={3} onChange={e=>setBtParams(p=>({...p,sl:+e.target.value}))} style={{background:"#0a0e1a",border:"1px solid #334155",color:"#e2e8f0",borderRadius:6,padding:"6px 10px",fontSize:13,width:80,fontFamily:"inherit"}}/></div>
                <button onClick={runBT} disabled={btLoading} style={{background:btLoading?"#1e293b":"linear-gradient(135deg,#0ea5e9,#6366f1)",border:"none",color:btLoading?"#475569":"#fff",borderRadius:8,padding:"8px 16px",cursor:btLoading?"not-allowed":"pointer",fontSize:12,fontFamily:"inherit",fontWeight:600}}>{btLoading?"実行中...":"▶ バックテスト"}</button>
                <button onClick={runOpt} disabled={optLoading} style={{background:optLoading?"#1e293b":"#0f172a",border:"1px solid #f59e0b",color:optLoading?"#475569":"#f59e0b",borderRadius:8,padding:"8px 16px",cursor:optLoading?"not-allowed":"pointer",fontSize:12,fontFamily:"inherit"}}>{optLoading?"最適化中...":"✨ TP/SL自動最適化"}</button>
              </div>
              {optResult&&(<div style={{marginTop:10,background:"#0a0e1a",borderRadius:8,padding:"10px 12px",fontSize:12,color:"#f59e0b"}}>✨ 最適 → TP×{optResult.tp} / SL×{optResult.sl}（勝率:{optResult.stats.winRate}% / PF:{optResult.stats.profitFactor??"N/A"}）を自動適用</div>)}
            </div>
            {btResult?.stats&&(<>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:12}}>
                {[{l:"総トレード",v:btResult.stats.total,c:"#e2e8f0"},{l:"勝率",v:`${btResult.stats.winRate}%`,c:btResult.stats.winRate>=50?"#10b981":"#ef4444"},{l:"PF",v:btResult.stats.profitFactor??"N/A",c:(btResult.stats.profitFactor??0)>=1.3?"#10b981":(btResult.stats.profitFactor??0)>=1?"#f59e0b":"#ef4444"},{l:"勝/敗/TO",v:`${btResult.stats.wins}/${btResult.stats.losses}/${btResult.stats.timeouts}`,c:"#94a3b8"},{l:"累計損益",v:`${btResult.stats.totalPnl>0?"+":""}${btResult.stats.totalPnl}`,c:btResult.stats.totalPnl>0?"#10b981":"#ef4444"},{l:"最大DD",v:`${btResult.stats.maxDD}`,c:"#ef4444"}].map(({l,v,c})=>(<div key={l} style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:8,padding:"10px 12px"}}><div style={{fontSize:10,color:"#475569",marginBottom:3}}>{l}</div><div style={{fontSize:13,fontWeight:700,color:c}}>{v}</div></div>))}
              </div>
              <div style={{background:"#0f172a",border:"1px solid #1e3a5f",borderRadius:10,padding:"10px 4px 0",marginBottom:12}}>
                <div style={{fontSize:11,color:"#64748b",paddingLeft:16,marginBottom:4}}>エクイティカーブ</div>
                <ResponsiveContainer width="100%" height={130}><ComposedChart data={btResult.equityCurve} margin={{top:4,right:8,left:-10,bottom:0}}><CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/><XAxis dataKey="label" hide/><YAxis tick={{fontSize:9,fill:"#475569"}} width={55} tickFormatter={v=>v.toFixed(4)}/><ReferenceLine y={0} stroke="#334155"/><Area dataKey="equity" stroke="#0ea5e9" fill="#0ea5e922" strokeWidth={2}/><Tooltip contentStyle={{background:"#0f172a",border:"1px solid #334155",fontSize:11}} formatter={v=>[v?.toFixed(5),"累計損益"]}/></ComposedChart></ResponsiveContainer>
              </div>
              <div style={{background:"#0f172a",border:"1px solid #1e3a5f",borderRadius:10,padding:"12px",marginBottom:12}}>
                <div style={{fontSize:11,color:"#64748b",marginBottom:8}}>トレード一覧（最新20件）</div>
                <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}><thead><tr style={{color:"#475569"}}>{["日時","方向","エントリー","TP","SL","決済","損益","結果"].map(h=>(<th key={h} style={{textAlign:"left",padding:"4px 8px",borderBottom:"1px solid #1e293b"}}>{h}</th>))}</tr></thead><tbody>{btResult.trades.slice(-20).reverse().map((t,i)=>(<tr key={i} style={{borderBottom:"1px solid #0f172a"}}><td style={{padding:"4px 8px",color:"#64748b"}}>{t.time}</td><td style={{padding:"4px 8px",color:t.signal==="BUY"?"#10b981":"#ef4444",fontWeight:700}}>{t.signal}</td><td style={{padding:"4px 8px",color:"#94a3b8"}}>{t.entry}</td><td style={{padding:"4px 8px",color:"#10b981"}}>{t.tp}</td><td style={{padding:"4px 8px",color:"#ef4444"}}>{t.sl}</td><td style={{padding:"4px 8px",color:"#94a3b8"}}>{t.exitPrice}</td><td style={{padding:"4px 8px",color:t.pnl>0?"#10b981":"#ef4444",fontWeight:700}}>{t.pnl>0?"+":""}{t.pnl}</td><td style={{padding:"4px 8px",color:t.result==="WIN"?"#10b981":t.result==="LOSS"?"#ef4444":"#f59e0b"}}>{t.result}</td></tr>))}</tbody></table></div>
              </div>
            </>)}
            {!btResult&&!btLoading&&(<div style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:10,padding:"40px",textAlign:"center",color:"#334155",fontSize:13}}>「▶ バックテスト」を押してください</div>)}
          </div>
        )}

        {activeTab==="learn"&&(
          <div>
            <div style={{background:"#0f172a",border:"1px solid #1e3a5f",borderRadius:10,padding:"16px",marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                <div><div style={{fontSize:13,color:"#e2e8f0",fontWeight:700}}>🧠 自己学習エンジン</div><div style={{fontSize:11,color:"#64748b",marginTop:3}}>バックテスト結果から指標の有効性を学習し重みを自動調整</div></div>
                <div style={{textAlign:"right"}}><div style={{fontSize:11,color:"#6366f1"}}>学習済みトレード</div><div style={{fontSize:22,fontWeight:700,color:"#818cf8"}}>{learnCount}</div></div>
              </div>
              <div style={{background:"#0a0e1a",borderRadius:10,padding:"8px",marginBottom:14}}>
                <div style={{fontSize:11,color:"#64748b",marginBottom:4,paddingLeft:8}}>指標の重み分布（レーダーチャート）</div>
                <ResponsiveContainer width="100%" height={200}>
                  <RadarChart data={radarData} margin={{top:10,right:30,bottom:10,left:30}}>
                    <PolarGrid stroke="#1e293b"/>
                    <PolarAngleAxis dataKey="indicator" tick={{fill:"#475569",fontSize:10}}/>
                    <Radar dataKey="weight" stroke="#0ea5e9" fill="#0ea5e9" fillOpacity={0.3}/>
                    <Tooltip contentStyle={{background:"#0f172a",border:"1px solid #334155",fontSize:11}} formatter={v=>[v,"重み"]}/>
                  </RadarChart>
                </ResponsiveContainer>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:8,marginBottom:12}}>
                {Object.entries(weights).map(([key,val])=>{const def=DEFAULT_WEIGHTS[key],diff=+(val-def).toFixed(3);return(<div key={key} style={{background:"#0a0e1a",border:"1px solid #1e293b",borderRadius:8,padding:"10px 12px"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><span style={{fontSize:11,color:"#94a3b8",textTransform:"uppercase"}}>{key}</span><span style={{fontSize:11,color:diff>0?"#10b981":diff<0?"#ef4444":"#475569"}}>{diff>0?`+${diff}`:diff===0?"初期値":diff}</span></div><div style={{display:"flex",alignItems:"center",gap:8,marginTop:6}}><div style={{flex:1,background:"#1e293b",borderRadius:4,height:6}}><div style={{width:`${Math.min(val/4*100,100)}%`,background:"#0ea5e9",borderRadius:4,height:"100%",transition:"width .3s"}}/></div><span style={{fontSize:13,fontWeight:700,color:"#e2e8f0",minWidth:32}}>{val}</span></div></div>);})}
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <button onClick={runBT} disabled={btLoading||allCandles.length<50} style={{background:"linear-gradient(135deg,#0ea5e9,#6366f1)",border:"none",color:"#fff",borderRadius:8,padding:"8px 16px",cursor:"pointer",fontSize:12,fontFamily:"inherit",fontWeight:600}}>🧪 バックテストして学習</button>
                <button onClick={resetWeights} style={{background:"transparent",border:"1px solid #ef4444",color:"#ef4444",borderRadius:8,padding:"8px 16px",cursor:"pointer",fontSize:12,fontFamily:"inherit"}}>↺ 学習リセット</button>
              </div>
              <div style={{marginTop:10,fontSize:11,color:"#334155"}}>※ バックテスト実行のたびに結果を蓄積し、勝ちトレードで使われた指標の重みを増加、負けで減少させます。localStorageに保存されます。</div>
            </div>
          </div>
        )}

        {activeTab==="history"&&(
          <div>
            {signalLog.length===0?(<div style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:10,padding:"40px",textAlign:"center",color:"#334155",fontSize:13}}>まだシグナルが記録されていません</div>)
            :signalLog.map((log,i)=>(<div key={i} style={{background:"#0f172a",border:`1px solid ${log.color}33`,borderRadius:10,padding:"12px 14px",marginBottom:8}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}><div style={{display:"flex",alignItems:"center",gap:8}}><span style={{background:log.color+"22",border:`1px solid ${log.color}`,borderRadius:6,padding:"2px 12px",fontSize:13,fontWeight:900,color:log.color,letterSpacing:2}}>{log.signal}</span><span style={{fontSize:11,color:log.quality?.color}}>{log.quality?.stars} {log.quality?.label}</span><span style={{fontSize:11,color:"#64748b"}}>{log.score>0?"+":""}{log.score?.toFixed(1)}</span>{log.pattern&&<span style={{background:"#312e81",borderRadius:4,padding:"1px 6px",fontSize:10,color:"#a5b4fc"}}>{log.pattern}</span>}</div><span style={{fontSize:11,color:"#334155"}}>{log.time}</span></div>{log.entry&&(<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:8}}>{[{l:"エントリー",v:`¥${log.entry?.toFixed(5)}`,c:"#e2e8f0"},{l:"TP",v:`¥${log.tp?.toFixed(5)}`,c:"#10b981"},{l:"SL",v:`¥${log.sl?.toFixed(5)}`,c:"#ef4444"},{l:"RR",v:`1:${log.rr}`,c:"#f59e0b"}].map(({l,v,c})=>(<div key={l} style={{background:"#0a0e1a",borderRadius:6,padding:"5px 8px",textAlign:"center"}}><div style={{fontSize:9,color:"#475569",marginBottom:1}}>{l}</div><div style={{fontSize:11,fontWeight:700,color:c}}>{v}</div></div>))}</div>)}<div style={{display:"flex",gap:4,flexWrap:"wrap"}}>{log.reasons.map((r,j)=>(<span key={j} style={{background:"#1e293b",borderRadius:4,padding:"2px 6px",fontSize:10,color:"#64748b"}}>{r}</span>))}</div></div>))}
            {signalLog.length>0&&(<button onClick={()=>setSignalLog([])} style={{background:"transparent",border:"1px solid #334155",color:"#475569",borderRadius:6,padding:"6px 14px",cursor:"pointer",fontSize:11,fontFamily:"inherit",width:"100%",marginTop:4}}>✕ 履歴クリア</button>)}
          </div>
        )}

        {activeTab==="ai"&&(
          <div>
            <div style={{background:"#0f172a",border:"1px solid #1e3a5f",borderRadius:10,padding:"16px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                <div style={{fontSize:12,color:"#64748b"}}>Claude AIによる相場解説 <span style={{color:"#6366f1"}}>（学習済み重みを反映）</span></div>
                <button onClick={fetchAI} disabled={aiLoading} style={{background:aiLoading?"#1e293b":"linear-gradient(135deg,#0ea5e9,#6366f1)",border:"none",color:aiLoading?"#475569":"#fff",borderRadius:8,padding:"8px 16px",cursor:aiLoading?"not-allowed":"pointer",fontSize:12,fontFamily:"inherit",fontWeight:600}}>{aiLoading?"分析中...":"🤖 解説を取得"}</button>
              </div>
              <div style={{background:"#0a0e1a",borderRadius:8,padding:"10px 12px",marginBottom:12,display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:6}}>
                {[{l:"現在値",v:`¥${lat.close.toFixed(5)}`},{l:"シグナル",v:`${signal.signal} ${signal.quality?.label}`,c:signal.color},...(btResult?.stats?[{l:"勝率",v:`${btResult.stats.winRate}%`,c:btResult.stats.winRate>=50?"#10b981":"#ef4444"},{l:"PF",v:`${btResult.stats.profitFactor??"—"}`,c:"#f59e0b"}]:[])].map(({l,v,c})=>(<div key={l} style={{display:"flex",justifyContent:"space-between"}}><span style={{fontSize:11,color:"#475569"}}>{l}</span><span style={{fontSize:11,fontWeight:700,color:c||"#94a3b8"}}>{v}</span></div>))}
              </div>
              {aiLoading&&(<div style={{textAlign:"center",padding:"30px",color:"#475569",fontSize:13}}><div style={{marginBottom:8,fontSize:22}}>⟳</div>Claudeが分析中...</div>)}
              {aiComment&&!aiLoading&&(<div style={{background:"#0a0e1a",borderRadius:8,padding:"14px 16px",borderLeft:"3px solid #0ea5e9",lineHeight:1.9,fontSize:13,color:"#cbd5e1",whiteSpace:"pre-wrap"}}>{aiComment}</div>)}
              {!aiComment&&!aiLoading&&(<div style={{textAlign:"center",padding:"24px",color:"#334155",fontSize:12}}>「🤖 解説を取得」ボタンを押してください</div>)}
            </div>
            <div style={{marginTop:8,fontSize:10,color:"#1e293b",textAlign:"center"}}>⚠ AI解説は参考情報です。投資判断は必ず自己責任で。</div>
          </div>
        )}

        <div style={{marginTop:12,display:"flex",justifyContent:"space-between",fontSize:10,color:"#334155",padding:"0 4px"}}>
          <span>{lastUpdate?`更新: ${lastUpdate.toLocaleTimeString("ja-JP")}`:""}</span>
          <span style={{color:isReal?"#10b98155":"#f59e0b88"}}>{statusMsg}</span>
        </div>
      </div>
    </div>
  );
}
