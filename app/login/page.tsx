export const dynamic = "force-dynamic";

export default function LoginPage({ searchParams }: { searchParams: { error?: string } }) {
  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>Cash Position</h1>
        <p>Enter the access password to continue.</p>
        <form action="/api/login" method="post">
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" autoFocus required />
          </div>
          <button className="submit" type="submit">Enter</button>
          {searchParams?.error ? <div className="login-error">Incorrect password.</div> : null}
        </form>
      </div>
    </div>
  );
}
