"use client";

import { useState } from "react";
import type { BriefResult } from "@/lib/schema";
import { toCards, toSignals, INTENT_LABEL, VERDICT_WORD, CALL_WORDS, type Card } from "@/lib/cards";

const MOOD_WORD = { strong: "Good sign", mixed: "Mixed", weak: "Weak spot" } as const;

function CardBox({ c }: { c: Card }) {
  const [open, setOpen] = useState(false);
  return (
    <section className={`card ${c.mood}`} aria-label={c.title}>
      <div className="card-top">
        <span className="card-title">{c.title}</span>
        <span className={`mood ${c.mood}`}>{MOOD_WORD[c.mood]}</span>
      </div>
      <p className="card-q">{c.question}</p>
      <p className="card-h">{c.headline}</p>
      {c.bullets && c.bullets.length > 0 && (
        <ul className="card-list">{c.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
      )}
      {(c.more || c.evidence.length > 0) && (
        <>
          <button type="button" className="more" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? "Less" : "Why?"}
          </button>
          {open && (
            <div className="card-more">
              {c.more && <p>{c.more}</p>}
              {c.evidence.length > 0 && (
                <ul className="ev-list">
                  {c.evidence.map((e, i) => (
                    <li key={i}>
                      {e.text}{" "}
                      <span className="src">{e.url ? <a href={e.url} target="_blank" rel="noreferrer">{e.source}</a> : e.source}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default function Cards({ result, bagName, briefId }: { result: BriefResult; bagName: string; briefId?: string }) {
  const cards = toCards(result);
  const signals = toSignals(result);
  const [sides, setSides] = useState(false);
  const [detail, setDetail] = useState(false);
  return (
    <div className="answer">
      <div className="verdict">
        <p className="k">{bagName}</p>
        <h2 className="verdict-call">{result.plain_answer || CALL_WORDS[result.call] || result.call}</h2>
        {result.timing && <p className="verdict-line">{result.timing}</p>}
        <p className="verdict-meta">
          <span className="pill">{result.call}</span>
          <span className="pill">Confidence: {result.confidence.toLowerCase()}</span>
        </p>
      </div>

      <div className="signals" aria-label="What to do">
        {signals.map((s) => (
          <section key={s.intent} className={`signal ${s.verdict}`}>
            <p className="k">{INTENT_LABEL[s.intent]?.title ?? s.intent}</p>
            <p className="sig-word">{VERDICT_WORD[s.verdict]}</p>
            <p className="sig-why">{s.why}</p>
          </section>
        ))}
      </div>

      <button type="button" className="more detail-toggle" onClick={() => setDetail(!detail)} aria-expanded={detail}>
        {detail ? "Hide the why" : "Show me why"}
      </button>
      {detail && (<>

      <div className="cards">{cards.map((c) => <CardBox key={c.key} c={c} />)}</div>

      <div className="sides">
        <button type="button" className="more" onClick={() => setSides(!sides)} aria-expanded={sides}>
          {sides ? "Hide the two sides" : "Show the two sides"}
        </button>
        {sides && (
          <div className="two">
            <div><p className="k">Why yes</p><ul>{result.bull_case.map((b, i) => <li key={i}>{b}</li>)}</ul></div>
            <div><p className="k">Why not</p><ul>{result.bear_case.map((b, i) => <li key={i}>{b}</li>)}</ul></div>
            <div><p className="k">What would change this</p><ul>{result.what_would_change_this.map((b, i) => <li key={i}>{b}</li>)}</ul></div>
          </div>
        )}
      </div>

      </>)}

      <p className="disclaimer">{result.disclaimer}{briefId && <> · <a href={`/brief/${briefId}`}>Full brief with every source</a></>}</p>
    </div>
  );
}
