"use client";

import { useEffect, useRef, useState } from "react";

const GROUPS: { title: string; items: [string, string][] }[] = [
  { title: "Import", items: [["Bank statement · Excel or PDF", "/import"], ["Payment requests", "/import/payments"]] },
  { title: "Manual entry", items: [
    ["Update a balance", "/record#balance"],
    ["Add transaction", "/record#transaction"],
    ["Inter-company transfer", "/record#transfer"],
    ["New investment placement", "/investments#add-placement"],
  ] },
];

export function RecordMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return (
    <div className="rec" ref={ref}>
      <button type="button" className="btn-primary" aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        Record
      </button>
      {open ? (
        <div className="rec-menu" role="menu">
          {GROUPS.map((g) => (
            <div key={g.title} className="rec-group">
              <span className="lbl">{g.title}</span>
              {g.items.map(([label, href]) => (
                <a key={href} href={href} role="menuitem" className="rec-item" onClick={() => setOpen(false)}>{label}</a>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
