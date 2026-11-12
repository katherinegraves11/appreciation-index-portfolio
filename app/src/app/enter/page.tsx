export default async function EnterPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next = "/", error } = await searchParams;
  return (
    <main className="enter">
      <p className="eyebrow">Pilot access</p>
      <h1 style={{ fontSize: 34 }}>Enter your access code</h1>
      <form method="post" action="/api/enter" style={{ display: "grid", gap: 14, marginTop: 22 }}>
        <input type="hidden" name="next" value={next} />
        <label>Access code
          <input name="code" type="password" autoComplete="off" required />
        </label>
        <button className="primary" type="submit">Continue</button>
        {error && <div className="status error" role="alert">That code didn&apos;t match.</div>}
      </form>
    </main>
  );
}
