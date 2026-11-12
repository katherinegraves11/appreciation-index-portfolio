/** The insider read (Katie, 2026-10-26): private calls by Katie and her luxury sourcer on bags they inspected (pass / wait / buy, and why).
 *  Stored dated in sourcer_judgments; never shown on a customer page and never naming Katie or her sourcer. The log page opens only on
 *  Katie's own machine or home network, never through a public tunnel. */
import { DatabaseSync } from "node:sqlite";
import fs from "fs";

const DB = process.env.TRACKER_DB_PATH ?? "/Users/katiegraves/Desktop/Fashion Data Lab/db/luxury_bags.db";

export const CALLS = ["pass", "wait", "buy"] as const;
export const REASONS = ["leather", "hardware", "stitching or construction", "colour", "shape", "price", "something better coming", "other"] as const;

export type Judgment = { id?: number; judged_on: string; house: string; model: string; spec: string; decision: string; reason_type: string; reason: string; instead: string; recorded_at?: string };

/** Only Katie's laptop or home Wi-Fi: a public tunnel adds Cloudflare's headers and its own host name. */
export function isPrivateRequest(h: { get(name: string): string | null }): boolean {
  if (h.get("cf-connecting-ip") || h.get("cf-ray")) return false;
  const host = (h.get("host") ?? "").split(":")[0];
  return /^(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(host);
}

function open(): DatabaseSync | null {
  if (!fs.existsSync(DB)) return null;
  const d = new DatabaseSync(DB);
  d.exec("PRAGMA busy_timeout = 5000");
  d.exec(`create table if not exists sourcer_judgments(id integer primary key, judged_on text, house text, model text, spec text, decision text, reason text,
    outcome text, related text, private int default 1, source text, recorded_at text)`);
  const cols = (d.prepare("pragma table_info(sourcer_judgments)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("reason_type")) d.exec("alter table sourcer_judgments add column reason_type text");
  if (!cols.includes("instead")) d.exec("alter table sourcer_judgments add column instead text");
  return d;
}

export function listJudgments(limit = 50): Judgment[] {
  const d = open(); if (!d) return [];
  try {
    return d.prepare("select id, judged_on, house, model, coalesce(spec,'') spec, coalesce(decision,'') decision, coalesce(reason_type,'') reason_type, coalesce(reason,'') reason, coalesce(instead, outcome, '') instead, recorded_at from sourcer_judgments order by judged_on desc, id desc limit ?").all(limit) as unknown as Judgment[];
  } finally { d.close(); }
}

/** One new call; every field is trimmed and capped, nothing existing is changed. */
export function addJudgment(j: Omit<Judgment, "id" | "recorded_at">): number {
  const d = open(); if (!d) throw new Error("tracker not available");
  const c = (v: string, n: number) => String(v ?? "").trim().slice(0, n);
  try {
    const r = d.prepare(`insert into sourcer_judgments(judged_on, house, model, spec, decision, reason_type, reason, instead, private, source, recorded_at)
      values(?,?,?,?,?,?,?,?,1,'insider log page',datetime('now','localtime'))`)
      .run(c(j.judged_on, 10), c(j.house, 60), c(j.model, 120), c(j.spec, 300), c(j.decision, 10), c(j.reason_type, 200), c(j.reason, 1000), c(j.instead, 300));
    return Number(r.lastInsertRowid);
  } finally { d.close(); }
}
