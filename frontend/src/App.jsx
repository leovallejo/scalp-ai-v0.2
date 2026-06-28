import { useState, useEffect, useCallback, useRef } from 'react'
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell
} from 'recharts'
import {
  Activity, TrendingUp, TrendingDown, Minus, RefreshCw,
  Shield, AlertTriangle, Zap, BarChart2, Target, Layers, Clock
} from 'lucide-react'

const API = '/api'

async function apiFetch(path, body = null) {
  const opts = body
    ? { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }
    : { method:'GET' }
  const r = await fetch(API + path, opts)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

// ─── Primitives ───────────────────────────────────────────────
function Spinner() {
  return <div style={{ width:18,height:18,border:'2px solid #1e2a3a',borderTopColor:'#00d4ff',borderRadius:'50%',animation:'spin 0.7s linear infinite',display:'inline-block' }}/>
}

function StatusDot({ online }) {
  return <span style={{ display:'inline-block',width:7,height:7,borderRadius:'50%',background:online?'var(--green)':'var(--red)',animation:online?'pulse-dot 2s ease infinite':'none',marginRight:5 }}/>
}

function Card({ children, style={}, className='' }) {
  return <div className={`animate-in ${className}`} style={{ background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:10,padding:16,...style }}>{children}</div>
}

function Label({ children, color='var(--text-2)' }) {
  return <span style={{ fontSize:10,fontWeight:600,letterSpacing:'0.08em',textTransform:'uppercase',color,fontFamily:'var(--font-mono)' }}>{children}</span>
}

function SignalBadge({ signal, action }) {
  const cfg = {
    UP:       { bg:'rgba(0,230,118,0.12)',  color:'var(--green)',  icon:<TrendingUp size={13}/> },
    DOWN:     { bg:'rgba(255,61,87,0.12)',   color:'var(--red)',    icon:<TrendingDown size={13}/> },
    NO_TRADE: { bg:'rgba(143,163,188,0.10)',color:'var(--text-2)', icon:<Minus size={13}/> },
    LONG:     { bg:'rgba(0,230,118,0.15)',  color:'var(--green)',  icon:<TrendingUp size={13}/> },
    SHORT:    { bg:'rgba(255,61,87,0.15)',   color:'var(--red)',    icon:<TrendingDown size={13}/> },
  }
  const k = action || signal
  const { bg, color, icon } = cfg[k] || cfg.NO_TRADE
  return <span style={{ display:'inline-flex',alignItems:'center',gap:5,background:bg,color,border:`1px solid ${color}33`,borderRadius:6,padding:'3px 10px',fontSize:12,fontWeight:700,fontFamily:'var(--font-mono)',letterSpacing:'0.05em' }}>{icon}{k}</span>
}

function ConfidenceBar({ value, label='Confidence' }) {
  const pct = Math.round((value||0)*100)
  const color = pct>=70?'var(--green)':pct>=60?'var(--yellow)':'var(--red)'
  return (
    <div>
      <div style={{ display:'flex',justifyContent:'space-between',marginBottom:4 }}>
        <Label>{label}</Label>
        <span style={{ fontFamily:'var(--font-mono)',fontSize:12,color }}>{pct}%</span>
      </div>
      <div style={{ background:'var(--bg-raised)',borderRadius:4,height:6,overflow:'hidden' }}>
        <div style={{ width:`${pct}%`,height:'100%',borderRadius:4,background:color,transition:'width 0.5s ease' }}/>
      </div>
    </div>
  )
}

function ProbaBar({ proba }) {
  const bars = [
    { key:'DOWN',     color:'var(--red)',    label:'↓ DOWN' },
    { key:'NO_TRADE', color:'var(--text-2)', label:'— FLAT' },
    { key:'UP',       color:'var(--green)',  label:'↑ UP' },
  ]
  return (
    <div>
      <Label>Class Probabilities</Label>
      <div style={{ display:'flex',gap:4,marginTop:6 }}>
        {bars.map(({ key, color, label }) => {
          const pct = Math.round((proba?.[key]||0)*100)
          return (
            <div key={key} style={{ flex:1,textAlign:'center' }}>
              <div style={{ background:'var(--bg-raised)',borderRadius:4,height:40,position:'relative',overflow:'hidden',marginBottom:3 }}>
                <div style={{ position:'absolute',bottom:0,left:0,right:0,height:`${pct}%`,background:`${color}33`,borderTop:`2px solid ${color}`,transition:'height 0.5s ease' }}/>
              </div>
              <div style={{ fontFamily:'var(--font-mono)',fontSize:9,color }}>{label}</div>
              <div style={{ fontFamily:'var(--font-mono)',fontSize:10,color:'var(--text-2)' }}>{pct}%</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PriceLevelRow({ label, value, color }) {
  return (
    <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 10px',background:'var(--bg-raised)',borderRadius:6,marginBottom:4 }}>
      <span style={{ fontSize:11,color:'var(--text-2)' }}>{label}</span>
      <span style={{ fontFamily:'var(--font-mono)',fontSize:12,color,fontWeight:600 }}>
        {value!=null?value.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:6}):'—'}
      </span>
    </div>
  )
}

function IndicatorGrid({ indicators }) {
  if (!indicators) return null
  const items = [
    { k:'rsi',               label:'RSI(14)',   color:indicators.rsi>70?'var(--red)':indicators.rsi<30?'var(--green)':'var(--text-1)', fmt:v=>v.toFixed(1) },
    { k:'macd_hist',         label:'MACD',      color:indicators.macd_hist>0?'var(--green)':'var(--red)', fmt:v=>v.toFixed(5) },
    { k:'ema_cross',         label:'EMA×',      color:indicators.ema_cross>0?'var(--green)':'var(--red)', fmt:v=>(v*100).toFixed(2)+'%' },
    { k:'vol_ratio',         label:'Vol Ratio', color:indicators.vol_ratio>1?'var(--cyan)':'var(--text-2)', fmt:v=>v.toFixed(2)+'x' },
    { k:'atr_pct',           label:'ATR%',      color:'var(--yellow)', fmt:v=>v.toFixed(3)+'%' },
    { k:'dist_resistance_pct',label:'→ Res',   color:'var(--orange)', fmt:v=>v.toFixed(2)+'%' },
    { k:'dist_support_pct',  label:'→ Sup',    color:'var(--purple)', fmt:v=>v.toFixed(2)+'%' },
  ]
  return (
    <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:5 }}>
      {items.map(({ k,label,color,fmt }) => (
        <div key={k} style={{ background:'var(--bg-raised)',borderRadius:6,padding:'7px 9px' }}>
          <Label>{label}</Label>
          <div style={{ fontFamily:'var(--font-mono)',fontSize:12,color,marginTop:2,fontWeight:600 }}>
            {indicators[k]!=null?fmt(indicators[k]):'—'}
          </div>
        </div>
      ))}
    </div>
  )
}

function BacktestPanel({ bt }) {
  if (!bt||bt.error) return <div style={{ color:'var(--text-3)',textAlign:'center',padding:20,fontSize:11 }}>{bt?.error||'No backtest data'}</div>
  const eq = (bt.equity_curve||[]).map((v,i)=>({ i, v:+(v*100-100).toFixed(3) }))
  return (
    <div style={{ display:'flex',flexDirection:'column',gap:10 }}>
      <div style={{ display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:6 }}>
        {[
          { label:'Win Rate',     value:`${bt.win_rate}%`,             color:'var(--green)' },
          { label:'Trades',       value:bt.total_trades,               color:'var(--cyan)' },
          { label:'Avg Ret',      value:`${bt.avg_return_pct}%`,       color:bt.avg_return_pct>=0?'var(--green)':'var(--red)' },
          { label:'Total Ret',    value:`${bt.total_return_pct}%`,     color:bt.total_return_pct>=0?'var(--green)':'var(--red)' },
          { label:'Max DD',       value:`${bt.max_drawdown_pct}%`,     color:'var(--red)' },
          { label:'Prof Factor',  value:bt.profit_factor,              color:'var(--yellow)' },
        ].map(({ label,value,color }) => (
          <div key={label} style={{ background:'var(--bg-raised)',borderRadius:7,padding:'8px 6px',textAlign:'center' }}>
            <Label>{label}</Label>
            <div style={{ fontFamily:'var(--font-mono)',fontSize:13,color,fontWeight:700,marginTop:3 }}>{value}</div>
          </div>
        ))}
      </div>
      {eq.length>0&&(
        <div>
          <Label>Equity Curve</Label>
          <div style={{ marginTop:6 }}>
            <ResponsiveContainer width="100%" height={80}>
              <AreaChart data={eq}>
                <defs><linearGradient id="eg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#00e676" stopOpacity={0.3}/><stop offset="100%" stopColor="#00e676" stopOpacity={0}/></linearGradient></defs>
                <XAxis dataKey="i" hide/><YAxis hide/>
                <Tooltip contentStyle={{ background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:5,fontSize:10 }} formatter={v=>[`${v.toFixed(2)}%`,'Equity']} labelFormatter={()=>''}/>
                <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="3 3"/>
                <Area dataKey="v" stroke="#00e676" strokeWidth={1.5} fill="url(#eg)" dot={false} isAnimationActive={false}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      {bt.recent_trades?.length>0&&(
        <div>
          <Label>Recent Trades</Label>
          <div style={{ marginTop:5,maxHeight:100,overflowY:'auto' }}>
            {bt.recent_trades.slice(-6).reverse().map((t,i)=>(
              <div key={i} style={{ display:'flex',justifyContent:'space-between',alignItems:'center',padding:'3px 7px',borderRadius:4,marginBottom:2,background:t.won?'rgba(0,230,118,0.05)':'rgba(255,61,87,0.05)',border:`1px solid ${t.won?'rgba(0,230,118,0.15)':'rgba(255,61,87,0.15)'}`}}>
                <span style={{ fontSize:9,color:t.action==='LONG'?'var(--green)':'var(--red)',fontFamily:'var(--font-mono)',fontWeight:700 }}>{t.action}</span>
                <span style={{ fontSize:9,fontFamily:'var(--font-mono)',color:'var(--text-2)' }}>{(t.confidence*100)|0}%</span>
                <span style={{ fontSize:9,fontFamily:'var(--font-mono)',color:t.won?'var(--green)':'var(--red)',fontWeight:700 }}>{t.ret>=0?'+':''}{t.ret}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function FeatureChart({ data }) {
  if (!data?.length) return null
  const top5 = data.slice(0,5)
  return (
    <div>
      <Label>Feature Importance</Label>
      <div style={{ marginTop:6 }}>
        <ResponsiveContainer width="100%" height={110}>
          <BarChart data={top5} layout="vertical" margin={{ left:0,right:16,top:0,bottom:0 }}>
            <XAxis type="number" hide/><YAxis type="category" dataKey="feature" width:75 tick={{ fontSize:8,fontFamily:'var(--font-mono)',fill:'var(--text-2)' }}/>
            <Tooltip contentStyle={{ background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:5,fontSize:10 }} formatter={v=>[v.toFixed(4),'Imp']}/>
            <Bar dataKey="importance" radius={[0,4,4,0]}>{top5.map((_,i)=><Cell key={i} fill={`hsl(${200-i*20},70%,55%)`}/>)}</Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ─── MTF Panel ────────────────────────────────────────────────
const TF_ORDER = ['1m','3m','5m','15m']
const TF_LABEL = { '1m':'1 Min','3m':'3 Min','5m':'5 Min','15m':'15 Min' }
const TF_WEIGHT_LABEL = { '1m':'×1.0','3m':'×1.5','5m':'×2.0','15m':'×3.0' }

function AlignmentMeter({ value }) {
  const pct  = Math.round(value*100)
  const color = pct>=75?'var(--green)':pct>=50?'var(--yellow)':'var(--red)'
  return (
    <div style={{ textAlign:'center' }}>
      <div style={{ width:64,height:64,borderRadius:'50%',margin:'0 auto 6px',border:`4px solid ${color}`,display:'flex',alignItems:'center',justifyContent:'center',background:`${color}11` }}>
        <span style={{ fontFamily:'var(--font-mono)',fontSize:14,fontWeight:700,color }}>{pct}%</span>
      </div>
      <Label color={color}>Alignment</Label>
    </div>
  )
}

function VoteBar({ votes }) {
  if (!votes) return null
  const { up=0, down=0, no_trade=0, total=0 } = votes
  return (
    <div>
      <Label>Timeframe Votes</Label>
      <div style={{ display:'flex',gap:4,marginTop:6,height:28,borderRadius:5,overflow:'hidden' }}>
        {up>0 && <div style={{ flex:up,background:'rgba(0,230,118,0.3)',border:'1px solid var(--green)',borderRadius:4,display:'flex',alignItems:'center',justifyContent:'center' }}>
          <span style={{ fontFamily:'var(--font-mono)',fontSize:11,color:'var(--green)',fontWeight:700 }}>↑{up}</span>
        </div>}
        {no_trade>0 && <div style={{ flex:no_trade,background:'rgba(143,163,188,0.1)',border:'1px solid var(--border)',borderRadius:4,display:'flex',alignItems:'center',justifyContent:'center' }}>
          <span style={{ fontFamily:'var(--font-mono)',fontSize:11,color:'var(--text-2)' }}>—{no_trade}</span>
        </div>}
        {down>0 && <div style={{ flex:down,background:'rgba(255,61,87,0.2)',border:'1px solid var(--red)',borderRadius:4,display:'flex',alignItems:'center',justifyContent:'center' }}>
          <span style={{ fontFamily:'var(--font-mono)',fontSize:11,color:'var(--red)',fontWeight:700 }}>↓{down}</span>
        </div>}
      </div>
    </div>
  )
}

function TFCard({ iv, result }) {
  if (!result) return null
  const hasErr = !!result.error
  const ac = result.action
  const acColor = ac==='LONG'?'var(--green)':ac==='SHORT'?'var(--red)':'var(--text-2)'
  const acBg    = ac==='LONG'?'rgba(0,230,118,0.08)':ac==='SHORT'?'rgba(255,61,87,0.08)':'rgba(143,163,188,0.05)'

  return (
    <div style={{ background:acBg,border:`1px solid ${ac==='LONG'?'rgba(0,230,118,0.25)':ac==='SHORT'?'rgba(255,61,87,0.25)':'var(--border)'}`,borderRadius:8,padding:10 }}>
      {/* Header */}
      <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8 }}>
        <div style={{ display:'flex',alignItems:'center',gap:6 }}>
          <span style={{ fontFamily:'var(--font-mono)',fontSize:11,fontWeight:700,color:'var(--text-1)' }}>{TF_LABEL[iv]}</span>
          <span style={{ fontFamily:'var(--font-mono)',fontSize:9,color:'var(--text-3)',background:'var(--bg-raised)',padding:'1px 5px',borderRadius:3 }}>{TF_WEIGHT_LABEL[iv]}</span>
        </div>
        {hasErr
          ? <span style={{ fontSize:9,color:'var(--text-3)' }}>Error</span>
          : <SignalBadge signal={result.signal} action={result.action}/>
        }
      </div>

      {hasErr && <div style={{ fontSize:10,color:'var(--red)',fontFamily:'var(--font-mono)' }}>{result.error}</div>}

      {!hasErr && (
        <>
          {/* Confidence */}
          <ConfidenceBar value={result.confidence}/>

          {/* Key indicators */}
          <div style={{ display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:4,marginTop:8 }}>
            {[
              { label:'RSI',  value:result.indicators?.rsi?.toFixed(1),    color:result.indicators?.rsi>70?'var(--red)':result.indicators?.rsi<30?'var(--green)':'var(--text-1)' },
              { label:'EMA×', value:result.indicators?.ema_cross>0?'Bull':'Bear', color:result.indicators?.ema_cross>0?'var(--green)':'var(--red)' },
              { label:'Vol',  value:`${result.indicators?.vol_ratio?.toFixed(1)}x`, color:result.indicators?.vol_ratio>1?'var(--cyan)':'var(--text-2)' },
            ].map(({ label,value,color }) => (
              <div key={label} style={{ background:'var(--bg-raised)',borderRadius:5,padding:'5px 6px',textAlign:'center' }}>
                <Label>{label}</Label>
                <div style={{ fontFamily:'var(--font-mono)',fontSize:11,color,fontWeight:600,marginTop:1 }}>{value||'—'}</div>
              </div>
            ))}
          </div>

          {/* Price levels if tradeable */}
          {result.action!=='NO_TRADE' && result.entry && (
            <div style={{ marginTop:8,display:'flex',flexDirection:'column',gap:3 }}>
              <div style={{ display:'flex',justifyContent:'space-between',fontSize:10,fontFamily:'var(--font-mono)' }}>
                <span style={{ color:'var(--green)' }}>TP: {result.take_profit?.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:4})}</span>
                <span style={{ color:'var(--cyan)' }}>@ {result.entry?.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:4})}</span>
                <span style={{ color:'var(--red)' }}>SL: {result.stop_loss?.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:4})}</span>
              </div>
            </div>
          )}

          {/* Model + BT summary */}
          <div style={{ display:'flex',justifyContent:'space-between',marginTop:8,paddingTop:6,borderTop:'1px solid var(--border)' }}>
            <span style={{ fontSize:9,color:'var(--text-3)',fontFamily:'var(--font-mono)' }}>{result.best_model}</span>
            {result.backtest?.win_rate!=null && (
              <span style={{ fontSize:9,color:'var(--text-2)',fontFamily:'var(--font-mono)' }}>
                WR {result.backtest.win_rate}% · {result.backtest.total_trades}T
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function MTFPanel({ mtfData, loading, onAnalyze }) {
  if (loading) return (
    <div style={{ textAlign:'center',padding:'40px 20px' }}>
      <Spinner/>
      <div style={{ color:'var(--text-2)',fontSize:11,marginTop:10 }}>Analyzing all 4 timeframes...</div>
      <div style={{ color:'var(--text-3)',fontSize:10,marginTop:4 }}>Training 3 ML models × 4 TFs — ~60s</div>
    </div>
  )

  if (!mtfData) return (
    <div style={{ textAlign:'center',padding:'40px 20px' }}>
      <Layers size={28} color="var(--text-3)" style={{ margin:'0 auto 10px' }}/>
      <div style={{ color:'var(--text-2)',fontSize:12,marginBottom:6 }}>Multi-Timeframe Analysis</div>
      <div style={{ color:'var(--text-3)',fontSize:10,marginBottom:16 }}>
        Trains ML models on 1m, 3m, 5m and 15m simultaneously.<br/>
        Combines signals with weighted voting for a high-confidence consensus.
      </div>
      <button onClick={onAnalyze}
        style={{ padding:'9px 20px',borderRadius:8,fontSize:12,fontWeight:700,background:'linear-gradient(135deg,rgba(124,77,255,0.2),rgba(0,212,255,0.2))',border:'1px solid rgba(124,77,255,0.4)',color:'var(--purple)',cursor:'pointer' }}>
        Run MTF Analysis
      </button>
    </div>
  )

  const c = mtfData.consensus
  const acColor = c.action==='LONG'?'var(--green)':c.action==='SHORT'?'var(--red)':'var(--text-2)'

  return (
    <div style={{ display:'flex',flexDirection:'column',gap:12 }}>

      {/* Consensus banner */}
      <Card style={{ border:`1px solid ${acColor}44`,background:`linear-gradient(135deg,var(--bg-card),${c.action==='LONG'?'rgba(0,230,118,0.04)':c.action==='SHORT'?'rgba(255,61,87,0.04)':'var(--bg-card)'})` }}>
        <div style={{ display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12 }}>
          <div>
            <Label color="var(--text-3)">MTF Consensus · {mtfData.symbol}</Label>
            <div style={{ display:'flex',alignItems:'center',gap:8,marginTop:6 }}>
              <SignalBadge signal={c.signal} action={c.action}/>
              <span style={{ fontSize:10,color:'var(--text-3)',fontFamily:'var(--font-mono)' }}>score {c.norm_score>=0?'+':''}{c.norm_score}</span>
            </div>
          </div>
          <AlignmentMeter value={c.alignment}/>
        </div>

        <ConfidenceBar value={c.confidence} label="MTF Confidence"/>

        <div style={{ marginTop:10 }}>
          <VoteBar votes={c.tf_votes}/>
        </div>
      </Card>

      {/* Consensus price levels */}
      {c.action!=='NO_TRADE' && c.entry && (
        <Card>
          <div style={{ display:'flex',alignItems:'center',gap:6,marginBottom:10 }}>
            <Target size={12} color="var(--cyan)"/>
            <Label color="var(--cyan)">Consensus Levels · R:R {c.rr_ratio}</Label>
          </div>
          <PriceLevelRow label="🎯 Take Profit"  value={c.take_profit}  color="var(--green)"/>
          <PriceLevelRow label="📌 Entry (5m ref)"value={c.entry}       color="var(--cyan)"/>
          <PriceLevelRow label="🛡 Stop Loss"     value={c.stop_loss}   color="var(--red)"/>
          <PriceLevelRow label="❌ Invalidation"  value={c.invalidation} color="var(--orange)"/>
        </Card>
      )}

      {/* Reasons + warnings */}
      <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:10 }}>
        <Card>
          <div style={{ display:'flex',alignItems:'center',gap:5,marginBottom:7 }}>
            <Activity size={11} color="var(--purple)"/>
            <Label color="var(--purple)">Rationale</Label>
          </div>
          {c.reasons?.map((r,i)=>(
            <div key={i} style={{ display:'flex',gap:5,padding:'3px 0',borderBottom:i<c.reasons.length-1?'1px solid var(--border)':'none' }}>
              <span style={{ color:'var(--cyan)',fontSize:9 }}>›</span>
              <span style={{ fontSize:10,color:'var(--text-2)' }}>{r}</span>
            </div>
          ))}
        </Card>
        <Card style={{ borderColor:'rgba(255,214,0,0.2)',background:'rgba(255,214,0,0.03)' }}>
          <div style={{ display:'flex',alignItems:'center',gap:5,marginBottom:7 }}>
            <Shield size={11} color="var(--yellow)"/>
            <Label color="var(--yellow)">Risk Notes</Label>
          </div>
          {c.risk_warning?.map((w,i)=>(
            <div key={i} style={{ display:'flex',gap:5,padding:'3px 0' }}>
              <AlertTriangle size={9} color="var(--yellow)" style={{ marginTop:1,flexShrink:0 }}/>
              <span style={{ fontSize:10,color:'var(--yellow)cc' }}>{w}</span>
            </div>
          ))}
        </Card>
      </div>

      {/* Individual TF cards */}
      <div>
        <div style={{ display:'flex',alignItems:'center',gap:6,marginBottom:8 }}>
          <Layers size={12} color="var(--cyan)"/>
          <Label color="var(--cyan)">Individual Timeframe Signals</Label>
        </div>
        <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:8 }}>
          {TF_ORDER.map(iv => (
            <TFCard key={iv} iv={iv} result={mtfData.timeframes?.[iv]}/>
          ))}
        </div>
      </div>

      {/* Refresh button */}
      <button onClick={onAnalyze}
        style={{ padding:'8px',borderRadius:7,fontSize:11,fontWeight:600,background:'rgba(124,77,255,0.1)',border:'1px solid rgba(124,77,255,0.3)',color:'var(--purple)',display:'flex',alignItems:'center',justifyContent:'center',gap:6,cursor:'pointer' }}>
        <RefreshCw size={11}/> Re-run MTF Analysis
      </button>
    </div>
  )
}

// ─── Model metrics ────────────────────────────────────────────
function ModelMetrics({ metrics, bestModel }) {
  if (!metrics) return null
  return (
    <div style={{ display:'flex',flexDirection:'column',gap:7 }}>
      {Object.entries(metrics).map(([name,m])=>(
        <div key={name} style={{ background:name===bestModel?'var(--bg-hover)':'var(--bg-raised)',border:`1px solid ${name===bestModel?'var(--cyan)33':'var(--border)'}`,borderRadius:7,padding:9 }}>
          <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:5 }}>
            <span style={{ fontSize:11,fontWeight:600,color:name===bestModel?'var(--cyan)':'var(--text-1)' }}>{name}{name===bestModel?' ★':''}</span>
            <Label color={name===bestModel?'var(--cyan)':'var(--text-2)'}>CV F1: {m.cv_f1}</Label>
          </div>
          <div style={{ display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:3 }}>
            {['accuracy','precision','recall','f1'].map(k=>(
              <div key={k} style={{ textAlign:'center' }}>
                <Label>{k}</Label>
                <div style={{ fontFamily:'var(--font-mono)',fontSize:10,color:'var(--text-1)',marginTop:1 }}>{m[k]}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function MultiScanner({ onSelect }) {
  const [loading,setLoading]=useState(false)
  const [results,setResults]=useState([])
  const [iv,setIv]=useState('5m')
  const scan=useCallback(async()=>{
    setLoading(true)
    try { const d=await apiFetch('/multi_signal',{symbols:['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT'],interval:iv}); setResults(d.results||[]) }
    catch {}
    setLoading(false)
  },[iv])
  const ac=a=>a==='LONG'?'var(--green)':a==='SHORT'?'var(--red)':'var(--text-2)'
  return (
    <Card>
      <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10 }}>
        <div style={{ display:'flex',alignItems:'center',gap:6 }}><Zap size={13} color="var(--yellow)"/><Label color="var(--yellow)">Scanner</Label></div>
        <div style={{ display:'flex',gap:6 }}>
          <select value={iv} onChange={e=>setIv(e.target.value)} style={{ background:'var(--bg-raised)',border:'1px solid var(--border)',color:'var(--text-1)',borderRadius:5,padding:'3px 7px',fontSize:10,outline:'none' }}>
            {['1m','3m','5m','15m'].map(i=><option key={i}>{i}</option>)}
          </select>
          <button onClick={scan} disabled={loading} style={{ background:'rgba(255,214,0,0.1)',border:'1px solid rgba(255,214,0,0.3)',color:'var(--yellow)',borderRadius:5,padding:'3px 10px',fontSize:10,display:'flex',alignItems:'center',gap:4,cursor:'pointer' }}>
            {loading?<Spinner/>:<Zap size={10}/>} Scan
          </button>
        </div>
      </div>
      {results.length>0&&results.map(r=>(
        <div key={r.symbol} onClick={()=>!r.error&&onSelect(r.symbol)}
          style={{ display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 8px',background:'var(--bg-raised)',borderRadius:6,marginBottom:3,cursor:r.error?'default':'pointer',border:'1px solid var(--border)' }}
          onMouseEnter={e=>e.currentTarget.style.borderColor='var(--border-glow)'}
          onMouseLeave={e=>e.currentTarget.style.borderColor='var(--border)'}>
          <div style={{ display:'flex',alignItems:'center',gap:8 }}>
            <span style={{ fontFamily:'var(--font-mono)',fontSize:11,fontWeight:600,color:'var(--text-1)',width:65 }}>{r.symbol}</span>
            <span style={{ fontFamily:'var(--font-mono)',fontSize:10,color:r.change_pct>=0?'var(--green)':'var(--red)' }}>{r.change_pct>=0?'+':''}{r.change_pct?.toFixed(2)}%</span>
          </div>
          {r.error?<span style={{ fontSize:9,color:'var(--text-3)' }}>Err</span>
            :<div style={{ display:'flex',gap:6 }}>
              <span style={{ fontSize:10,fontFamily:'var(--font-mono)',color:ac(r.action),fontWeight:700 }}>{r.action}</span>
              <span style={{ fontSize:10,fontFamily:'var(--font-mono)',color:'var(--text-2)' }}>{Math.round(r.confidence*100)}%</span>
            </div>
          }
        </div>
      ))}
      {results.length===0&&!loading&&<div style={{ textAlign:'center',color:'var(--text-3)',fontSize:10,padding:10 }}>Click Scan to analyze all symbols</div>}
    </Card>
  )
}

// ─── Main App ─────────────────────────────────────────────────
export default function App() {
  const [symbol,   setSymbol]   = useState('BTCUSDT')
  const [interval, setIv]       = useState('5m')
  const [data,     setData]     = useState(null)
  const [mtfData,  setMtfData]  = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [mtfLoad,  setMtfLoad]  = useState(false)
  const [error,    setError]    = useState(null)
  const [online,   setOnline]   = useState(true)
  const [autoRef,  setAutoRef]  = useState(false)
  const [lastUp,   setLastUp]   = useState(null)
  const [tab,      setTab]      = useState('signal')
  const [mainView, setMainView] = useState('single') // 'single' | 'mtf'
  const timerRef = useRef(null)

  const SYMBOLS   = ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT']
  const INTERVALS = ['1m','3m','5m','15m']

  const analyze = useCallback(async (sym, ivl) => {
    setLoading(true); setError(null)
    try {
      const d = await apiFetch('/analyze', { symbol: sym||symbol, interval: ivl||interval })
      if (d.error) throw new Error(d.error)
      setData(d); setOnline(true); setLastUp(new Date().toLocaleTimeString())
    } catch(e) { setError(e.message); setOnline(false) }
    setLoading(false)
  }, [symbol, interval])

  const quickSignal = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const d = await apiFetch('/signal', { symbol, interval })
      if (d.error) throw new Error(d.error)
      setData(d); setOnline(true); setLastUp(new Date().toLocaleTimeString())
    } catch(e) { setError(e.message); setOnline(false) }
    setLoading(false)
  }, [symbol, interval])

  const runMTF = useCallback(async (sym) => {
    setMtfLoad(true); setError(null)
    try {
      const d = await apiFetch('/mtf_analyze', { symbol: sym||symbol })
      if (d.error) throw new Error(d.error)
      setMtfData(d); setOnline(true); setLastUp(new Date().toLocaleTimeString())
    } catch(e) { setError(e.message); setOnline(false) }
    setMtfLoad(false)
  }, [symbol])

  useEffect(() => {
    if (autoRef) { timerRef.current = setInterval(quickSignal, 30000) }
    else { clearInterval(timerRef.current) }
    return () => clearInterval(timerRef.current)
  }, [autoRef, quickSignal])

  const sig    = data?.signal
  const bt     = data?.backtest
  const fg     = data?.fear_greed || mtfData?.fear_greed
  const ticker = data?.ticker || mtfData?.ticker
  const acColor = a => a==='LONG'?'var(--green)':a==='SHORT'?'var(--red)':'var(--text-2)'
  const acGlow  = a => a==='LONG'?'glow-green':a==='SHORT'?'glow-red':''

  const tabs = [
    { id:'signal',  label:'Signal',  icon:<Target size={11}/> },
    { id:'backtest',label:'Backtest',icon:<BarChart2 size={11}/> },
    { id:'model',   label:'Model',   icon:<Activity size={11}/> },
  ]

  return (
    <div style={{ minHeight:'100vh',padding:12,maxWidth:1120,margin:'0 auto' }}>

      {/* Header */}
      <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14 }}>
        <div style={{ display:'flex',alignItems:'center',gap:9 }}>
          <div style={{ width:32,height:32,borderRadius:8,background:'linear-gradient(135deg,#00d4ff22,#7c4dff22)',border:'1px solid var(--cyan)44',display:'flex',alignItems:'center',justifyContent:'center' }}>
            <Activity size={15} color="var(--cyan)"/>
          </div>
          <div>
            <div style={{ fontWeight:700,fontSize:14,letterSpacing:'-0.01em' }}>CryptoScalp AI</div>
            <div style={{ fontSize:9,color:'var(--text-3)',fontFamily:'var(--font-mono)' }}>ML · Multi-Timeframe · Live Signals</div>
          </div>
        </div>
        <div style={{ display:'flex',alignItems:'center',gap:10 }}>
          <div style={{ display:'flex',alignItems:'center',fontSize:10,color:'var(--text-2)' }}><StatusDot online={online}/>{online?'Binance Live':'Offline'}</div>
          {lastUp&&<div style={{ fontSize:9,color:'var(--text-3)',fontFamily:'var(--font-mono)',display:'flex',alignItems:'center',gap:3 }}><Clock size={9}/>{lastUp}</div>}
          <div style={{ width:28,height:15,borderRadius:8,background:autoRef?'var(--cyan)':'var(--border)',position:'relative',transition:'background 0.2s',cursor:'pointer' }} onClick={()=>setAutoRef(p=>!p)}>
            <div style={{ width:11,height:11,borderRadius:'50%',background:'white',position:'absolute',top:2,transition:'left 0.2s',left:autoRef?15:2 }}/>
          </div>
        </div>
      </div>

      {/* Symbol + interval controls */}
      <Card style={{ marginBottom:10 }}>
        <div style={{ display:'flex',gap:7,flexWrap:'wrap',alignItems:'center' }}>
          <div style={{ display:'flex',gap:3 }}>
            {SYMBOLS.map(s=>(
              <button key={s} onClick={()=>{setSymbol(s);setMtfData(null)}}
                style={{ padding:'4px 9px',borderRadius:5,fontSize:10,fontWeight:600,fontFamily:'var(--font-mono)',border:'1px solid',borderColor:symbol===s?'var(--cyan)':'var(--border)',background:symbol===s?'rgba(0,212,255,0.1)':'var(--bg-raised)',color:symbol===s?'var(--cyan)':'var(--text-2)',cursor:'pointer',transition:'all 0.15s' }}>
                {s.replace('USDT','')}
              </button>
            ))}
          </div>
          <div style={{ borderLeft:'1px solid var(--border)',height:20,margin:'0 2px' }}/>
          <div style={{ display:'flex',gap:3 }}>
            {INTERVALS.map(iv=>(
              <button key={iv} onClick={()=>setIv(iv)}
                style={{ padding:'4px 7px',borderRadius:5,fontSize:10,fontFamily:'var(--font-mono)',border:'1px solid',borderColor:interval===iv?'var(--purple)':'var(--border)',background:interval===iv?'rgba(124,77,255,0.1)':'var(--bg-raised)',color:interval===iv?'var(--purple)':'var(--text-2)',cursor:'pointer',transition:'all 0.15s' }}>
                {iv}
              </button>
            ))}
          </div>
          <div style={{ marginLeft:'auto',display:'flex',gap:6 }}>
            <button onClick={quickSignal} disabled={loading}
              style={{ padding:'5px 12px',borderRadius:6,fontSize:10,fontWeight:600,background:'rgba(0,212,255,0.1)',border:'1px solid rgba(0,212,255,0.3)',color:'var(--cyan)',display:'flex',alignItems:'center',gap:4,cursor:'pointer' }}>
              {loading?<Spinner/>:<RefreshCw size={10}/>} Refresh
            </button>
            <button onClick={()=>analyze()} disabled={loading}
              style={{ padding:'5px 12px',borderRadius:6,fontSize:10,fontWeight:700,background:'linear-gradient(135deg,rgba(0,212,255,0.2),rgba(124,77,255,0.2))',border:'1px solid rgba(0,212,255,0.4)',color:'white',display:'flex',alignItems:'center',gap:4,cursor:'pointer' }}>
              {loading?<Spinner/>:<Zap size={10} color="var(--cyan)"/>} Analyze
            </button>
            <button onClick={()=>{setMainView('mtf');if(!mtfData)runMTF()}} disabled={mtfLoad}
              style={{ padding:'5px 12px',borderRadius:6,fontSize:10,fontWeight:700,background:'linear-gradient(135deg,rgba(124,77,255,0.2),rgba(0,212,255,0.1))',border:'1px solid rgba(124,77,255,0.4)',color:'var(--purple)',display:'flex',alignItems:'center',gap:4,cursor:'pointer' }}>
              {mtfLoad?<Spinner/>:<Layers size={10}/>} MTF
            </button>
          </div>
        </div>
      </Card>

      {/* View switcher */}
      <div style={{ display:'flex',gap:3,marginBottom:10 }}>
        {[{id:'single',label:'Single TF',icon:<Target size={11}/>},{id:'mtf',label:'Multi-Timeframe',icon:<Layers size={11}/>}].map(v=>(
          <button key={v.id} onClick={()=>setMainView(v.id)}
            style={{ padding:'5px 14px',borderRadius:6,fontSize:11,fontWeight:600,border:'1px solid',borderColor:mainView===v.id?'var(--cyan)':'var(--border)',background:mainView===v.id?'rgba(0,212,255,0.1)':'var(--bg-raised)',color:mainView===v.id?'var(--cyan)':'var(--text-2)',display:'flex',alignItems:'center',gap:5,cursor:'pointer',transition:'all 0.15s' }}>
            {v.icon}{v.label}
          </button>
        ))}
      </div>

      {/* Ticker bar */}
      {ticker&&(
        <div style={{ display:'flex',gap:6,marginBottom:10,flexWrap:'wrap' }}>
          {[
            { label:symbol,         value:`$${ticker.price?.toLocaleString(undefined,{minimumFractionDigits:2})}`, color:'var(--text-1)',big:true },
            { label:'24h Chg',      value:`${ticker.change_pct>=0?'+':''}${ticker.change_pct?.toFixed(2)}%`, color:ticker.change_pct>=0?'var(--green)':'var(--red)' },
            { label:'24h High',     value:`$${ticker.high_24h?.toLocaleString()}`, color:'var(--cyan)' },
            { label:'24h Low',      value:`$${ticker.low_24h?.toLocaleString()}`,  color:'var(--red)' },
            { label:'Vol 24h',      value:`$${(ticker.volume_24h/1e6).toFixed(0)}M`, color:'var(--yellow)' },
            fg&&{ label:'F&G Index',value:`${fg.value} ${fg.label}`, color:fg.value<=40?'var(--red)':fg.value>=60?'var(--green)':'var(--yellow)' }
          ].filter(Boolean).map(({ label,value,color,big })=>(
            <div key={label} style={{ background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:7,padding:'5px 10px',flex:1,minWidth:80 }}>
              <Label>{label}</Label>
              <div style={{ fontFamily:'var(--font-mono)',fontSize:big?13:11,color,fontWeight:700,marginTop:1 }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {error&&(
        <div style={{ background:'rgba(255,61,87,0.08)',border:'1px solid rgba(255,61,87,0.3)',borderRadius:7,padding:'8px 12px',marginBottom:10,display:'flex',gap:7,alignItems:'center' }}>
          <AlertTriangle size={13} color="var(--red)"/>
          <span style={{ fontSize:11,color:'var(--red)' }}>{error}</span>
        </div>
      )}

      {/* ── MTF VIEW ─────────────────────────────────────────── */}
      {mainView==='mtf'&&(
        <MTFPanel mtfData={mtfData} loading={mtfLoad} onAnalyze={()=>runMTF()}/>
      )}

      {/* ── SINGLE TF VIEW ───────────────────────────────────── */}
      {mainView==='single'&&(
        <>
          {!data&&!loading&&(
            <div style={{ textAlign:'center',padding:'50px 20px' }}>
              <Activity size={28} color="var(--text-3)" style={{ margin:'0 auto 10px' }}/>
              <div style={{ color:'var(--text-2)',marginBottom:5 }}>No analysis loaded</div>
              <div style={{ color:'var(--text-3)',fontSize:11,marginBottom:14 }}>Click Analyze or MTF for signals</div>
              <div style={{ display:'flex',gap:8,justifyContent:'center' }}>
                <button onClick={()=>analyze()} style={{ padding:'8px 18px',borderRadius:7,fontSize:11,fontWeight:700,background:'linear-gradient(135deg,rgba(0,212,255,0.15),rgba(124,77,255,0.15))',border:'1px solid rgba(0,212,255,0.4)',color:'var(--cyan)',cursor:'pointer' }}>Single TF</button>
                <button onClick={()=>{setMainView('mtf');runMTF()}} style={{ padding:'8px 18px',borderRadius:7,fontSize:11,fontWeight:700,background:'linear-gradient(135deg,rgba(124,77,255,0.15),rgba(0,212,255,0.1))',border:'1px solid rgba(124,77,255,0.4)',color:'var(--purple)',cursor:'pointer' }}>MTF Analysis</button>
              </div>
            </div>
          )}

          {loading&&!data&&(
            <div style={{ textAlign:'center',padding:'50px 20px' }}>
              <Spinner/><div style={{ color:'var(--text-2)',fontSize:11,marginTop:10 }}>Training models...</div>
            </div>
          )}

          {data&&sig&&(
            <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:10 }}>

              {/* LEFT */}
              <div style={{ display:'flex',flexDirection:'column',gap:10 }}>

                <Card className={acGlow(sig.action)} style={{ border:`1px solid ${acColor(sig.action)}44`,background:`linear-gradient(135deg,var(--bg-card),${sig.action==='LONG'?'rgba(0,230,118,0.03)':sig.action==='SHORT'?'rgba(255,61,87,0.03)':'var(--bg-card)'})` }}>
                  <div style={{ display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10 }}>
                    <div>
                      <Label color="var(--text-3)">Signal · {data.best_model} · {interval}</Label>
                      <div style={{ display:'flex',alignItems:'center',gap:7,marginTop:5 }}>
                        <SignalBadge signal={sig.signal} action={sig.action}/>
                      </div>
                    </div>
                    <div style={{ textAlign:'right' }}>
                      <Label>Entry</Label>
                      <div style={{ fontFamily:'var(--font-mono)',fontSize:15,fontWeight:700,color:'var(--text-1)',marginTop:2 }}>
                        ${sig.entry?.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:4})}
                      </div>
                    </div>
                  </div>
                  <ConfidenceBar value={sig.confidence}/>
                  <div style={{ marginTop:10 }}><ProbaBar proba={sig.proba}/></div>
                </Card>

                {sig.action!=='NO_TRADE'&&(
                  <Card>
                    <div style={{ display:'flex',alignItems:'center',gap:5,marginBottom:9 }}><Target size={11} color="var(--cyan)"/><Label color="var(--cyan)">Price Levels · R:R {sig.rr_ratio}</Label></div>
                    <PriceLevelRow label="🎯 Take Profit"  value={sig.take_profit}  color="var(--green)"/>
                    <PriceLevelRow label="📌 Entry"        value={sig.entry}        color="var(--cyan)"/>
                    <PriceLevelRow label="🛡 Stop Loss"    value={sig.stop_loss}    color="var(--red)"/>
                    <PriceLevelRow label="❌ Invalidation" value={sig.invalidation} color="var(--orange)"/>
                  </Card>
                )}

                <Card>
                  <div style={{ display:'flex',alignItems:'center',gap:5,marginBottom:7 }}><Activity size={11} color="var(--purple)"/><Label color="var(--purple)">Rationale</Label></div>
                  {sig.reasons?.map((r,i)=>(
                    <div key={i} style={{ display:'flex',gap:5,padding:'3px 0',borderBottom:i<sig.reasons.length-1?'1px solid var(--border)':'none' }}>
                      <span style={{ color:'var(--cyan)',fontSize:9 }}>›</span>
                      <span style={{ fontSize:11,color:'var(--text-2)' }}>{r}</span>
                    </div>
                  ))}
                </Card>

                {sig.risk_warning?.length>0&&(
                  <Card style={{ borderColor:'rgba(255,214,0,0.2)',background:'rgba(255,214,0,0.03)' }}>
                    <div style={{ display:'flex',alignItems:'center',gap:5,marginBottom:7 }}><Shield size={11} color="var(--yellow)"/><Label color="var(--yellow)">Risk Notes</Label></div>
                    {sig.risk_warning.map((w,i)=>(
                      <div key={i} style={{ display:'flex',gap:5,padding:'3px 0' }}>
                        <AlertTriangle size={9} color="var(--yellow)" style={{ marginTop:1,flexShrink:0 }}/>
                        <span style={{ fontSize:11,color:'var(--yellow)cc' }}>{w}</span>
                      </div>
                    ))}
                  </Card>
                )}

                <MultiScanner onSelect={s=>{setSymbol(s);setMtfData(null);setTimeout(()=>analyze(s,interval),100)}}/>
              </div>

              {/* RIGHT */}
              <div style={{ display:'flex',flexDirection:'column',gap:10 }}>

                <Card>
                  <div style={{ display:'flex',alignItems:'center',gap:5,marginBottom:9 }}><BarChart2 size={11} color="var(--cyan)"/><Label color="var(--cyan)">Indicators</Label></div>
                  <IndicatorGrid indicators={sig.indicators}/>
                </Card>

                <Card style={{ padding:0 }}>
                  <div style={{ display:'flex',borderBottom:'1px solid var(--border)' }}>
                    {tabs.map(t=>(
                      <button key={t.id} onClick={()=>setTab(t.id)}
                        style={{ flex:1,padding:'9px 0',border:'none',background:tab===t.id?'var(--bg-hover)':'transparent',borderBottom:tab===t.id?'2px solid var(--cyan)':'2px solid transparent',color:tab===t.id?'var(--cyan)':'var(--text-2)',display:'flex',alignItems:'center',justifyContent:'center',gap:4,fontSize:10,fontWeight:600,cursor:'pointer',transition:'all 0.15s' }}>
                        {t.icon}{t.label}
                      </button>
                    ))}
                  </div>
                  <div style={{ padding:12 }}>
                    {tab==='signal'&&(
                      <div style={{ display:'flex',flexDirection:'column',gap:9 }}>
                        <div>
                          <Label>Filters</Label>
                          <div style={{ marginTop:5,display:'flex',flexDirection:'column',gap:3 }}>
                            {Object.entries(sig.filters||{}).map(([k,v])=>(
                              <div key={k} style={{ display:'flex',justifyContent:'space-between',padding:'4px 7px',background:'var(--bg-raised)',borderRadius:5 }}>
                                <span style={{ fontSize:10,color:'var(--text-2)' }}>{k.replace(/_/g,' ')}</span>
                                <span style={{ fontSize:10,fontFamily:'var(--font-mono)',color:v?'var(--green)':'var(--red)' }}>{v?'✓ Pass':'✗ Fail'}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        {data.label_distribution&&(
                          <div>
                            <Label>Label Distribution</Label>
                            <div style={{ display:'flex',gap:5,marginTop:5 }}>
                              {[{k:'DOWN',color:'var(--red)'},{k:'NO_TRADE',color:'var(--text-2)'},{k:'UP',color:'var(--green)'}].map(({k,color})=>{
                                const v=data.label_distribution[k]; const pct=Math.round(v/data.label_distribution.total*100)
                                return <div key={k} style={{ flex:1,textAlign:'center',background:'var(--bg-raised)',borderRadius:6,padding:7 }}>
                                  <div style={{ fontFamily:'var(--font-mono)',fontSize:13,color,fontWeight:700 }}>{v}</div>
                                  <div style={{ fontSize:9,color:'var(--text-3)',marginTop:2 }}>{k}</div>
                                  <div style={{ fontSize:9,color:'var(--text-3)' }}>{pct}%</div>
                                </div>
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    {tab==='backtest'&&<BacktestPanel bt={bt}/>}
                    {tab==='model'&&(
                      <div style={{ display:'flex',flexDirection:'column',gap:10 }}>
                        <ModelMetrics metrics={data.metrics} bestModel={data.best_model}/>
                        <FeatureChart data={data.feature_importance}/>
                      </div>
                    )}
                  </div>
                </Card>

                <div style={{ background:'rgba(255,61,87,0.05)',border:'1px solid rgba(255,61,87,0.15)',borderRadius:7,padding:'9px 11px' }}>
                  <div style={{ display:'flex',gap:5,alignItems:'flex-start' }}>
                    <AlertTriangle size={10} color="var(--red)" style={{ marginTop:1,flexShrink:0 }}/>
                    <p style={{ fontSize:10,color:'var(--text-3)',lineHeight:1.5 }}>
                      <strong style={{ color:'var(--red)' }}>Risk Disclaimer: </strong>
                      Educational only. Crypto is volatile. Backtests ≠ future results. Paper trade first.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
