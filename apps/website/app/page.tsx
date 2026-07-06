import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.kicker}>Local-first project intelligence</p>
        <h1>Xepha</h1>
        <p className={styles.lead}>
          Xepha turns project evolution into structured, reusable context for humans and
          AI agents.
        </p>
        <div className={styles.grid}>
          <article>
            <span>01</span>
            <h2>Core first</h2>
            <p>Pure TypeScript packages own the intelligence layer.</p>
          </article>
          <article>
            <span>02</span>
            <h2>Local by default</h2>
            <p>SQLite and local indexes come before any cloud control plane.</p>
          </article>
          <article>
            <span>03</span>
            <h2>Agent friendly</h2>
            <p>MCP and external protocols are adapters, not the product core.</p>
          </article>
        </div>
      </section>
    </main>
  );
}
